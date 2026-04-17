<?php

declare(strict_types=1);

namespace SelfHdb\Http;

use RuntimeException;
use SelfHdb\Config\AppConfig;

final class Request
{
    private ?array $jsonBody = null;

    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly array $query,
        public readonly array $headers,
        public readonly string $rawBody,
        public readonly string $ipAddress,
        public readonly string $userAgent,
    ) {
    }

    public static function capture(AppConfig $config): self
    {
        $rawBody = file_get_contents('php://input') ?: '';
        if (strlen($rawBody) > $config->maxJsonBodyBytes) {
            throw new RuntimeException('Request body is too large.');
        }

        $uriPath = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
        $scriptName = $_SERVER['SCRIPT_NAME'] ?? '';
        $basePath = rtrim(str_replace('\\', '/', dirname($scriptName)), '/');
        $path = str_replace($basePath, '', $uriPath);
        $path = $path === '' ? '/' : $path;

        return new self(
            method: strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET'),
            path: $path,
            query: $_GET,
            headers: function_exists('getallheaders') ? array_change_key_case(getallheaders(), CASE_LOWER) : [],
            rawBody: $rawBody,
            ipAddress: $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0',
            userAgent: $_SERVER['HTTP_USER_AGENT'] ?? '',
        );
    }

    public function json(): array
    {
        if ($this->jsonBody !== null) {
            return $this->jsonBody;
        }

        if ($this->rawBody === '') {
            return $this->jsonBody = [];
        }

        $decoded = json_decode($this->rawBody, true);
        if (!is_array($decoded)) {
            throw new RuntimeException('Request body must be valid JSON.');
        }

        return $this->jsonBody = $decoded;
    }

    public function bearerToken(): ?string
    {
        $header = $this->headers['authorization'] ?? '';
        if (!preg_match('/^Bearer\s+(.+)$/i', $header, $matches)) {
            return null;
        }

        return trim($matches[1]);
    }

    public function isSecure(): bool
    {
        $https = strtolower((string) ($_SERVER['HTTPS'] ?? ''));
        $forwarded = strtolower((string) ($this->headers['x-forwarded-proto'] ?? ''));

        return $https === 'on' || $https === '1' || $forwarded === 'https';
    }
}
