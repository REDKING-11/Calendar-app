<?php

declare(strict_types=1);

namespace SelfHdb\Security;

use SelfHdb\Config\AppConfig;

final class AccessTokenService
{
    public function __construct(private readonly AppConfig $config)
    {
    }

    public function issue(array $claims): string
    {
        $header = $this->base64UrlEncode(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $payload = $this->base64UrlEncode(json_encode($claims));
        $signature = hash_hmac('sha256', $header . '.' . $payload, $this->config->accessTokenSecret, true);

        return $header . '.' . $payload . '.' . $this->base64UrlEncode($signature);
    }

    public function verify(string $token): ?array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return null;
        }

        [$header, $payload, $signature] = $parts;
        $expected = $this->base64UrlEncode(
            hash_hmac('sha256', $header . '.' . $payload, $this->config->accessTokenSecret, true)
        );

        if (!hash_equals($expected, $signature)) {
            return null;
        }

        $claims = json_decode($this->base64UrlDecode($payload), true);
        if (!is_array($claims) || (int) ($claims['exp'] ?? 0) < time()) {
            return null;
        }

        return $claims;
    }

    private function base64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private function base64UrlDecode(string $value): string
    {
        $padding = strlen($value) % 4;
        if ($padding > 0) {
            $value .= str_repeat('=', 4 - $padding);
        }

        return base64_decode(strtr($value, '-_', '+/')) ?: '';
    }
}
