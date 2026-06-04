<?php

declare(strict_types=1);

namespace SelfHdb\Config;

final class AppConfig
{
    public function __construct(
        public readonly string $rootPath,
        public readonly string $appEnv,
        public readonly bool $appDebug,
        public readonly string $appUrl,
        public readonly string $appTimezone,
        public readonly bool $forceHttps,
        public readonly string $dbHost,
        public readonly int $dbPort,
        public readonly string $dbName,
        public readonly string $dbUser,
        public readonly string $dbPassword,
        public readonly string $dbCharset,
        public readonly string $accessTokenSecret,
        public readonly int $accessTokenTtlSeconds,
        public readonly int $refreshTokenTtlSeconds,
        public readonly int $syncPullLimit,
        public readonly int $maxJsonBodyBytes,
        public readonly array $rateLimits,
        public readonly string $envPath,
        public readonly bool $hasEnv,
    ) {
    }

    public static function fromEnvironment(string $rootPath): self
    {
        $envPath = $rootPath . '/.env';
        self::loadDotEnv($envPath);

        return self::fromArray($rootPath, [
            'APP_ENV' => self::env('APP_ENV', 'production'),
            'APP_DEBUG' => self::env('APP_DEBUG', 'false'),
            'APP_URL' => self::env('APP_URL', 'http://localhost'),
            'APP_TIMEZONE' => self::env('APP_TIMEZONE', 'UTC'),
            'APP_FORCE_HTTPS' => self::env('APP_FORCE_HTTPS', 'true'),
            'DB_HOST' => self::env('DB_HOST', '127.0.0.1'),
            'DB_PORT' => self::env('DB_PORT', '3306'),
            'DB_NAME' => self::env('DB_NAME', 'selfhdb'),
            'DB_USER' => self::env('DB_USER', 'root'),
            'DB_PASSWORD' => self::env('DB_PASSWORD', ''),
            'DB_CHARSET' => self::env('DB_CHARSET', 'utf8mb4'),
            'ACCESS_TOKEN_SECRET' => self::env('ACCESS_TOKEN_SECRET', 'change-me'),
            'ACCESS_TOKEN_TTL_SECONDS' => self::env('ACCESS_TOKEN_TTL_SECONDS', '900'),
            'REFRESH_TOKEN_TTL_SECONDS' => self::env('REFRESH_TOKEN_TTL_SECONDS', '2592000'),
            'SYNC_PULL_LIMIT' => self::env('SYNC_PULL_LIMIT', '200'),
            'MAX_JSON_BODY_BYTES' => self::env('MAX_JSON_BODY_BYTES', '262144'),
            'RATE_LIMIT_AUTH_PER_MINUTE' => self::env('RATE_LIMIT_AUTH_PER_MINUTE', '5'),
            'RATE_LIMIT_REFRESH_PER_15_MIN' => self::env('RATE_LIMIT_REFRESH_PER_15_MIN', '20'),
            'RATE_LIMIT_SYNC_PUSH_PER_MINUTE' => self::env('RATE_LIMIT_SYNC_PUSH_PER_MINUTE', '100'),
            'RATE_LIMIT_SYNC_PULL_PER_MINUTE' => self::env('RATE_LIMIT_SYNC_PULL_PER_MINUTE', '120'),
        ], $envPath, is_file($envPath));
    }

    public static function fromArray(string $rootPath, array $values, ?string $envPath = null, bool $hasEnv = false): self
    {
        $envPath ??= $rootPath . '/.env';

        return new self(
            rootPath: $rootPath,
            appEnv: (string) ($values['APP_ENV'] ?? 'production'),
            appDebug: self::normalizeBool($values['APP_DEBUG'] ?? false),
            appUrl: rtrim((string) ($values['APP_URL'] ?? 'http://localhost'), '/'),
            appTimezone: (string) ($values['APP_TIMEZONE'] ?? 'UTC'),
            forceHttps: self::normalizeBool($values['APP_FORCE_HTTPS'] ?? true),
            dbHost: (string) ($values['DB_HOST'] ?? '127.0.0.1'),
            dbPort: (int) ($values['DB_PORT'] ?? 3306),
            dbName: (string) ($values['DB_NAME'] ?? 'selfhdb'),
            dbUser: (string) ($values['DB_USER'] ?? 'root'),
            dbPassword: (string) ($values['DB_PASSWORD'] ?? ''),
            dbCharset: (string) ($values['DB_CHARSET'] ?? 'utf8mb4'),
            accessTokenSecret: (string) ($values['ACCESS_TOKEN_SECRET'] ?? 'change-me'),
            accessTokenTtlSeconds: (int) ($values['ACCESS_TOKEN_TTL_SECONDS'] ?? 900),
            refreshTokenTtlSeconds: (int) ($values['REFRESH_TOKEN_TTL_SECONDS'] ?? 2592000),
            syncPullLimit: (int) ($values['SYNC_PULL_LIMIT'] ?? 200),
            maxJsonBodyBytes: (int) ($values['MAX_JSON_BODY_BYTES'] ?? 262144),
            rateLimits: [
                'auth' => (int) ($values['RATE_LIMIT_AUTH_PER_MINUTE'] ?? 5),
                'refresh' => (int) ($values['RATE_LIMIT_REFRESH_PER_15_MIN'] ?? 20),
                'sync_push' => (int) ($values['RATE_LIMIT_SYNC_PUSH_PER_MINUTE'] ?? 100),
                'sync_pull' => (int) ($values['RATE_LIMIT_SYNC_PULL_PER_MINUTE'] ?? 120),
            ],
            envPath: $envPath,
            hasEnv: $hasEnv,
        );
    }

    private static function loadDotEnv(string $path): void
    {
        if (!is_file($path)) {
            return;
        }

        $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if ($lines === false) {
            return;
        }

        foreach ($lines as $line) {
            $trimmed = trim($line);
            if ($trimmed === '' || str_starts_with($trimmed, '#') || !str_contains($trimmed, '=')) {
                continue;
            }

            [$key, $value] = explode('=', $trimmed, 2);
            $key = trim($key);
            $value = trim($value);

            if ($key !== '' && getenv($key) === false) {
                putenv(sprintf('%s=%s', $key, $value));
                $_ENV[$key] = $value;
                $_SERVER[$key] = $value;
            }
        }
    }

    private static function env(string $key, string $default): string
    {
        $value = getenv($key);
        return $value === false ? $default : (string) $value;
    }

    private static function envInt(string $key, int $default): int
    {
        $value = getenv($key);
        return $value === false ? $default : (int) $value;
    }

    private static function envBool(string $key, bool $default): bool
    {
        $value = getenv($key);
        if ($value === false) {
            return $default;
        }

        return self::normalizeBool($value);
    }

    private static function normalizeBool(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        return in_array(strtolower((string) $value), ['1', 'true', 'yes', 'on'], true);
    }
}
