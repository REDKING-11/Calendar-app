<?php

declare(strict_types=1);

namespace SelfHdb\Service;

use RuntimeException;
use SelfHdb\Config\AppConfig;
use SelfHdb\Repository\BackendRepository;

final class SyncService
{
    public function __construct(
        private readonly AppConfig $config,
        private readonly BackendRepository $repository,
    ) {
    }

    public function bootstrap(string $userId, string $deviceId): array
    {
        $calendar = $this->repository->ensureDefaultCalendar($userId, 'UTC');
        $cursor = $this->repository->getCurrentServerSequence($userId);
        $state = $this->repository->upsertSyncState($userId, $deviceId, $cursor, 0);

        return [
            'serverCursor' => $cursor,
            'syncState' => [
                'lastServerSequence' => (int) ($state['last_server_sequence'] ?? 0),
                'lastDeviceSequenceSeen' => (int) ($state['last_device_sequence_seen'] ?? 0),
            ],
            'defaultCalendar' => [
                'id' => $calendar['id'],
                'name' => $calendar['name'],
                'timezone' => $calendar['timezone'],
            ],
        ];
    }

    public function state(string $userId, string $deviceId): array
    {
        $cursor = $this->repository->getCurrentServerSequence($userId);
        $state = $this->repository->getSyncState($userId, $deviceId)
            ?? $this->repository->upsertSyncState($userId, $deviceId, 0, 0);

        return [
            'serverCursor' => $cursor,
            'lastServerSequence' => (int) ($state['last_server_sequence'] ?? 0),
            'lastDeviceSequenceSeen' => (int) ($state['last_device_sequence_seen'] ?? 0),
        ];
    }

    public function push(string $userId, string $deviceId, array $envelopes): array
    {
        if ($envelopes === []) {
            return [
                'acceptedCount' => 0,
                'latestServerCursor' => $this->repository->getCurrentServerSequence($userId),
            ];
        }

        $calendar = $this->repository->ensureDefaultCalendar($userId, 'UTC');
        $acceptedCount = 0;
        $lastDeviceSequenceSeen = 0;

        $this->repository->transaction(function () use ($userId, $deviceId, $envelopes, $calendar, &$acceptedCount, &$lastDeviceSequenceSeen): void {
            foreach ($envelopes as $envelope) {
                $this->validateEnvelope($envelope, $deviceId);
                $deviceSequence = (int) $envelope['deviceSequence'];
                $lastDeviceSequenceSeen = max($lastDeviceSequenceSeen, $deviceSequence);

                if ($this->repository->findEnvelopeByDeviceSequence($deviceId, $deviceSequence)) {
                    continue;
                }

                $this->repository->insertEnvelope($userId, $deviceId, $envelope);
                $this->repository->materializeEnvelope($userId, $deviceId, $calendar['id'], $envelope);
                $acceptedCount += 1;
            }

            $latestCursor = $this->repository->getCurrentServerSequence($userId);
            $currentState = $this->repository->getSyncState($userId, $deviceId);
            $this->repository->upsertSyncState(
                $userId,
                $deviceId,
                $latestCursor,
                max((int) ($currentState['last_device_sequence_seen'] ?? 0), $lastDeviceSequenceSeen)
            );
        });

        return [
            'acceptedCount' => $acceptedCount,
            'latestServerCursor' => $this->repository->getCurrentServerSequence($userId),
        ];
    }

    public function pull(string $userId, string $deviceId, int $cursor): array
    {
        $envelopes = $this->repository->listEnvelopesAfter($userId, $cursor, $this->config->syncPullLimit);
        $latestCursor = $cursor;

        foreach ($envelopes as $envelope) {
            $latestCursor = max($latestCursor, (int) $envelope['serverSequence']);
        }

        $state = $this->repository->getSyncState($userId, $deviceId);
        $this->repository->upsertSyncState(
            $userId,
            $deviceId,
            max($latestCursor, (int) ($state['last_server_sequence'] ?? 0)),
            (int) ($state['last_device_sequence_seen'] ?? 0)
        );

        return [
            'envelopes' => $envelopes,
            'latestServerCursor' => $latestCursor,
        ];
    }

    private function validateEnvelope(array $envelope, string $deviceId): void
    {
        foreach (['deviceId', 'deviceSequence', 'entity', 'entityId', 'operation', 'nonce', 'clientTimestamp'] as $field) {
            if (!array_key_exists($field, $envelope)) {
                throw new RuntimeException(sprintf('Envelope is missing %s.', $field));
            }
        }

        if ((string) $envelope['deviceId'] !== $deviceId) {
            throw new RuntimeException('Envelope deviceId must match the authenticated device.');
        }

        if (!is_numeric($envelope['deviceSequence']) || (int) $envelope['deviceSequence'] < 1) {
            throw new RuntimeException('Envelope deviceSequence must be a positive integer.');
        }

        if (!in_array((string) $envelope['operation'], ['create', 'update', 'delete'], true)) {
            throw new RuntimeException('Envelope operation is not supported.');
        }

        $encoded = json_encode($envelope);
        if ($encoded !== false && strlen($encoded) > $this->config->maxJsonBodyBytes) {
            throw new RuntimeException('Envelope payload is too large.');
        }
    }
}
