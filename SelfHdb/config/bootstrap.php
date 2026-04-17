<?php

declare(strict_types=1);

require dirname(__DIR__) . '/src/autoload.php';

use SelfHdb\Application;
use SelfHdb\Config\AppConfig;

$config = AppConfig::fromEnvironment(dirname(__DIR__));
date_default_timezone_set($config->appTimezone);

return new Application($config);
