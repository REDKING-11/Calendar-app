<?php

declare(strict_types=1);

namespace SelfHdb\Http;

final class Response
{
    public static function json(int $statusCode, array $payload): never
    {
        http_response_code($statusCode);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($payload, JSON_UNESCAPED_SLASHES);
        exit;
    }

    public static function success(array $result = [], ?string $message = null, int $statusCode = 200): never
    {
        self::json($statusCode, [
            'result' => $result,
            'message' => $message,
        ]);
    }

    public static function error(string $error, string $message, int $statusCode = 400, array $details = []): never
    {
        $payload = [
            'error' => $error,
            'message' => $message,
        ];

        if ($details !== []) {
            $payload['details'] = $details;
        }

        self::json($statusCode, $payload);
    }
}
