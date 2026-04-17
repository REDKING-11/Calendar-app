<?php

declare(strict_types=1);

namespace SelfHdb\Service;

use RuntimeException;
use SelfHdb\Config\AppConfig;
use SelfHdb\Repository\BackendRepository;
use SelfHdb\Security\AccessTokenService;
use SelfHdb\Support\Str;

final class AuthService
{
    public function __construct(
        private readonly AppConfig $config,
        private readonly BackendRepository $repository,
        private readonly AccessTokenService $accessTokens,
    ) {
    }

    public function register(string $email, string $password, array $device, string $ipAddress, string $userAgent): array
    {
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new RuntimeException('A valid email address is required.');
        }

        if (strlen($password) < 8) {
            throw new RuntimeException('Password must be at least 8 characters.');
        }

        if ($this->repository->findUserByEmail($email)) {
            throw new RuntimeException('An account with that email already exists.');
        }

        return $this->repository->transaction(function () use ($email, $password, $device, $ipAddress, $userAgent) {
            $user = $this->repository->createUser($email, password_hash($password, PASSWORD_DEFAULT));
            $normalizedDevice = $this->repository->upsertDevice($user['id'], $device);
            $calendar = $this->repository->ensureDefaultCalendar($user['id'], 'UTC');
            $auth = $this->issueAuthBundle($user, $normalizedDevice, $ipAddress, $userAgent);

            return [
                'user' => $this->publicUser($user),
                'device' => $this->publicDevice($normalizedDevice),
                'calendar' => [
                    'id' => $calendar['id'],
                    'name' => $calendar['name'],
                    'timezone' => $calendar['timezone'],
                ],
                ...$auth,
            ];
        });
    }

    public function login(string $email, string $password, array $device, string $ipAddress, string $userAgent): array
    {
        $user = $this->repository->findUserByEmail($email);
        if (!$user || !password_verify($password, $user['password_hash'])) {
            throw new RuntimeException('Invalid email or password.');
        }

        if ((int) $user['is_active'] !== 1) {
            throw new RuntimeException('This account is inactive.');
        }

        return $this->repository->transaction(function () use ($user, $device, $ipAddress, $userAgent) {
            $normalizedDevice = $this->repository->upsertDevice($user['id'], $device);

            return [
                'user' => $this->publicUser($user),
                'device' => $this->publicDevice($normalizedDevice),
                ...$this->issueAuthBundle($user, $normalizedDevice, $ipAddress, $userAgent),
            ];
        });
    }

    public function refresh(string $refreshToken): array
    {
        $tokenRecord = $this->repository->findRefreshTokenByHash(Str::hashToken($refreshToken));
        if (!$tokenRecord || $tokenRecord['revoked_at'] !== null) {
            throw new RuntimeException('Refresh token is invalid.');
        }

        if (strtotime($tokenRecord['expires_at']) < time()) {
            throw new RuntimeException('Refresh token has expired.');
        }

        $session = $this->repository->findSessionById($tokenRecord['session_id']);
        if (!$session || $session['revoked_at'] !== null) {
            throw new RuntimeException('Session is no longer active.');
        }

        $user = $this->repository->findUserById($tokenRecord['user_id']);
        $device = $this->repository->findDeviceForUser($tokenRecord['user_id'], $tokenRecord['device_id']);
        if (!$user || !$device || $device['revoked_at'] !== null) {
            throw new RuntimeException('Device is no longer trusted.');
        }

        return $this->repository->transaction(function () use ($tokenRecord, $session, $user, $device) {
            $this->repository->revokeRefreshToken($tokenRecord['id']);
            $this->repository->touchSession($session['id']);

            $accessTokenId = Str::uuid();
            $accessTokenExpiresAt = time() + $this->config->accessTokenTtlSeconds;
            $accessToken = $this->accessTokens->issue([
                'sub' => $user['id'],
                'sid' => $session['id'],
                'did' => $device['id'],
                'ati' => $accessTokenId,
                'iat' => time(),
                'exp' => $accessTokenExpiresAt,
            ]);

            $refreshToken = Str::randomToken(48);
            $refreshTokenExpiresAt = gmdate('Y-m-d H:i:s', time() + $this->config->refreshTokenTtlSeconds);
            $refreshRow = $this->repository->createRefreshToken(
                $session['id'],
                $user['id'],
                $device['id'],
                Str::hashToken($refreshToken),
                $refreshTokenExpiresAt,
                $tokenRecord['id']
            );

            return [
                'sessionId' => $session['id'],
                'accessToken' => $accessToken,
                'accessTokenExpiresAt' => gmdate(DATE_ATOM, $accessTokenExpiresAt),
                'refreshToken' => $refreshToken,
                'refreshTokenExpiresAt' => gmdate(DATE_ATOM, strtotime($refreshRow['expires_at'])),
                'user' => $this->publicUser($user),
                'device' => $this->publicDevice($device),
            ];
        });
    }

    public function authenticate(string $accessToken): ?array
    {
        $claims = $this->accessTokens->verify($accessToken);
        if (!$claims) {
            return null;
        }

        $session = $this->repository->findSessionById((string) ($claims['sid'] ?? ''));
        if (!$session || $session['revoked_at'] !== null || strtotime($session['expires_at']) < time()) {
            return null;
        }

        $user = $this->repository->findUserById((string) ($claims['sub'] ?? ''));
        $device = $this->repository->findDeviceForUser((string) ($claims['sub'] ?? ''), (string) ($claims['did'] ?? ''));
        if (!$user || !$device || $device['revoked_at'] !== null) {
            return null;
        }

        $this->repository->touchSession($session['id']);

        return [
            'user' => $user,
            'device' => $device,
            'session' => $session,
            'claims' => $claims,
        ];
    }

    public function logout(string $userId, string $sessionId): void
    {
        $this->repository->revokeSession($userId, $sessionId);
    }

    private function issueAuthBundle(array $user, array $device, string $ipAddress, string $userAgent): array
    {
        $accessTokenId = Str::uuid();
        $sessionExpiresAt = gmdate('Y-m-d H:i:s', time() + $this->config->refreshTokenTtlSeconds);
        $session = $this->repository->createSession(
            $user['id'],
            $device['id'],
            $accessTokenId,
            $ipAddress,
            $userAgent,
            $sessionExpiresAt
        );

        $accessTokenExpiresAt = time() + $this->config->accessTokenTtlSeconds;
        $accessToken = $this->accessTokens->issue([
            'sub' => $user['id'],
            'sid' => $session['id'],
            'did' => $device['id'],
            'ati' => $accessTokenId,
            'iat' => time(),
            'exp' => $accessTokenExpiresAt,
        ]);

        $refreshToken = Str::randomToken(48);
        $refreshTokenRow = $this->repository->createRefreshToken(
            $session['id'],
            $user['id'],
            $device['id'],
            Str::hashToken($refreshToken),
            $sessionExpiresAt
        );

        return [
            'sessionId' => $session['id'],
            'accessToken' => $accessToken,
            'accessTokenExpiresAt' => gmdate(DATE_ATOM, $accessTokenExpiresAt),
            'refreshToken' => $refreshToken,
            'refreshTokenExpiresAt' => gmdate(DATE_ATOM, strtotime($refreshTokenRow['expires_at'])),
        ];
    }

    private function publicUser(array $user): array
    {
        return [
            'id' => $user['id'],
            'email' => $user['email'],
            'isActive' => (bool) $user['is_active'],
            'createdAt' => $user['created_at'],
            'updatedAt' => $user['updated_at'],
        ];
    }

    private function publicDevice(array $device): array
    {
        return [
            'id' => $device['id'],
            'name' => $device['name'],
            'type' => $device['device_type'],
            'lastSeenAt' => $device['last_seen_at'],
            'revokedAt' => $device['revoked_at'],
            'isTrusted' => (bool) $device['is_trusted'],
        ];
    }
}
