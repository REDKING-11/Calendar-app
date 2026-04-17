<?php

declare(strict_types=1);

namespace SelfHdb\Security;

final class RateLimiter
{
    public function __construct(private readonly string $storagePath)
    {
    }

    public function hit(string $bucket, string $key, int $limit, int $windowSeconds): bool
    {
        if (!is_dir($this->storagePath)) {
            mkdir($this->storagePath, 0775, true);
        }

        $file = $this->storagePath . '/' . sha1($bucket . ':' . $key) . '.json';
        $now = time();
        $windowStart = $now - $windowSeconds;
        $entries = [];

        if (is_file($file)) {
            $decoded = json_decode((string) file_get_contents($file), true);
            if (is_array($decoded)) {
                $entries = array_values(array_filter($decoded, static fn ($value) => (int) $value >= $windowStart));
            }
        }

        if (count($entries) >= $limit) {
            file_put_contents($file, json_encode($entries));
            return false;
        }

        $entries[] = $now;
        file_put_contents($file, json_encode($entries));
        return true;
    }
}
