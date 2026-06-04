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
            'users',
            'display_name',
            'ALTER TABLE users ADD COLUMN display_name VARCHAR(160) NULL AFTER password_hash'
        );
        $this->ensureColumn(
            'users',
            'role',
            "ALTER TABLE users ADD COLUMN role VARCHAR(24) NOT NULL DEFAULT 'member' AFTER display_name"
        );
        $this->pdo->exec(
            "CREATE TABLE IF NOT EXISTS install_settings (
                id TINYINT UNSIGNED PRIMARY KEY DEFAULT 1,
                organization_name VARCHAR(160) NOT NULL DEFAULT 'SelfHdb',
                admin_user_id CHAR(36) NULL,
                installed_at DATETIME(6) NOT NULL,
                created_at DATETIME(6) NOT NULL,
                updated_at DATETIME(6) NOT NULL,
                CONSTRAINT fk_install_settings_admin FOREIGN KEY (admin_user_id) REFERENCES users(id) ON DELETE SET NULL
            )"
        );
        $this->pdo->exec(
            "CREATE TABLE IF NOT EXISTS calendar_shares (
                id CHAR(36) PRIMARY KEY,
                user_id CHAR(36) NOT NULL,
                name VARCHAR(160) NOT NULL,
                public_token VARCHAR(128) NULL,
                token_hash CHAR(64) NOT NULL UNIQUE,
                access_mode VARCHAR(24) NOT NULL DEFAULT 'link',
                privacy_level VARCHAR(32) NOT NULL DEFAULT 'busy_only',
                scope_json JSON NOT NULL,
                projection_json LONGTEXT NULL,
                projection_updated_at DATETIME(6) NULL,
                expires_at DATETIME(6) NULL,
                revoked_at DATETIME(6) NULL,
                last_accessed_at DATETIME(6) NULL,
                created_at DATETIME(6) NOT NULL,
                updated_at DATETIME(6) NOT NULL,
                CONSTRAINT fk_calendar_shares_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_calendar_shares_user_updated (user_id, updated_at),
                INDEX idx_calendar_shares_token_hash (token_hash)
            )"
        );
        $this->ensureColumn(
            'calendar_shares',
            'public_token',
            'ALTER TABLE calendar_shares ADD COLUMN public_token VARCHAR(128) NULL AFTER name'
        );
        $this->ensureColumn(
            'calendar_shares',
            'access_mode',
            "ALTER TABLE calendar_shares ADD COLUMN access_mode VARCHAR(24) NOT NULL DEFAULT 'link' AFTER token_hash"
        );
        $this->pdo->exec(
            "CREATE TABLE IF NOT EXISTS invite_keys (
                id CHAR(36) PRIMARY KEY,
                code_hash CHAR(64) NOT NULL UNIQUE,
                label VARCHAR(160) NOT NULL,
                role VARCHAR(24) NOT NULL DEFAULT 'member',
                max_uses INT UNSIGNED NULL,
                use_count INT UNSIGNED NOT NULL DEFAULT 0,
                expires_at DATETIME(6) NULL,
                revoked_at DATETIME(6) NULL,
                last_used_at DATETIME(6) NULL,
                created_by_user_id CHAR(36) NULL,
                created_at DATETIME(6) NOT NULL,
                updated_at DATETIME(6) NOT NULL,
                CONSTRAINT fk_invite_keys_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
                INDEX idx_invite_keys_updated (updated_at)
            )"
        );
        $this->pdo->exec(
            "CREATE TABLE IF NOT EXISTS invite_key_uses (
                id CHAR(36) PRIMARY KEY,
                invite_key_id CHAR(36) NOT NULL,
                user_id CHAR(36) NOT NULL,
                ip_address VARCHAR(64) NULL,
                used_at DATETIME(6) NOT NULL,
                CONSTRAINT fk_invite_key_uses_key FOREIGN KEY (invite_key_id) REFERENCES invite_keys(id) ON DELETE CASCADE,
                CONSTRAINT fk_invite_key_uses_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_invite_key_uses_key (invite_key_id)
            )"
        );
        $this->pdo->exec(
            "CREATE TABLE IF NOT EXISTS calendar_share_recipients (
                id CHAR(36) PRIMARY KEY,
                share_id CHAR(36) NOT NULL,
                recipient_user_id CHAR(36) NULL,
                email VARCHAR(190) NULL,
                access_level VARCHAR(24) NOT NULL DEFAULT 'read',
                revoked_at DATETIME(6) NULL,
                last_accessed_at DATETIME(6) NULL,
                created_at DATETIME(6) NOT NULL,
                updated_at DATETIME(6) NOT NULL,
                CONSTRAINT fk_calendar_share_recipients_share FOREIGN KEY (share_id) REFERENCES calendar_shares(id) ON DELETE CASCADE,
                CONSTRAINT fk_calendar_share_recipients_user FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE SET NULL,
                INDEX idx_calendar_share_recipients_user (recipient_user_id),
                INDEX idx_calendar_share_recipients_email (email)
            )"
        );
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

    public function createUser(string $email, string $passwordHash, string $displayName = '', string $role = 'member'): array
    {
        $now = Str::now();
        $id = Str::uuid();
        $role = $this->normalizeUserRole($role);
        $stmt = $this->pdo->prepare(
            'INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at)
             VALUES (:id, :email, :password_hash, :display_name, :role, :created_at, :updated_at)'
        );
        $stmt->execute([
            'id' => $id,
            'email' => strtolower($email),
            'password_hash' => $passwordHash,
            'display_name' => trim($displayName) !== '' ? substr(trim($displayName), 0, 160) : null,
            'role' => $role,
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

    public function getInstallSettings(): ?array
    {
        $stmt = $this->pdo->query('SELECT * FROM install_settings WHERE id = 1 LIMIT 1');
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function isInstalled(): bool
    {
        if ($this->getInstallSettings()) {
            return true;
        }

        return $this->countAdmins() > 0;
    }

    public function saveInstallSettings(string $organizationName, string $adminUserId): array
    {
        $now = Str::now();
        $name = trim($organizationName) !== '' ? substr(trim($organizationName), 0, 160) : 'SelfHdb';
        $stmt = $this->pdo->prepare(
            'INSERT INTO install_settings (id, organization_name, admin_user_id, installed_at, created_at, updated_at)
             VALUES (1, :organization_name, :admin_user_id, :installed_at, :created_at, :updated_at)
             ON DUPLICATE KEY UPDATE
                organization_name = VALUES(organization_name),
                admin_user_id = VALUES(admin_user_id),
                updated_at = VALUES(updated_at)'
        );
        $stmt->execute([
            'organization_name' => $name,
            'admin_user_id' => $adminUserId,
            'installed_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return $this->getInstallSettings() ?? [];
    }

    public function countUsers(): int
    {
        $stmt = $this->pdo->query('SELECT COUNT(*) AS user_count FROM users');
        return (int) (($stmt->fetch()['user_count'] ?? 0));
    }

    public function countAdmins(): int
    {
        $stmt = $this->pdo->query("SELECT COUNT(*) AS admin_count FROM users WHERE role = 'admin' AND is_active = 1");
        return (int) (($stmt->fetch()['admin_count'] ?? 0));
    }

    public function listUsers(): array
    {
        $stmt = $this->pdo->query(
            'SELECT id, email, display_name, role, is_active, created_at, updated_at
             FROM users ORDER BY created_at DESC'
        );
        return $stmt->fetchAll();
    }

    public function updateUserFromAdmin(string $targetUserId, array $input): array
    {
        $user = $this->findUserById($targetUserId);
        if (!$user) {
            throw new \RuntimeException('User was not found.');
        }

        $displayName = array_key_exists('displayName', $input)
            ? (trim((string) $input['displayName']) ?: null)
            : $user['display_name'];
        $role = array_key_exists('role', $input)
            ? $this->normalizeUserRole((string) $input['role'])
            : (string) ($user['role'] ?? 'member');
        $isActive = array_key_exists('isActive', $input)
            ? (!empty($input['isActive']) ? 1 : 0)
            : (int) ($user['is_active'] ?? 1);

        $stmt = $this->pdo->prepare(
            'UPDATE users
             SET display_name = :display_name, role = :role, is_active = :is_active, updated_at = :updated_at
             WHERE id = :id'
        );
        $stmt->execute([
            'id' => $targetUserId,
            'display_name' => $displayName !== null ? substr($displayName, 0, 160) : null,
            'role' => $role,
            'is_active' => $isActive,
            'updated_at' => Str::now(),
        ]);

        return $this->findUserById($targetUserId) ?? [];
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

    public function createInviteKey(string $createdByUserId, array $input): array
    {
        $now = Str::now();
        $id = Str::uuid();
        $code = Str::randomToken(18);
        $label = trim((string) ($input['label'] ?? 'Invite key')) ?: 'Invite key';
        $role = $this->normalizeUserRole((string) ($input['role'] ?? 'member'));
        $maxUses = isset($input['maxUses']) && $input['maxUses'] !== ''
            ? max(1, (int) $input['maxUses'])
            : null;
        $expiresAt = $this->normalizeNullableTimestamp($input['expiresAt'] ?? null);

        $stmt = $this->pdo->prepare(
            'INSERT INTO invite_keys
             (id, code_hash, label, role, max_uses, expires_at, created_by_user_id, created_at, updated_at)
             VALUES
             (:id, :code_hash, :label, :role, :max_uses, :expires_at, :created_by_user_id, :created_at, :updated_at)'
        );
        $stmt->execute([
            'id' => $id,
            'code_hash' => Str::hashToken($code),
            'label' => substr($label, 0, 160),
            'role' => $role,
            'max_uses' => $maxUses,
            'expires_at' => $expiresAt,
            'created_by_user_id' => $createdByUserId,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return [
            ...$this->formatInviteKey($this->findInviteKeyById($id) ?? []),
            'code' => $code,
        ];
    }

    public function listInviteKeys(): array
    {
        $stmt = $this->pdo->query(
            'SELECT * FROM invite_keys ORDER BY updated_at DESC, created_at DESC'
        );

        return array_map(fn (array $row): array => $this->formatInviteKey($row), $stmt->fetchAll());
    }

    public function findInviteKeyById(string $inviteKeyId): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM invite_keys WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $inviteKeyId]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function findActiveInviteKeyByCode(string $code): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM invite_keys WHERE code_hash = :code_hash LIMIT 1');
        $stmt->execute(['code_hash' => Str::hashToken($code)]);
        $invite = $stmt->fetch();
        if (!$invite || $invite['revoked_at'] !== null) {
            return null;
        }

        if ($invite['expires_at'] && strtotime((string) $invite['expires_at']) <= time()) {
            return null;
        }

        if ($invite['max_uses'] !== null && (int) $invite['use_count'] >= (int) $invite['max_uses']) {
            return null;
        }

        return $invite;
    }

    public function consumeInviteKey(string $code, string $userId, string $ipAddress): array
    {
        $invite = $this->findActiveInviteKeyByCode($code);
        if (!$invite) {
            throw new \RuntimeException('Invite key is invalid, expired, or fully used.');
        }

        $now = Str::now();
        $stmt = $this->pdo->prepare(
            'UPDATE invite_keys
             SET use_count = use_count + 1, last_used_at = :last_used_at, updated_at = :updated_at
             WHERE id = :id'
        );
        $stmt->execute([
            'id' => $invite['id'],
            'last_used_at' => $now,
            'updated_at' => $now,
        ]);

        $stmt = $this->pdo->prepare(
            'INSERT INTO invite_key_uses (id, invite_key_id, user_id, ip_address, used_at)
             VALUES (:id, :invite_key_id, :user_id, :ip_address, :used_at)'
        );
        $stmt->execute([
            'id' => Str::uuid(),
            'invite_key_id' => $invite['id'],
            'user_id' => $userId,
            'ip_address' => $ipAddress,
            'used_at' => $now,
        ]);

        return $invite;
    }

    public function revokeInviteKey(string $inviteKeyId): array
    {
        $invite = $this->findInviteKeyById($inviteKeyId);
        if (!$invite) {
            throw new \RuntimeException('Invite key was not found.');
        }

        $stmt = $this->pdo->prepare(
            'UPDATE invite_keys SET revoked_at = :revoked_at, updated_at = :updated_at WHERE id = :id'
        );
        $stmt->execute([
            'id' => $inviteKeyId,
            'revoked_at' => Str::now(),
            'updated_at' => Str::now(),
        ]);

        return $this->formatInviteKey($this->findInviteKeyById($inviteKeyId) ?? []);
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

    public function listAuditLog(int $limit = 80): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT a.id, a.user_id, u.email, a.device_id, a.action, a.target_type, a.target_id,
                    a.ip_address, a.metadata_json, a.created_at
             FROM audit_log a
             LEFT JOIN users u ON u.id = a.user_id
             ORDER BY a.created_at DESC
             LIMIT :limit'
        );
        $stmt->bindValue(':limit', max(1, min(200, $limit)), PDO::PARAM_INT);
        $stmt->execute();

        return array_map(fn (array $row): array => [
            'id' => $row['id'],
            'userId' => $row['user_id'],
            'email' => $row['email'],
            'deviceId' => $row['device_id'],
            'action' => $row['action'],
            'targetType' => $row['target_type'],
            'targetId' => $row['target_id'],
            'ipAddress' => $row['ip_address'],
            'metadata' => $this->decodeMaterializedJson((string) ($row['metadata_json'] ?? '')),
            'createdAt' => $row['created_at'],
        ], $stmt->fetchAll());
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

    public function createCalendarShare(string $userId, array $input): array
    {
        $now = Str::now();
        $id = Str::uuid();
        $token = Str::randomToken(32);
        $name = trim((string) ($input['name'] ?? 'Shared calendar')) ?: 'Shared calendar';
        $scope = is_array($input['scope'] ?? null) ? $input['scope'] : [];
        $accessMode = $this->normalizeShareAccessMode((string) ($input['accessMode'] ?? 'link'));
        $privacyLevel = $this->normalizeSharePrivacyLevel((string) ($input['privacyLevel'] ?? 'busy_only'));
        $expiresAt = $this->normalizeNullableTimestamp($input['expiresAt'] ?? null);

        $stmt = $this->pdo->prepare(
            'INSERT INTO calendar_shares
             (id, user_id, name, public_token, token_hash, access_mode, privacy_level, scope_json, expires_at, created_at, updated_at)
             VALUES
             (:id, :user_id, :name, :public_token, :token_hash, :access_mode, :privacy_level, :scope_json, :expires_at, :created_at, :updated_at)'
        );
        $stmt->execute([
            'id' => $id,
            'user_id' => $userId,
            'name' => substr($name, 0, 160),
            'public_token' => $token,
            'token_hash' => Str::hashToken($token),
            'access_mode' => $accessMode,
            'privacy_level' => $privacyLevel,
            'scope_json' => json_encode($scope),
            'expires_at' => $expiresAt,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        return [
            ...$this->formatCalendarShare($this->findCalendarShareForUser($userId, $id) ?? []),
            'token' => $token,
        ];
    }

    public function listCalendarShares(string $userId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT * FROM calendar_shares WHERE user_id = :user_id ORDER BY updated_at DESC'
        );
        $stmt->execute(['user_id' => $userId]);

        return array_map(fn (array $row): array => $this->formatCalendarShare($row), $stmt->fetchAll());
    }

    public function findCalendarShareForUser(string $userId, string $shareId): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT * FROM calendar_shares WHERE user_id = :user_id AND id = :id LIMIT 1'
        );
        $stmt->execute(['user_id' => $userId, 'id' => $shareId]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function updateCalendarShare(string $userId, string $shareId, array $input): array
    {
        $share = $this->findCalendarShareForUser($userId, $shareId);
        if (!$share) {
            throw new \RuntimeException('Share link was not found.');
        }

        $name = array_key_exists('name', $input)
            ? (trim((string) $input['name']) ?: $share['name'])
            : $share['name'];
        $privacyLevel = array_key_exists('privacyLevel', $input)
            ? $this->normalizeSharePrivacyLevel((string) $input['privacyLevel'])
            : (string) $share['privacy_level'];
        $accessMode = array_key_exists('accessMode', $input)
            ? $this->normalizeShareAccessMode((string) $input['accessMode'])
            : (string) ($share['access_mode'] ?? 'link');
        $scope = array_key_exists('scope', $input) && is_array($input['scope'])
            ? $input['scope']
            : $this->decodeMaterializedJson((string) $share['scope_json']);
        $expiresAt = array_key_exists('expiresAt', $input)
            ? $this->normalizeNullableTimestamp($input['expiresAt'])
            : $share['expires_at'];

        $stmt = $this->pdo->prepare(
            'UPDATE calendar_shares
             SET name = :name, access_mode = :access_mode, privacy_level = :privacy_level, scope_json = :scope_json,
                 expires_at = :expires_at, updated_at = :updated_at
             WHERE id = :id AND user_id = :user_id'
        );
        $stmt->execute([
            'id' => $shareId,
            'user_id' => $userId,
            'name' => substr($name, 0, 160),
            'access_mode' => $accessMode,
            'privacy_level' => $privacyLevel,
            'scope_json' => json_encode($scope),
            'expires_at' => $expiresAt,
            'updated_at' => Str::now(),
        ]);

        return $this->formatCalendarShare($this->findCalendarShareForUser($userId, $shareId) ?? []);
    }

    public function publishCalendarShareProjection(string $userId, string $shareId, array $projection): array
    {
        $share = $this->findCalendarShareForUser($userId, $shareId);
        if (!$share) {
            throw new \RuntimeException('Share link was not found.');
        }

        $now = Str::now();
        $stmt = $this->pdo->prepare(
            'UPDATE calendar_shares
             SET projection_json = :projection_json, projection_updated_at = :projection_updated_at,
                 updated_at = :updated_at
             WHERE id = :id AND user_id = :user_id'
        );
        $stmt->execute([
            'id' => $shareId,
            'user_id' => $userId,
            'projection_json' => json_encode($projection),
            'projection_updated_at' => $now,
            'updated_at' => $now,
        ]);

        return $this->formatCalendarShare($this->findCalendarShareForUser($userId, $shareId) ?? []);
    }

    public function revokeCalendarShare(string $userId, string $shareId): array
    {
        $share = $this->findCalendarShareForUser($userId, $shareId);
        if (!$share) {
            throw new \RuntimeException('Share link was not found.');
        }

        $now = Str::now();
        $stmt = $this->pdo->prepare(
            'UPDATE calendar_shares SET revoked_at = :revoked_at, updated_at = :updated_at WHERE id = :id AND user_id = :user_id'
        );
        $stmt->execute([
            'id' => $shareId,
            'user_id' => $userId,
            'revoked_at' => $now,
            'updated_at' => $now,
        ]);

        return $this->formatCalendarShare($this->findCalendarShareForUser($userId, $shareId) ?? []);
    }

    public function rotateCalendarShareToken(string $userId, string $shareId): array
    {
        $share = $this->findCalendarShareForUser($userId, $shareId);
        if (!$share) {
            throw new \RuntimeException('Share link was not found.');
        }

        $token = Str::randomToken(32);
        $stmt = $this->pdo->prepare(
            'UPDATE calendar_shares
             SET public_token = :public_token, token_hash = :token_hash, updated_at = :updated_at
             WHERE id = :id AND user_id = :user_id'
        );
        $stmt->execute([
            'id' => $shareId,
            'user_id' => $userId,
            'public_token' => $token,
            'token_hash' => Str::hashToken($token),
            'updated_at' => Str::now(),
        ]);

        return [
            ...$this->formatCalendarShare($this->findCalendarShareForUser($userId, $shareId) ?? []),
            'token' => $token,
        ];
    }

    public function replaceCalendarShareRecipients(string $userId, string $shareId, array $recipients): array
    {
        $share = $this->findCalendarShareForUser($userId, $shareId);
        if (!$share) {
            throw new \RuntimeException('Share link was not found.');
        }

        $now = Str::now();
        $this->pdo
            ->prepare('UPDATE calendar_share_recipients SET revoked_at = :revoked_at, updated_at = :updated_at WHERE share_id = :share_id AND revoked_at IS NULL')
            ->execute(['share_id' => $shareId, 'revoked_at' => $now, 'updated_at' => $now]);

        $seen = [];
        foreach ($recipients as $recipient) {
            $email = strtolower(trim((string) (is_array($recipient) ? ($recipient['email'] ?? '') : $recipient)));
            if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || isset($seen[$email])) {
                continue;
            }
            $seen[$email] = true;
            $recipientUser = $this->findUserByEmail($email);
            $stmt = $this->pdo->prepare(
                'INSERT INTO calendar_share_recipients
                 (id, share_id, recipient_user_id, email, access_level, created_at, updated_at)
                 VALUES (:id, :share_id, :recipient_user_id, :email, :access_level, :created_at, :updated_at)'
            );
            $stmt->execute([
                'id' => Str::uuid(),
                'share_id' => $shareId,
                'recipient_user_id' => $recipientUser['id'] ?? null,
                'email' => $email,
                'access_level' => 'read',
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }

        return $this->listCalendarShareRecipients($userId, $shareId);
    }

    public function listCalendarShareRecipients(string $userId, string $shareId): array
    {
        $share = $this->findCalendarShareForUser($userId, $shareId);
        if (!$share) {
            throw new \RuntimeException('Share link was not found.');
        }

        $stmt = $this->pdo->prepare(
            'SELECT id, recipient_user_id, email, access_level, revoked_at, last_accessed_at, created_at, updated_at
             FROM calendar_share_recipients
             WHERE share_id = :share_id
             ORDER BY created_at DESC'
        );
        $stmt->execute(['share_id' => $shareId]);

        return array_map(static fn (array $row): array => [
            'id' => $row['id'],
            'recipientUserId' => $row['recipient_user_id'],
            'email' => $row['email'],
            'accessLevel' => $row['access_level'],
            'revokedAt' => $row['revoked_at'],
            'lastAccessedAt' => $row['last_accessed_at'],
            'createdAt' => $row['created_at'],
            'updatedAt' => $row['updated_at'],
        ], $stmt->fetchAll());
    }

    public function getPublicCalendarShare(string $token): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM calendar_shares WHERE token_hash = :token_hash LIMIT 1');
        $stmt->execute(['token_hash' => Str::hashToken($token)]);
        $share = $stmt->fetch();
        if (!$share || $share['revoked_at']) {
            return null;
        }

        if (($share['access_mode'] ?? 'link') === 'org') {
            return null;
        }

        if ($share['expires_at'] && strtotime((string) $share['expires_at']) <= time()) {
            return null;
        }

        $this->pdo
            ->prepare('UPDATE calendar_shares SET last_accessed_at = :last_accessed_at WHERE id = :id')
            ->execute(['last_accessed_at' => Str::now(), 'id' => $share['id']]);

        return [
            'id' => $share['id'],
            'name' => $share['name'],
            'privacyLevel' => $share['privacy_level'],
            'accessMode' => $share['access_mode'] ?? 'link',
            'projectionUpdatedAt' => $share['projection_updated_at'],
            'calendar' => $this->buildShareProjection($share),
        ];
    }

    public function listSharesForRecipient(string $userId, string $email): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT s.*, r.id AS recipient_row_id
             FROM calendar_share_recipients r
             JOIN calendar_shares s ON s.id = r.share_id
             WHERE r.revoked_at IS NULL
               AND s.revoked_at IS NULL
               AND (r.recipient_user_id = :user_id OR LOWER(r.email) = :email)
             ORDER BY s.updated_at DESC'
        );
        $stmt->execute([
            'user_id' => $userId,
            'email' => strtolower($email),
        ]);

        return array_map(fn (array $share): array => [
            ...$this->formatCalendarShare($share),
            'calendar' => $this->buildShareProjection($share),
        ], $stmt->fetchAll());
    }

    public function buildShareProjection(array $share): array
    {
        $scope = $this->decodeMaterializedJson((string) ($share['scope_json'] ?? ''));
        $privacyLevel = $this->normalizeSharePrivacyLevel((string) ($share['privacy_level'] ?? 'busy_only'));
        $privateMode = $this->normalizePrivateShareMode((string) ($scope['privateMode'] ?? 'busy'));
        $includedCalendarIds = array_values(array_filter(array_map('strval', $scope['calendarIds'] ?? [])));
        $includeAllCalendars = $includedCalendarIds === [];
        $calendarSet = array_flip($includedCalendarIds);
        $dateFrom = $this->normalizeNullableTimestamp($scope['dateFrom'] ?? null);
        $dateTo = $this->normalizeNullableTimestamp($scope['dateTo'] ?? null);

        $clauses = ['m.user_id = :user_id', 'm.deleted_at IS NULL'];
        $params = ['user_id' => $share['user_id']];
        if ($dateFrom !== null) {
            $clauses[] = 'm.ends_at >= :date_from';
            $params['date_from'] = $dateFrom;
        }
        if ($dateTo !== null) {
            $clauses[] = 'm.starts_at <= :date_to';
            $params['date_to'] = $dateTo;
        }

        $stmt = $this->pdo->prepare(
            'SELECT
                m.id,
                m.calendar_id,
                m.starts_at,
                m.ends_at,
                m.is_all_day,
                m.visibility,
                m.status,
                m.sync_policy,
                c.materialized_json
             FROM events_metadata m
             LEFT JOIN event_content c ON c.event_id = m.id
             WHERE ' . implode(' AND ', $clauses) . '
             ORDER BY m.starts_at ASC'
        );
        $stmt->execute($params);

        $events = [];
        $calendarIds = [];
        foreach ($stmt->fetchAll() as $row) {
            $content = $this->decodeMaterializedJson((string) ($row['materialized_json'] ?? ''));
            $calendarId = $this->resolveShareCalendarId($row, $content);
            if (!$includeAllCalendars && !isset($calendarSet[$calendarId])) {
                continue;
            }

            $isPrivate = $this->isPrivateShareEvent($row);
            if ($isPrivate && $privateMode === 'hide') {
                continue;
            }

            $eventPrivacyLevel = $isPrivate && $privateMode !== 'details' ? 'busy_only' : $privacyLevel;
            $events[] = $this->sanitizeShareEvent($row, $content, $eventPrivacyLevel, $calendarId);
            $calendarIds[$calendarId] = true;
        }

        $calendars = $this->buildShareCalendars($scope, array_keys($calendarIds), $includeAllCalendars);

        return [
            'version' => 'calendar-share-v1',
            'generatedAt' => gmdate(DATE_ATOM),
            'privacyLevel' => $privacyLevel,
            'privateMode' => $privateMode,
            'scope' => [
                'calendarIds' => $includedCalendarIds,
                'dateFrom' => $scope['dateFrom'] ?? null,
                'dateTo' => $scope['dateTo'] ?? null,
                'privateMode' => $privateMode,
            ],
            'calendars' => $calendars,
            'events' => $events,
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

    private function normalizeUserRole(string $value): string
    {
        $normalized = strtolower(trim($value));
        return in_array($normalized, ['admin', 'member'], true) ? $normalized : 'member';
    }

    private function normalizeShareAccessMode(string $value): string
    {
        $normalized = strtolower(trim($value));
        return in_array($normalized, ['link', 'org', 'link_org'], true) ? $normalized : 'link';
    }

    private function normalizeSharePrivacyLevel(string $value): string
    {
        $normalized = strtolower(trim($value));
        return in_array($normalized, ['busy_only', 'titles_only', 'full_details'], true)
            ? $normalized
            : 'busy_only';
    }

    private function normalizePrivateShareMode(string $value): string
    {
        $normalized = strtolower(trim($value));
        return in_array($normalized, ['busy', 'hide', 'details'], true) ? $normalized : 'busy';
    }

    private function isPrivateShareEvent(array $row): bool
    {
        return ($row['visibility'] ?? '') === 'private' || ($row['sync_policy'] ?? '') === 'internal_only';
    }

    private function resolveShareCalendarId(array $row, array $content): string
    {
        foreach (($content['externalProviderLinks'] ?? []) as $link) {
            $sourceId = trim((string) ($link['sourceId'] ?? ''));
            if ($sourceId !== '') {
                return $sourceId;
            }
        }

        return 'local';
    }

    private function sanitizeShareEvent(array $row, array $content, string $privacyLevel, string $calendarId): array
    {
        $base = [
            'id' => $row['id'],
            'startsAt' => $this->normalizeDatabaseTimestamp((string) $row['starts_at']),
            'endsAt' => $this->normalizeDatabaseTimestamp((string) $row['ends_at']),
            'isAllDay' => !empty($row['is_all_day']),
            'calendarId' => $calendarId,
            'color' => $privacyLevel === 'busy_only' ? '#111827' : (string) ($content['color'] ?? '#4f9d69'),
        ];

        if ($privacyLevel === 'busy_only') {
            return [
                ...$base,
                'title' => 'Busy',
                'visibility' => 'busy_only',
            ];
        }

        if ($privacyLevel === 'titles_only') {
            return [
                ...$base,
                'title' => (string) ($content['title'] ?? 'Event'),
                'type' => (string) ($content['type'] ?? 'meeting'),
                'visibility' => 'titles_only',
            ];
        }

        return [
            ...$base,
            'title' => (string) ($content['title'] ?? 'Event'),
            'description' => (string) ($content['description'] ?? ''),
            'type' => (string) ($content['type'] ?? 'meeting'),
            'location' => (string) ($content['location'] ?? ''),
            'people' => is_array($content['people'] ?? null) ? $content['people'] : [],
            'sourceTimeZone' => (string) ($content['sourceTimeZone'] ?? ''),
            'tags' => is_array($content['tags'] ?? null) ? $content['tags'] : [],
            'visibility' => 'full_details',
        ];
    }

    private function buildShareCalendars(array $scope, array $eventCalendarIds, bool $includeAllCalendars): array
    {
        $catalog = [];
        foreach (($scope['calendarCatalog'] ?? $scope['calendars'] ?? []) as $calendar) {
            if (!is_array($calendar)) {
                continue;
            }
            $id = trim((string) ($calendar['id'] ?? ''));
            if ($id === '') {
                continue;
            }
            $catalog[$id] = [
                'id' => $id,
                'label' => trim((string) ($calendar['label'] ?? '')) ?: ($id === 'local' ? 'Local calendar' : 'Provider calendar'),
                'provider' => trim((string) ($calendar['provider'] ?? '')) ?: 'local',
                'color' => trim((string) ($calendar['color'] ?? '')) ?: '#64748b',
            ];
        }

        $wantedIds = $includeAllCalendars ? $eventCalendarIds : array_map('strval', $scope['calendarIds'] ?? []);
        if ($wantedIds === []) {
            $wantedIds = ['local'];
        }

        $result = [];
        foreach (array_unique($wantedIds) as $id) {
            $result[] = $catalog[$id] ?? [
                'id' => $id,
                'label' => $id === 'local' ? 'Local calendar' : 'Provider calendar',
                'provider' => $id === 'local' ? 'local' : 'external',
                'color' => $id === 'local' ? '#64748b' : '#4f9d69',
            ];
        }

        return $result;
    }

    private function normalizeNullableTimestamp(mixed $value): ?string
    {
        $candidate = trim((string) ($value ?? ''));
        if ($candidate === '') {
            return null;
        }

        try {
            return (new \DateTimeImmutable($candidate))->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s.u');
        } catch (\Throwable) {
            return null;
        }
    }

    private function formatCalendarShare(array $share): array
    {
        return [
            'id' => $share['id'] ?? '',
            'name' => $share['name'] ?? 'Shared calendar',
            'publicToken' => $share['public_token'] ?? null,
            'accessMode' => $share['access_mode'] ?? 'link',
            'privacyLevel' => $share['privacy_level'] ?? 'busy_only',
            'scope' => $this->decodeMaterializedJson((string) ($share['scope_json'] ?? '')),
            'projectionUpdatedAt' => $share['projection_updated_at'] ?? null,
            'expiresAt' => $share['expires_at'] ?? null,
            'revokedAt' => $share['revoked_at'] ?? null,
            'lastAccessedAt' => $share['last_accessed_at'] ?? null,
            'createdAt' => $share['created_at'] ?? null,
            'updatedAt' => $share['updated_at'] ?? null,
        ];
    }

    private function formatInviteKey(array $invite): array
    {
        return [
            'id' => $invite['id'] ?? '',
            'label' => $invite['label'] ?? 'Invite key',
            'role' => $invite['role'] ?? 'member',
            'maxUses' => isset($invite['max_uses']) ? (int) $invite['max_uses'] : null,
            'useCount' => (int) ($invite['use_count'] ?? 0),
            'expiresAt' => $invite['expires_at'] ?? null,
            'revokedAt' => $invite['revoked_at'] ?? null,
            'lastUsedAt' => $invite['last_used_at'] ?? null,
            'createdByUserId' => $invite['created_by_user_id'] ?? null,
            'createdAt' => $invite['created_at'] ?? null,
            'updatedAt' => $invite['updated_at'] ?? null,
        ];
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
