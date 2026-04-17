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
    ) {
    }

    public static function fromEnvironment(string $rootPath): self
    {
        self::loadDotEnv($rootPath . '/.env');

        return new self(
            rootPath: $rootPath,
            appEnv: self::env('APP_ENV', 'production'),
            appDebug: self::envBool('APP_DEBUG', false),
            appUrl: rtrim(self::env('APP_URL', 'http://localhost'), '/'),
            appTimezone: self::env('APP_TIMEZONE', 'UTC'),
            forceHttps: self::envBool('APP_FORCE_HTTPS', true),
            dbHost: self::env('DB_HOST', '127.0.0.1'),
            dbPort: self::envInt('DB_PORT', 3306),
            dbName: self::env('DB_NAME', 'selfhdb'),
            dbUser: self::env('DB_USER', 'root'),
            dbPassword: self::env('DB_PASSWORD', ''),
            dbCharset: self::env('DB_CHARSET', 'utf8mb4'),
            accessTokenSecret: self::env('ACCESS_TOKEN_SECRET', 'change-me'),
            accessTokenTtlSeconds: self::envInt('ACCESS_TOKEN_TTL_SECONDS', 900),
            refreshTokenTtlSeconds: self::envInt('REFRESH_TOKEN_TTL_SECONDS', 2592000),
            syncPullLimit: self::envInt('SYNC_PULL_LIMIT', 200),
            maxJsonBodyBytes: self::envInt('MAX_JSON_BODY_BYTES', 262144),
            rateLimits: [
                'auth' => self::envInt('RATE_LIMIT_AUTH_PER_MINUTE', 5),
                'refresh' => self::envInt('RATE_LIMIT_REFRESH_PER_15_MIN', 20),
                'sync_push' => self::envInt('RATE_LIMIT_SYNC_PUSH_PER_MINUTE', 100),
                'sync_pull' => self::envInt('RATE_LIMIT_SYNC_PULL_PER_MINUTE', 120),
            ],
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

        return in_array(strtolower((string) $value), ['1', 'true', 'yes', 'on'], true);
    }
}
