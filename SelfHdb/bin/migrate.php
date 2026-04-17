<?php

declare(strict_types=1);

require dirname(__DIR__) . '/src/autoload.php';

use SelfHdb\Config\AppConfig;
use SelfHdb\Database\Database;

$config = AppConfig::fromEnvironment(dirname(__DIR__));
$database = new Database($config);
$pdo = $database->pdo();
$sql = file_get_contents(dirname(__DIR__) . '/database/schema.sql');

if ($sql === false) {
    fwrite(STDERR, "Could not read schema.sql\n");
    exit(1);
}

$pdo->exec($sql);
fwrite(STDOUT, "SelfHdb schema applied.\n");
