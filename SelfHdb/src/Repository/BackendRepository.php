<?php

declare(strict_types=1);

namespace SelfHdb\Repository;

use PDO;
use SelfHdb\Support\Str;

final class BackendRepository
{
    public function __construct(private readonly PDO $pdo)
    {
        $this->ensureRuntimeSchema();
    }

    private function ensureRuntimeSchema(): void
    {
        $this->ensureColumn(
            'sync_envelopes',
            'content_patch_json',
            'ALTER TABLE sync_envelopes ADD COLUMN content_patch_json LONGTEXT NULL'
        );
        $this->ensureColumn(
            'event_content',
            'materialized_json',
            'ALTER TABLE event_content ADD COLUMN materialized_json LONGTEXT NULL'
        );
    }

    private function ensureColumn(string $tableName, string $columnName, string $alterSql): void
    {
        $stmt = $this->pdo->prepare(sprintf('SHOW COLUMNS FROM %s LIKE :column_name', $tableName));
        $stmt->execute(['column_name' => $columnName]);
        if ($stmt->fetch()) {
            return;
        }

        $this->pdo->exec($alterSql);
    }

    public function transaction(callable $callback): mixed
    {
        $this->pdo->beginTransaction();
        try {
            $result = $callback();
            $this->pdo->commit();
            return $result;
        } catch (\Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }
    }

    public function createUser(string $email, string $passwordHash): array
    {
        $now = Str::now();
        $id = Str::uuid();
        $stmt = $this->pdo->prepare(
            'INSERT INTO users (id, email, password_hash, created_at, updated_at)
             VALUES (:id, :email, :password_hash, :created_at, :updated_at)'
        );
        $stmt->execute([
            'id' => $id,
            'email' => strtolower($email),
            'password_hash' => $passwordHash,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return $this->findUserById($id) ?? [];
    }

    public function findUserByEmail(string $email): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM users WHERE email = :email LIMIT 1');
        $stmt->execute(['email' => strtolower($email)]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function findUserById(string $userId): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM users WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $userId]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function upsertDevice(string $userId, array $device): array
    {
        $now = Str::now();
        $deviceId = trim((string) ($device['id'] ?? '')) ?: Str::uuid();
        $name = trim((string) ($device['name'] ?? 'Unnamed device'));
        $type = trim((string) ($device['type'] ?? 'desktop'));

        $existing = $this->findDeviceForUser($userId, $deviceId);
        if ($existing) {
            $stmt = $this->pdo->prepare(
                'UPDATE devices
                 SET name = :name, device_type = :device_type, last_seen_at = :last_seen_at,
                     revoked_at = NULL, is_trusted = 1
                 WHERE id = :id AND user_id = :user_id'
            );
            $stmt->execute([
                'id' => $deviceId,
                'user_id' => $userId,
                'name' => $name,
                'device_type' => $type,
                'last_seen_at' => $now,
            ]);
        } else {
            $stmt = $this->pdo->prepare(
                'INSERT INTO devices (id, user_id, name, device_type, created_at, last_seen_at, is_trusted)
                 VALUES (:id, :user_id, :name, :device_type, :created_at, :last_seen_at, 1)'
            );
            $stmt->execute([
                'id' => $deviceId,
                'user_id' => $userId,
                'name' => $name,
                'device_type' => $type,
                'created_at' => $now,
                'last_seen_at' => $now,
            ]);
        }

        return $this->findDeviceForUser($userId, $deviceId) ?? [];
    }

    public function findDeviceForUser(string $userId, string $deviceId): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM devices WHERE id = :id AND user_id = :user_id LIMIT 1');
        $stmt->execute(['id' => $deviceId, 'user_id' => $userId]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function listDevices(string $userId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, name, device_type, created_at, last_seen_at, revoked_at, is_trusted
             FROM devices WHERE user_id = :user_id ORDER BY last_seen_at DESC'
        );
        $stmt->execute(['user_id' => $userId]);
        return $stmt->fetchAll();
    }

    public function revokeDevice(string $userId, string $deviceId): void
    {
        $now = Str::now();
        $stmt = $this->pdo->prepare(
            'UPDATE devices SET revoked_at = :revoked_at, is_trusted = 0 WHERE id = :id AND user_id = :user_id'
        );
        $stmt->execute(['revoked_at' => $now, 'id' => $deviceId, 'user_id' => $userId]);

        $stmt = $this->pdo->prepare(
            'UPDATE sessions SET revoked_at = :revoked_at WHERE user_id = :user_id AND device_id = :device_id AND revoked_at IS NULL'
        );
        $stmt->execute(['revoked_at' => $now, 'user_id' => $userId, 'device_id' => $deviceId]);

        $stmt = $this->pdo->prepare(
            'UPDATE refresh_tokens SET revoked_at = :revoked_at WHERE user_id = :user_id AND device_id = :device_id AND revoked_at IS NULL'
        );
        $stmt->execute(['revoked_at' => $now, 'user_id' => $userId, 'device_id' => $deviceId]);
    }

    public function createSession(string $userId, string $deviceId, string $accessTokenId, string $ipAddress, string $userAgent, string $expiresAt): array
    {
        $now = Str::now();
        $sessionId = Str::uuid();
        $stmt = $this->pdo->prepare(
            'INSERT INTO sessions (id, user_id, device_id, access_token_id, created_at, expires_at, last_used_at, ip_address, user_agent)
             VALUES (:id, :user_id, :device_id, :access_token_id, :created_at, :expires_at, :last_used_at, :ip_address, :user_agent)'
        );
        $stmt->execute([
            'id' => $sessionId,
            'user_id' => $userId,
            'device_id' => $deviceId,
            'access_token_id' => $accessTokenId,
            'created_at' => $now,
            'expires_at' => $expiresAt,
            'last_used_at' => $now,
            'ip_address' => $ipAddress,
            'user_agent' => substr($userAgent, 0, 255),
        ]);

        return $this->findSessionById($sessionId) ?? [];
    }

    public function findSessionById(string $sessionId): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM sessions WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $sessionId]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function listSessions(string $userId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT s.id, s.device_id, s.created_at, s.expires_at, s.last_used_at, s.revoked_at,
                    d.name AS device_name, d.device_type
             FROM sessions s
             JOIN devices d ON d.id = s.device_id
             WHERE s.user_id = :user_id
             ORDER BY s.last_used_at DESC'
        );
        $stmt->execute(['user_id' => $userId]);
        return $stmt->fetchAll();
    }

    public function touchSession(string $sessionId): void
    {
        $stmt = $this->pdo->prepare('UPDATE sessions SET last_used_at = :last_used_at WHERE id = :id');
        $stmt->execute(['last_used_at' => Str::now(), 'id' => $sessionId]);
    }

    public function revokeSession(string $userId, string $sessionId): void
    {
        $now = Str::now();
        $stmt = $this->pdo->prepare('UPDATE sessions SET revoked_at = :revoked_at WHERE id = :id AND user_id = :user_id');
        $stmt->execute(['revoked_at' => $now, 'id' => $sessionId, 'user_id' => $userId]);

        $stmt = $this->pdo->prepare('UPDATE refresh_tokens SET revoked_at = :revoked_at WHERE session_id = :session_id AND revoked_at IS NULL');
        $stmt->execute(['revoked_at' => $now, 'session_id' => $sessionId]);
    }

    public function createRefreshToken(string $sessionId, string $userId, string $deviceId, string $tokenHash, string $expiresAt, ?string $rotatedFromId = null): array
    {
        $now = Str::now();
        $id = Str::uuid();
        $stmt = $this->pdo->prepare(
            'INSERT INTO refresh_tokens (id, session_id, user_id, device_id, token_hash, created_at, expires_at, rotated_from_id)
             VALUES (:id, :session_id, :user_id, :device_id, :token_hash, :created_at, :expires_at, :rotated_from_id)'
        );
        $stmt->execute([
            'id' => $id,
            'session_id' => $sessionId,
            'user_id' => $userId,
            'device_id' => $deviceId,
            'token_hash' => $tokenHash,
            'created_at' => $now,
            'expires_at' => $expiresAt,
            'rotated_from_id' => $rotatedFromId,
        ]);

        return $this->findRefreshTokenByHash($tokenHash) ?? [];
    }

    public function findRefreshTokenByHash(string $tokenHash): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM refresh_tokens WHERE token_hash = :token_hash LIMIT 1');
        $stmt->execute(['token_hash' => $tokenHash]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function revokeRefreshToken(string $refreshTokenId): void
    {
        $stmt = $this->pdo->prepare('UPDATE refresh_tokens SET revoked_at = :revoked_at WHERE id = :id');
        $stmt->execute(['revoked_at' => Str::now(), 'id' => $refreshTokenId]);
    }

    public function getCurrentServerSequence(string $userId): int
    {
        $stmt = $this->pdo->prepare('SELECT COALESCE(MAX(server_sequence), 0) AS max_sequence FROM sync_envelopes WHERE user_id = :user_id');
        $stmt->execute(['user_id' => $userId]);
        $row = $stmt->fetch();
        return (int) ($row['max_sequence'] ?? 0);
    }

    public function getSyncState(string $userId, string $deviceId): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM sync_state WHERE user_id = :user_id AND device_id = :device_id LIMIT 1');
        $stmt->execute(['user_id' => $userId, 'device_id' => $deviceId]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function upsertSyncState(string $userId, string $deviceId, int $lastServerSequence, int $lastDeviceSequenceSeen): array
    {
        $now = Str::now();
        $existing = $this->getSyncState($userId, $deviceId);
        if ($existing) {
            $stmt = $this->pdo->prepare(
                'UPDATE sync_state SET last_server_sequence = :last_server_sequence, last_device_sequence_seen = :last_device_sequence_seen, updated_at = :updated_at WHERE user_id = :user_id AND device_id = :device_id'
            );
            $stmt->execute([
                'last_server_sequence' => $lastServerSequence,
                'last_device_sequence_seen' => $lastDeviceSequenceSeen,
                'updated_at' => $now,
                'user_id' => $userId,
                'device_id' => $deviceId,
            ]);
        } else {
            $stmt = $this->pdo->prepare(
                'INSERT INTO sync_state (id, user_id, device_id, last_server_sequence, last_device_sequence_seen, updated_at)
                 VALUES (:id, :user_id, :device_id, :last_server_sequence, :last_device_sequence_seen, :updated_at)'
            );
            $stmt->execute([
                'id' => Str::uuid(),
                'user_id' => $userId,
                'device_id' => $deviceId,
                'last_server_sequence' => $lastServerSequence,
                'last_device_sequence_seen' => $lastDeviceSequenceSeen,
                'updated_at' => $now,
            ]);
        }

        return $this->getSyncState($userId, $deviceId) ?? [];
    }

    public function ensureDefaultCalendar(string $userId, string $timezone = 'UTC'): array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM calendars WHERE user_id = :user_id AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1');
        $stmt->execute(['user_id' => $userId]);
        $existing = $stmt->fetch();
        if ($existing) {
            return $existing;
        }

        $now = Str::now();
        $id = Str::uuid();
        $stmt = $this->pdo->prepare(
            'INSERT INTO calendars (id, user_id, name, color, timezone, created_at, updated_at)
             VALUES (:id, :user_id, :name, :color, :timezone, :created_at, :updated_at)'
        );
        $stmt->execute([
            'id' => $id,
            'user_id' => $userId,
            'name' => 'My Calendar',
            'color' => '#4f9d69',
            'timezone' => $timezone,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $stmt = $this->pdo->prepare('SELECT * FROM calendars WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $id]);
        return $stmt->fetch() ?: [];
    }

    public function findEnvelopeByDeviceSequence(string $deviceId, int $deviceSequence): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT * FROM sync_envelopes WHERE device_id = :device_id AND device_sequence = :device_sequence LIMIT 1'
        );
        $stmt->execute([
            'device_id' => $deviceId,
            'device_sequence' => $deviceSequence,
        ]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function insertEnvelope(string $userId, string $deviceId, array $envelope): array
    {
        $id = Str::uuid();
        $stmt = $this->pdo->prepare(
            'INSERT INTO sync_envelopes
             (id, user_id, device_id, device_sequence, entity, entity_id, operation, metadata_patch_json, content_patch_json, encrypted_content_patch, nonce, client_timestamp, created_at)
             VALUES
             (:id, :user_id, :device_id, :device_sequence, :entity, :entity_id, :operation, :metadata_patch_json, :content_patch_json, :encrypted_content_patch, :nonce, :client_timestamp, :created_at)'
        );
        $stmt->execute([
            'id' => $id,
            'user_id' => $userId,
            'device_id' => $deviceId,
            'device_sequence' => (int) $envelope['deviceSequence'],
            'entity' => (string) $envelope['entity'],
            'entity_id' => (string) $envelope['entityId'],
            'operation' => (string) $envelope['operation'],
            'metadata_patch_json' => json_encode($envelope['metadataPatch'] ?? []),
            'content_patch_json' => isset($envelope['contentPatch']) ? json_encode($envelope['contentPatch']) : null,
            'encrypted_content_patch' => $this->extractEncryptedContent($envelope),
            'nonce' => (string) $envelope['nonce'],
            'client_timestamp' => $this->normalizeClientTimestamp($envelope['clientTimestamp'] ?? null),
            'created_at' => Str::now(),
        ]);

        $stmt = $this->pdo->prepare('SELECT * FROM sync_envelopes WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $id]);
        return $stmt->fetch() ?: [];
    }

    public function listEnvelopesAfter(string $userId, int $cursor, int $limit): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT server_sequence, device_id, device_sequence, entity, entity_id, operation,
                    metadata_patch_json, content_patch_json, encrypted_content_patch, nonce, client_timestamp, created_at
             FROM sync_envelopes
             WHERE user_id = :user_id AND server_sequence > :cursor
             ORDER BY server_sequence ASC
             LIMIT :limit'
        );
        $stmt->bindValue(':user_id', $userId);
        $stmt->bindValue(':cursor', $cursor, PDO::PARAM_INT);
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->execute();

        return array_map(static function (array $row): array {
            return [
                'serverSequence' => (int) $row['server_sequence'],
                'deviceId' => $row['device_id'],
                'deviceSequence' => (int) $row['device_sequence'],
                'entity' => $row['entity'],
                'entityId' => $row['entity_id'],
                'operation' => $row['operation'],
                'metadataPatch' => json_decode((string) $row['metadata_patch_json'], true) ?: [],
                'contentPatch' => json_decode((string) ($row['content_patch_json'] ?? ''), true) ?: null,
                'encryptedContent' => $row['encrypted_content_patch'],
                'nonce' => $row['nonce'],
                'clientTimestamp' => $row['client_timestamp'],
                'createdAt' => $row['created_at'],
            ];
        }, $stmt->fetchAll());
    }

    public function materializeEnvelope(string $userId, string $deviceId, string $calendarId, array $envelope): void
    {
        if (($envelope['entity'] ?? '') !== 'event') {
            return;
        }

        $metadata = is_array($envelope['metadataPatch'] ?? null) ? $envelope['metadataPatch'] : [];
        $contentPatch = is_array($envelope['contentPatch'] ?? null) ? $envelope['contentPatch'] : [];
        $eventId = (string) $envelope['entityId'];
        $now = Str::now();
        $existing = $this->findEventMetadata($eventId);
        $encryptedContent = $this->extractEncryptedContent($envelope);

        if (($envelope['operation'] ?? '') === 'delete') {
            $stmt = $this->pdo->prepare(
                'UPDATE events_metadata
                 SET deleted_at = :deleted_at, updated_at = :updated_at, version = version + 1, last_modified_by_device_id = :device_id
                 WHERE id = :id AND user_id = :user_id'
            );
            $stmt->execute([
                'deleted_at' => $now,
                'updated_at' => $now,
                'device_id' => $deviceId,
                'id' => $eventId,
                'user_id' => $userId,
            ]);
            return;
        }

        $record = [
            'id' => $eventId,
            'user_id' => $userId,
            'calendar_id' => (string) ($metadata['calendarId'] ?? $existing['calendar_id'] ?? $calendarId),
            'category_id' => $metadata['categoryId'] ?? ($existing['category_id'] ?? null),
            'starts_at' => $this->normalizeClientTimestamp($metadata['startsAt'] ?? $existing['starts_at'] ?? $now),
            'ends_at' => $this->normalizeClientTimestamp($metadata['endsAt'] ?? $existing['ends_at'] ?? $now),
            'is_all_day' => !empty($metadata['isAllDay']) ? 1 : (int) ($existing['is_all_day'] ?? 0),
            'visibility' => (string) ($metadata['visibility'] ?? $existing['visibility'] ?? 'private'),
            'status' => (string) ($metadata['status'] ?? $existing['status'] ?? 'confirmed'),
            'sync_policy' => (string) ($metadata['syncPolicy'] ?? $existing['sync_policy'] ?? 'internal_only'),
            'version' => (int) ($existing['version'] ?? 0) + 1,
            'last_modified_by_device_id' => $deviceId,
            'created_at' => $existing['created_at'] ?? $now,
            'updated_at' => $now,
            'deleted_at' => null,
        ];

        if ($existing) {
            $stmt = $this->pdo->prepare(
                'UPDATE events_metadata
                 SET calendar_id = :calendar_id, category_id = :category_id, starts_at = :starts_at, ends_at = :ends_at,
                     is_all_day = :is_all_day, visibility = :visibility, status = :status, sync_policy = :sync_policy,
                     version = :version, last_modified_by_device_id = :last_modified_by_device_id, updated_at = :updated_at, deleted_at = NULL
                 WHERE id = :id'
            );
        } else {
            $stmt = $this->pdo->prepare(
                'INSERT INTO events_metadata
                 (id, user_id, calendar_id, category_id, starts_at, ends_at, is_all_day, visibility, status, sync_policy, version, last_modified_by_device_id, created_at, updated_at, deleted_at)
                 VALUES
                 (:id, :user_id, :calendar_id, :category_id, :starts_at, :ends_at, :is_all_day, :visibility, :status, :sync_policy, :version, :last_modified_by_device_id, :created_at, :updated_at, :deleted_at)'
            );
        }
        $stmt->execute($record);

        if ($encryptedContent !== null || $contentPatch !== []) {
            $existingContent = $this->findEventContent($eventId);
            $materializedContent = array_merge(
                $this->decodeMaterializedJson((string) ($existingContent['materialized_json'] ?? '')),
                $contentPatch,
                [
                    'type' => (string) ($metadata['type'] ?? $contentPatch['type'] ?? 'meeting'),
                    'completed' => !empty($metadata['completed']) || !empty($contentPatch['completed']),
                    'repeat' => (string) ($metadata['repeat'] ?? $contentPatch['repeat'] ?? 'none'),
                    'hasDeadline' => !empty($metadata['hasDeadline']) || !empty($contentPatch['hasDeadline']),
                    'color' => (string) ($metadata['color'] ?? $contentPatch['color'] ?? '#4f9d69'),
                ]
            );

            if ($existingContent) {
                $stmt = $this->pdo->prepare(
                    'UPDATE event_content
                     SET encrypted_payload = :encrypted_payload,
                         materialized_json = :materialized_json,
                         key_version = :key_version,
                         updated_at = :updated_at
                     WHERE event_id = :event_id'
                );
            } else {
                $stmt = $this->pdo->prepare(
                    'INSERT INTO event_content (event_id, encrypted_payload, materialized_json, key_version, updated_at)
                     VALUES (:event_id, :encrypted_payload, :materialized_json, :key_version, :updated_at)'
                );
            }

            $stmt->execute([
                'event_id' => $eventId,
                'encrypted_payload' => $encryptedContent ?? '{}',
                'materialized_json' => json_encode($materializedContent),
                'key_version' => (int) ($metadata['keyVersion'] ?? 1),
                'updated_at' => $now,
            ]);
        }
    }

    public function appendAuditLog(?string $userId, ?string $deviceId, string $action, ?string $targetType, ?string $targetId, ?string $ipAddress, array $metadata = []): void
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO audit_log (id, user_id, device_id, action, target_type, target_id, ip_address, metadata_json, created_at)
             VALUES (:id, :user_id, :device_id, :action, :target_type, :target_id, :ip_address, :metadata_json, :created_at)'
        );
        $stmt->execute([
            'id' => Str::uuid(),
            'user_id' => $userId,
            'device_id' => $deviceId,
            'action' => $action,
            'target_type' => $targetType,
            'target_id' => $targetId,
            'ip_address' => $ipAddress,
            'metadata_json' => $metadata === [] ? null : json_encode($metadata),
            'created_at' => Str::now(),
        ]);
    }

    public function getMaxDeviceSequence(string $deviceId): int
    {
        $stmt = $this->pdo->prepare(
            'SELECT COALESCE(MAX(device_sequence), 0) AS max_sequence
             FROM sync_envelopes
             WHERE device_id = :device_id'
        );
        $stmt->execute(['device_id' => $deviceId]);
        return (int) (($stmt->fetch()['max_sequence'] ?? 0));
    }

    public function exportBundle(string $userId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT
                m.id,
                m.starts_at,
                m.ends_at,
                m.is_all_day,
                m.visibility,
                m.status,
                m.sync_policy,
                c.materialized_json
             FROM events_metadata m
             LEFT JOIN event_content c ON c.event_id = m.id
             WHERE m.user_id = :user_id AND m.deleted_at IS NULL
             ORDER BY m.starts_at ASC'
        );
        $stmt->execute(['user_id' => $userId]);
        $rows = $stmt->fetchAll();

        $events = [];
        $tagMap = [];
        foreach ($rows as $row) {
            $content = $this->decodeMaterializedJson((string) ($row['materialized_json'] ?? ''));
            $event = [
                'id' => $row['id'],
                'title' => (string) ($content['title'] ?? 'Imported event'),
                'description' => (string) ($content['description'] ?? ''),
                'type' => (string) ($content['type'] ?? 'meeting'),
                'completed' => !empty($content['completed']),
                'repeat' => (string) ($content['repeat'] ?? 'none'),
                'hasDeadline' => !empty($content['hasDeadline']),
                'groupName' => (string) ($content['groupName'] ?? ''),
                'location' => (string) ($content['location'] ?? ''),
                'people' => is_array($content['people'] ?? null) ? $content['people'] : [],
                'sourceTimeZone' => (string) ($content['sourceTimeZone'] ?? ''),
                'startsAt' => $this->normalizeDatabaseTimestamp((string) $row['starts_at']),
                'endsAt' => $this->normalizeDatabaseTimestamp((string) $row['ends_at']),
                'isAllDay' => !empty($row['is_all_day']),
                'reminderMinutesBeforeStart' => $content['reminderMinutesBeforeStart'] ?? null,
                'desktopNotificationEnabled' => !empty($content['desktopNotificationEnabled']),
                'emailNotificationEnabled' => !empty($content['emailNotificationEnabled']),
                'emailNotificationRecipients' =>
                    is_array($content['emailNotificationRecipients'] ?? null)
                        ? $content['emailNotificationRecipients']
                        : [],
                'notifications' => is_array($content['notifications'] ?? null) ? $content['notifications'] : [],
                'color' => (string) ($content['color'] ?? '#4f9d69'),
                'tags' => is_array($content['tags'] ?? null) ? $content['tags'] : [],
                'syncPolicy' => (string) ($row['sync_policy'] ?? 'internal_only'),
                'visibility' => (string) ($row['visibility'] ?? 'private'),
                'externalProviderLinks' =>
                    is_array($content['externalProviderLinks'] ?? null)
                        ? $content['externalProviderLinks']
                        : [],
            ];
            $events[] = $event;

            foreach ($event['tags'] as $tag) {
                $label = strtolower(trim((string) ($tag['label'] ?? '')));
                if ($label === '') {
                    continue;
                }
                $tagMap[$label] = $tag;
            }
        }

        return [
            'version' => 'calendar-bundle-v1',
            'exportedAt' => gmdate(DATE_ATOM),
            'deviceId' => null,
            'lastSequence' => $this->getCurrentServerSequence($userId),
            'events' => $events,
            'tags' => array_values($tagMap),
            'externalCalendarSources' => [],
            'externalEventLinks' => [],
        ];
    }

    public function importBundle(string $userId, string $deviceId, array $bundle): array
    {
        if (($bundle['version'] ?? '') !== 'calendar-bundle-v1') {
            throw new \RuntimeException('Unsupported calendar bundle version.');
        }

        $calendar = $this->ensureDefaultCalendar($userId, 'UTC');
        $acceptedCount = 0;
        $deviceSequence = $this->getMaxDeviceSequence($deviceId);

        $this->transaction(function () use ($userId, $deviceId, $bundle, $calendar, &$acceptedCount, &$deviceSequence): void {
            foreach (($bundle['events'] ?? []) as $event) {
                $deviceSequence += 1;
                $contentPatch = [
                    'title' => (string) ($event['title'] ?? 'Imported event'),
                    'description' => (string) ($event['description'] ?? ''),
                    'groupName' => (string) ($event['groupName'] ?? ''),
                    'location' => (string) ($event['location'] ?? ''),
                    'people' => is_array($event['people'] ?? null) ? $event['people'] : [],
                    'sourceTimeZone' => (string) ($event['sourceTimeZone'] ?? ''),
                    'reminderMinutesBeforeStart' => $event['reminderMinutesBeforeStart'] ?? null,
                    'desktopNotificationEnabled' => !empty($event['desktopNotificationEnabled']),
                    'emailNotificationEnabled' => !empty($event['emailNotificationEnabled']),
                    'emailNotificationRecipients' =>
                        is_array($event['emailNotificationRecipients'] ?? null)
                            ? $event['emailNotificationRecipients']
                            : [],
                    'notifications' => is_array($event['notifications'] ?? null) ? $event['notifications'] : [],
                    'tags' => is_array($event['tags'] ?? null) ? $event['tags'] : [],
                    'externalProviderLinks' =>
                        is_array($event['externalProviderLinks'] ?? null)
                            ? $event['externalProviderLinks']
                            : [],
                ];

                $envelope = [
                    'deviceId' => $deviceId,
                    'deviceSequence' => $deviceSequence,
                    'entity' => 'event',
                    'entityId' => (string) ($event['id'] ?? Str::uuid()),
                    'operation' => 'update',
                    'metadataPatch' => [
                        'calendarId' => $calendar['id'],
                        'startsAt' => (string) ($event['startsAt'] ?? gmdate(DATE_ATOM)),
                        'endsAt' => (string) ($event['endsAt'] ?? gmdate(DATE_ATOM)),
                        'isAllDay' => !empty($event['isAllDay']),
                        'visibility' => (string) ($event['visibility'] ?? 'private'),
                        'status' => 'confirmed',
                        'syncPolicy' => (string) ($event['syncPolicy'] ?? 'internal_only'),
                    ],
                    'contentPatch' => $contentPatch,
                    'nonce' => Str::randomToken(12),
                    'clientTimestamp' => gmdate(DATE_ATOM),
                ];

                $this->insertEnvelope($userId, $deviceId, $envelope);
                $this->materializeEnvelope($userId, $deviceId, $calendar['id'], $envelope);
                $acceptedCount += 1;
            }
        });

        return [
            'acceptedCount' => $acceptedCount,
            'latestServerCursor' => $this->getCurrentServerSequence($userId),
        ];
    }

    private function findEventMetadata(string $eventId): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM events_metadata WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $eventId]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    private function findEventContent(string $eventId): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM event_content WHERE event_id = :event_id LIMIT 1');
        $stmt->execute(['event_id' => $eventId]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    private function decodeMaterializedJson(string $value): array
    {
        if ($value === '') {
            return [];
        }

        $decoded = json_decode($value, true);
        return is_array($decoded) ? $decoded : [];
    }

    private function normalizeClientTimestamp(?string $value): string
    {
        if ($value === null || $value === '') {
            return Str::now();
        }

        try {
            return (new \DateTimeImmutable($value))->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s.u');
        } catch (\Throwable) {
            return Str::now();
        }
    }

    private function normalizeDatabaseTimestamp(string $value): string
    {
        try {
            return (new \DateTimeImmutable($value, new \DateTimeZone('UTC')))->format(DATE_ATOM);
        } catch (\Throwable) {
            return gmdate(DATE_ATOM);
        }
    }

    private function extractEncryptedContent(array $envelope): ?string
    {
        $contentPatch = $envelope['contentPatch'] ?? null;
        if (is_string($envelope['encryptedContent'] ?? null)) {
            return $envelope['encryptedContent'];
        }

        if (is_string($envelope['encryptedPatch'] ?? null)) {
            return $envelope['encryptedPatch'];
        }

        if (is_array($contentPatch)) {
            $candidate = $contentPatch['encryptedPayload'] ?? $contentPatch['cipherText'] ?? null;
            return is_string($candidate) ? $candidate : null;
        }

        return is_string($contentPatch) ? $contentPatch : null;
    }
}
