<?php

declare(strict_types=1);

namespace SelfHdb\Database;

use PDO;
use SelfHdb\Config\AppConfig;

final class Database
{
    private ?PDO $pdo = null;

    public function __construct(private readonly AppConfig $config)
    {
    }

    public function pdo(): PDO
    {
        if ($this->pdo instanceof PDO) {
            return $this->pdo;
        }

        $dsn = sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=%s',
            $this->config->dbHost,
            $this->config->dbPort,
            $this->config->dbName,
            $this->config->dbCharset
        );

        $this->pdo = new PDO($dsn, $this->config->dbUser, $this->config->dbPassword, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);

        return $this->pdo;
    }
}
