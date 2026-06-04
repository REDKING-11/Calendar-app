<?php

declare(strict_types=1);

namespace SelfHdb;

use RuntimeException;
use SelfHdb\Config\AppConfig;
use SelfHdb\Database\Database;
use SelfHdb\Http\Request;
use SelfHdb\Http\Response;
use SelfHdb\Http\Router;
use SelfHdb\Repository\BackendRepository;
use SelfHdb\Security\AccessTokenService;
use SelfHdb\Security\RateLimiter;
use SelfHdb\Service\AuthService;
use SelfHdb\Service\SyncService;
use SelfHdb\Support\Str;

final class Application
{
    private ?BackendRepository $repository = null;
    private ?AuthService $authService = null;
    private ?SyncService $syncService = null;
    private ?RateLimiter $rateLimiter = null;

    public function __construct(private readonly AppConfig $config)
    {
    }

    public function run(): void
    {
        try {
            $request = Request::capture($this->config);
            $this->enforceTransportSecurity($request);
            $router = new Router();
            $this->registerRoutes($router);
            $router->dispatch($request);
        } catch (RuntimeException $error) {
            Response::error('bad_request', $error->getMessage(), 400);
        } catch (\Throwable $error) {
            $message = $this->config->appDebug ? $error->getMessage() : 'Internal server error.';
            Response::error('internal_error', $message, 500);
        }
    }

    private function registerRoutes(Router $router): void
    {
        $router->add('GET', '/', fn (Request $request, array $_params) => $this->renderHome($request));
        $router->add('GET', '/setup', fn (Request $request, array $_params) => $this->renderSetup($request));
        $router->add('POST', '/setup', fn (Request $request, array $_params) => $this->handleSetupForm($request));
        $router->add('GET', '/login', fn (Request $request, array $_params) => $this->renderLogin($request));
        $router->add('POST', '/login', fn (Request $request, array $_params) => $this->handleLoginForm($request));
        $router->add('POST', '/logout', fn (Request $_request, array $_params) => $this->logoutBrowser());
        $router->add('GET', '/admin', fn (Request $request, array $_params) => $this->renderAdmin($request));
        $router->add('POST', '/admin/invite-keys', fn (Request $request, array $_params) => $this->handleAdminInviteKeyForm($request));
        $router->add('POST', '/admin/users', fn (Request $request, array $_params) => $this->handleAdminUserForm($request));
        $router->add('GET', '/shared-with-me', fn (Request $request, array $_params) => $this->renderSharedWithMe($request));
        $router->add('GET', '/share/{token}', fn (Request $_request, array $params) => $this->renderPublicShare((string) $params['token']));

        $router->add('GET', '/v1/health', fn (Request $_request, array $_params) => Response::success([
            'status' => 'ok',
            'app' => 'SelfHdb',
            'environment' => $this->config->appEnv,
        ]));

        $router->add('GET', '/v1/bootstrap/status', fn (Request $_request, array $_params) => Response::success($this->bootstrapStatus()));

        $router->add('POST', '/v1/setup/install', function (Request $request, array $_params): void {
            Response::success($this->installFromInput($request->json(), $request), null, 201);
        });

        $router->add('GET', '/v1/share/{token}', function (Request $_request, array $params): void {
            $share = $this->repository()->getPublicCalendarShare((string) $params['token']);
            if (!$share) {
                Response::error('share_not_found', 'Share link was not found or is no longer available.', 404);
            }

            Response::success($share);
        });

        $router->add('POST', '/v1/auth/register', function (Request $request, array $_params): void {
            $this->enforceRateLimit('auth', $request->ipAddress, $this->config->rateLimits['auth'], 60);
            $body = $request->json();
            $result = $this->authService()->register(
                (string) ($body['email'] ?? ''),
                (string) ($body['password'] ?? ''),
                is_array($body['device'] ?? null) ? $body['device'] : [],
                $request->ipAddress,
                $request->userAgent,
                (string) ($body['displayName'] ?? ''),
                (string) ($body['inviteKey'] ?? '')
            );
            $this->repository()->appendAuditLog($result['user']['id'], $result['device']['id'], 'auth_register', 'user', $result['user']['id'], $request->ipAddress);
            Response::success($result, null, 201);
        });

        $router->add('POST', '/v1/auth/login', function (Request $request, array $_params): void {
            $this->enforceRateLimit('auth', $request->ipAddress, $this->config->rateLimits['auth'], 60);
            $body = $request->json();
            $result = $this->authService()->login(
                (string) ($body['email'] ?? ''),
                (string) ($body['password'] ?? ''),
                is_array($body['device'] ?? null) ? $body['device'] : [],
                $request->ipAddress,
                $request->userAgent
            );
            $this->repository()->appendAuditLog($result['user']['id'], $result['device']['id'], 'auth_login', 'session', $result['sessionId'], $request->ipAddress);
            Response::success($result);
        });

        $router->add('POST', '/v1/auth/refresh', function (Request $request, array $_params): void {
            $body = $request->json();
            $key = substr(hash('sha256', (string) ($body['refreshToken'] ?? '')), 0, 24);
            $this->enforceRateLimit('refresh', $key, $this->config->rateLimits['refresh'], 900);
            $result = $this->authService()->refresh((string) ($body['refreshToken'] ?? ''));
            $this->repository()->appendAuditLog($result['user']['id'], $result['device']['id'], 'auth_refresh', 'session', $result['sessionId'], $request->ipAddress);
            Response::success($result);
        });

        $router->add('POST', '/v1/auth/logout', function (Request $request, array $_params): void {
            $auth = $this->requireAuth($request);
            $this->authService()->logout($auth['user']['id'], $auth['session']['id']);
            $this->repository()->appendAuditLog($auth['user']['id'], $auth['device']['id'], 'auth_logout', 'session', $auth['session']['id'], $request->ipAddress);
            Response::success(['loggedOut' => true]);
        });

        $router->add('GET', '/v1/auth/session', function (Request $request, array $_params): void {
            $auth = $this->requireAuth($request);
            Response::success([
                'user' => [
                    'id' => $auth['user']['id'],
                    'email' => $auth['user']['email'],
                ],
                'device' => [
                    'id' => $auth['device']['id'],
                    'name' => $auth['device']['name'],
                    'type' => $auth['device']['device_type'],
                ],
                'session' => [
                    'id' => $auth['session']['id'],
                    'expiresAt' => $auth['session']['expires_at'],
                    'lastUsedAt' => $auth['session']['last_used_at'],
                ],
            ]);
        });

        $router->add('GET', '/v1/devices', function (Request $request, array $_params): void {
            $auth = $this->requireAuth($request);
            Response::success([
                'devices' => array_map(static fn (array $device) => [
                    'id' => $device['id'],
                    'name' => $device['name'],
                    'type' => $device['device_type'],
                    'createdAt' => $device['created_at'],
                    'lastSeenAt' => $device['last_seen_at'],
                    'revokedAt' => $device['revoked_at'],
                    'isTrusted' => (bool) $device['is_trusted'],
                ], $this->repository()->listDevices($auth['user']['id'])),
            ]);
        });

        $router->add('POST', '/v1/devices/{id}/revoke', function (Request $request, array $params): void {
            $auth = $this->requireAuth($request);
            $this->repository()->revokeDevice($auth['user']['id'], (string) $params['id']);
            $this->repository()->appendAuditLog($auth['user']['id'], $auth['device']['id'], 'device_revoke', 'device', (string) $params['id'], $request->ipAddress);
            Response::success(['revoked' => true]);
        });

        $router->add('GET', '/v1/sessions', function (Request $request, array $_params): void {
            $auth = $this->requireAuth($request);
            Response::success([
                'sessions' => $this->repository()->listSessions($auth['user']['id']),
            ]);
        });

        $router->add('POST', '/v1/sessions/{id}/revoke', function (Request $request, array $params): void {
            $auth = $this->requireAuth($request);
            $this->repository()->revokeSession($auth['user']['id'], (string) $params['id']);
            $this->repository()->appendAuditLog($auth['user']['id'], $auth['device']['id'], 'session_revoke', 'session', (string) $params['id'], $request->ipAddress);
            Response::success(['revoked' => true]);
        });

        $router->add('GET', '/v1/sync/state', function (Request $request, array $_params): void {
            $auth = $this->requireAuth($request);
            Response::success($this->syncService()->state($auth['user']['id'], $auth['device']['id']));
        });

        $router->add('GET', '/v1/bundle/export', function (Request $request, array $_params): void {
            $auth = $this->requireAuth($request);
            Response::success($this->repository()->exportBundle($auth['user']['id']));
        });

        $router->add('GET', '/v1/shares', function (Request $request, array $_params): void {
            $auth = $this->requireAuth($request);
            Response::success([
                'shares' => array_map(
                    fn (array $share): array => $this->formatShareForResponse($share),
                    $this->repository()->listCalendarShares($auth['user']['id'])
                ),
            ]);
        });

        $router->add('POST', '/v1/shares', function (Request $request, array $_params): void {
            $auth = $this->requireAuth($request);
            $body = $request->json();
            $share = $this->repository()->createCalendarShare($auth['user']['id'], $body);
            $this->repository()->appendAuditLog($auth['user']['id'], $auth['device']['id'], 'share_create', 'calendar_share', $share['id'], $request->ipAddress);
            Response::success($this->formatShareForResponse($share), null, 201);
        });

        $router->add('PATCH', '/v1/shares/{id}', function (Request $request, array $params): void {
            $auth = $this->requireAuth($request);
            $share = $this->repository()->updateCalendarShare($auth['user']['id'], (string) $params['id'], $request->json());
            $this->repository()->appendAuditLog($auth['user']['id'], $auth['device']['id'], 'share_update', 'calendar_share', $share['id'], $request->ipAddress);
            Response::success($this->formatShareForResponse($share));
        });

        $router->add('POST', '/v1/shares/{id}/publish', function (Request $request, array $params): void {
            $auth = $this->requireAuth($request);
            $body = $request->json();
            $projection = is_array($body['projection'] ?? null) ? $body['projection'] : [];
            $share = $this->repository()->publishCalendarShareProjection($auth['user']['id'], (string) $params['id'], $projection);
            $this->repository()->appendAuditLog($auth['user']['id'], $auth['device']['id'], 'share_publish', 'calendar_share', $share['id'], $request->ipAddress);
            Response::success($this->formatShareForResponse($share));
        });

        $router->add('POST', '/v1/shares/{id}/revoke', function (Request $request, array $params): void {
            $auth = $this->requireAuth($request);
            $share = $this->repository()->revokeCalendarShare($auth['user']['id'], (string) $params['id']);
            $this->repository()->appendAuditLog($auth['user']['id'], $auth['device']['id'], 'share_revoke', 'calendar_share', $share['id'], $request->ipAddress);
            Response::success($this->formatShareForResponse($share));
        });

        $router->add('POST', '/v1/shares/{id}/rotate-token', function (Request $request, array $params): void {
            $auth = $this->requireAuth($request);
            $share = $this->repository()->rotateCalendarShareToken($auth['user']['id'], (string) $params['id']);
            $this->repository()->appendAuditLog($auth['user']['id'], $auth['device']['id'], 'share_rotate_token', 'calendar_share', $share['id'], $request->ipAddress);
            Response::success($this->formatShareForResponse($share));
        });

        $router->add('POST', '/v1/shares/{id}/recipients', function (Request $request, array $params): void {
            $auth = $this->requireAuth($request);
            $body = $request->json();
            $recipients = is_array($body['recipients'] ?? null) ? $body['recipients'] : [];
            $result = $this->repository()->replaceCalendarShareRecipients($auth['user']['id'], (string) $params['id'], $recipients);
            $this->repository()->appendAuditLog($auth['user']['id'], $auth['device']['id'], 'share_recipients_update', 'calendar_share', (string) $params['id'], $request->ipAddress, ['recipientCount' => count($result)]);
            Response::success(['recipients' => $result]);
        });

        $router->add('GET', '/v1/shares/shared-with-me', function (Request $request, array $_params): void {
            $auth = $this->requireAuth($request);
            Response::success([
                'shares' => $this->repository()->listSharesForRecipient($auth['user']['id'], (string) $auth['user']['email']),
            ]);
        });

        $router->add('GET', '/v1/admin/users', function (Request $request, array $_params): void {
            $this->requireAdmin($request);
            Response::success(['users' => array_map(fn (array $user): array => $this->formatUserForAdmin($user), $this->repository()->listUsers())]);
        });

        $router->add('POST', '/v1/admin/users', function (Request $request, array $_params): void {
            $auth = $this->requireAdmin($request);
            $body = $request->json();
            $userId = (string) ($body['userId'] ?? '');
            if ($userId === '') {
                Response::error('user_required', 'User id is required.', 400);
            }
            $updated = $this->repository()->updateUserFromAdmin($userId, $body);
            $this->repository()->appendAuditLog($auth['user']['id'], $auth['device']['id'], 'admin_user_update', 'user', $userId, $request->ipAddress);
            Response::success(['user' => $this->formatUserForAdmin($updated)]);
        });

        $router->add('GET', '/v1/admin/invite-keys', function (Request $request, array $_params): void {
            $this->requireAdmin($request);
            Response::success(['inviteKeys' => $this->repository()->listInviteKeys()]);
        });

        $router->add('POST', '/v1/admin/invite-keys', function (Request $request, array $_params): void {
            $auth = $this->requireAdmin($request);
            $body = $request->json();
            $action = (string) ($body['action'] ?? 'create');
            if ($action === 'revoke') {
                $invite = $this->repository()->revokeInviteKey((string) ($body['inviteKeyId'] ?? ''));
                $this->repository()->appendAuditLog($auth['user']['id'], $auth['device']['id'], 'invite_key_revoke', 'invite_key', $invite['id'], $request->ipAddress);
                Response::success(['inviteKey' => $invite]);
            }

            $invite = $this->repository()->createInviteKey($auth['user']['id'], $body);
            $this->repository()->appendAuditLog($auth['user']['id'], $auth['device']['id'], 'invite_key_create', 'invite_key', $invite['id'], $request->ipAddress);
            Response::success(['inviteKey' => $invite], null, 201);
        });

        $router->add('GET', '/v1/admin/audit', function (Request $request, array $_params): void {
            $this->requireAdmin($request);
            Response::success(['audit' => $this->repository()->listAuditLog((int) ($request->query['limit'] ?? 80))]);
        });

        $router->add('POST', '/v1/bundle/import', function (Request $request, array $_params): void {
            $auth = $this->requireAuth($request);
            $body = $request->json();
            $result = $this->repository()->importBundle(
                $auth['user']['id'],
                $auth['device']['id'],
                is_array($body) ? $body : []
            );
            $this->repository()->appendAuditLog(
                $auth['user']['id'],
                $auth['device']['id'],
                'bundle_import',
                'bundle',
                'calendar-bundle-v1',
                $request->ipAddress,
                ['acceptedCount' => $result['acceptedCount']]
            );
            Response::success($result);
        });

        $router->add('POST', '/v1/sync/bootstrap', function (Request $request, array $_params): void {
            $auth = $this->requireAuth($request);
            Response::success($this->syncService()->bootstrap($auth['user']['id'], $auth['device']['id']));
        });

        $router->add('POST', '/v1/sync/push', function (Request $request, array $_params): void {
            $auth = $this->requireAuth($request);
            $this->enforceRateLimit('sync_push', $auth['device']['id'], $this->config->rateLimits['sync_push'], 60);
            $body = $request->json();
            $result = $this->syncService()->push(
                $auth['user']['id'],
                $auth['device']['id'],
                is_array($body['envelopes'] ?? null) ? $body['envelopes'] : []
            );
            $this->repository()->appendAuditLog($auth['user']['id'], $auth['device']['id'], 'sync_push', 'sync', $auth['device']['id'], $request->ipAddress, ['acceptedCount' => $result['acceptedCount']]);
            Response::success($result);
        });

        $router->add('GET', '/v1/sync/pull', function (Request $request, array $_params): void {
            $auth = $this->requireAuth($request);
            $this->enforceRateLimit('sync_pull', $auth['device']['id'], $this->config->rateLimits['sync_pull'], 60);
            $cursor = (int) ($request->query['cursor'] ?? $request->query['since'] ?? 0);
            Response::success($this->syncService()->pull($auth['user']['id'], $auth['device']['id'], max(0, $cursor)));
        });
    }

    private function repository(): BackendRepository
    {
        if ($this->repository instanceof BackendRepository) {
            return $this->repository;
        }

        $database = new Database($this->config);
        return $this->repository = new BackendRepository($database->pdo());
    }

    private function authService(): AuthService
    {
        if ($this->authService instanceof AuthService) {
            return $this->authService;
        }

        return $this->authService = new AuthService($this->config, $this->repository(), new AccessTokenService($this->config));
    }

    private function syncService(): SyncService
    {
        if ($this->syncService instanceof SyncService) {
            return $this->syncService;
        }

        return $this->syncService = new SyncService($this->config, $this->repository());
    }

    private function rateLimiter(): RateLimiter
    {
        if ($this->rateLimiter instanceof RateLimiter) {
            return $this->rateLimiter;
        }

        return $this->rateLimiter = new RateLimiter($this->config->rootPath . '/storage/runtime');
    }

    private function bootstrapStatus(): array
    {
        if (!$this->config->hasEnv) {
            return [
                'claimed' => false,
                'setupRequired' => true,
                'databaseReady' => false,
                'enabledProviders' => ['password'],
                'authMode' => 'local_password',
            ];
        }

        try {
            $settings = $this->repository()->getInstallSettings();
            return [
                'claimed' => $this->repository()->isInstalled(),
                'setupRequired' => !$this->repository()->isInstalled(),
                'databaseReady' => true,
                'organizationName' => $settings['organization_name'] ?? 'SelfHdb',
                'enabledProviders' => ['password'],
                'authMode' => 'local_password',
            ];
        } catch (\Throwable $error) {
            return [
                'claimed' => false,
                'setupRequired' => true,
                'databaseReady' => false,
                'setupError' => $this->config->appDebug ? $error->getMessage() : 'Database is not ready.',
                'enabledProviders' => ['password'],
                'authMode' => 'local_password',
            ];
        }
    }

    private function isSetupComplete(): bool
    {
        if (!$this->config->hasEnv) {
            return false;
        }

        try {
            return $this->repository()->isInstalled();
        } catch (\Throwable) {
            return false;
        }
    }

    private function renderHome(Request $request): void
    {
        if (!$this->isSetupComplete()) {
            Response::redirect('/setup');
        }

        $auth = $this->browserAuth($request);
        if (!$auth) {
            Response::redirect('/login');
        }

        Response::redirect(($auth['user']['role'] ?? 'member') === 'admin' ? '/admin' : '/shared-with-me');
    }

    private function renderSetup(Request $_request, string $message = '', string $envContent = ''): void
    {
        if ($this->isSetupComplete() && $envContent === '') {
            Response::redirect('/login');
        }

        $defaults = [
            'APP_URL' => $this->config->appUrl !== 'http://localhost' ? $this->config->appUrl : '',
            'APP_ENV' => 'production',
            'APP_DEBUG' => 'false',
            'APP_TIMEZONE' => 'UTC',
            'APP_FORCE_HTTPS' => 'true',
            'DB_HOST' => '127.0.0.1',
            'DB_PORT' => '3306',
            'DB_NAME' => 'selfhdb',
            'DB_USER' => 'selfhdb_user',
            'DB_PASSWORD' => '',
            'DB_CHARSET' => 'utf8mb4',
            'organizationName' => 'SelfHdb',
            'adminName' => '',
            'adminEmail' => '',
        ];

        $envBlock = $envContent !== ''
            ? '<div class="notice"><strong>.env could not be written automatically.</strong><p>Place this content in <code>.env</code> beside <code>config</code> and <code>public</code>, then reload the site.</p><textarea readonly rows="16">' . $this->e($envContent) . '</textarea></div>'
            : '';

        $html = '<h1>Set up SelfHdb</h1>'
            . '<p class="muted">Connect this PHP site to MySQL, create the first admin, and claim the server. After setup, this page is replaced by login.</p>'
            . ($message !== '' ? '<p class="error">' . $this->e($message) . '</p>' : '')
            . $envBlock
            . '<form method="post" action="/setup" class="grid">'
            . $this->input('organizationName', 'Organization name', $defaults['organizationName'])
            . $this->input('APP_URL', 'Public SelfHdb URL', $defaults['APP_URL'])
            . $this->input('DB_HOST', 'MySQL host', $defaults['DB_HOST'])
            . $this->input('DB_PORT', 'MySQL port', $defaults['DB_PORT'])
            . $this->input('DB_NAME', 'MySQL database', $defaults['DB_NAME'])
            . $this->input('DB_USER', 'MySQL username', $defaults['DB_USER'])
            . $this->input('DB_PASSWORD', 'MySQL password', $defaults['DB_PASSWORD'], 'password')
            . $this->input('adminName', 'Admin display name', $defaults['adminName'])
            . $this->input('adminEmail', 'Admin email', $defaults['adminEmail'], 'email')
            . $this->input('adminPassword', 'Admin password', '', 'password')
            . '<button type="submit">Install SelfHdb</button>'
            . '</form>';

        Response::html($this->layout('SelfHdb setup', $html));
    }

    private function handleSetupForm(Request $request): void
    {
        try {
            $result = $this->installFromInput($request->form(), $request);
            if (!empty($result['envWritten'])) {
                Response::redirect('/login?installed=1');
            }

            $this->renderSetup($request, '', (string) ($result['envContent'] ?? ''));
        } catch (\Throwable $error) {
            $this->renderSetup($request, $error->getMessage());
        }
    }

    private function installFromInput(array $input, Request $request): array
    {
        if ($this->isSetupComplete()) {
            throw new RuntimeException('SelfHdb is already installed.');
        }

        $adminEmail = strtolower(trim((string) ($input['adminEmail'] ?? $input['email'] ?? '')));
        $adminPassword = (string) ($input['adminPassword'] ?? $input['password'] ?? '');
        if (!filter_var($adminEmail, FILTER_VALIDATE_EMAIL)) {
            throw new RuntimeException('A valid admin email is required.');
        }
        if (strlen($adminPassword) < 8) {
            throw new RuntimeException('Admin password must be at least 8 characters.');
        }

        $values = $this->installerEnvValues($input);
        $envContent = $this->buildEnvContent($values);
        $installConfig = AppConfig::fromArray($this->config->rootPath, $values, $this->config->envPath, true);
        $database = new Database($installConfig);
        $pdo = $database->pdo();
        $schema = file_get_contents($this->config->rootPath . '/database/schema.sql');
        if ($schema === false) {
            throw new RuntimeException('Could not read database/schema.sql.');
        }
        $pdo->exec($schema);

        $repository = new BackendRepository($pdo);
        if ($repository->countAdmins() > 0 || $repository->getInstallSettings()) {
            throw new RuntimeException('SelfHdb is already installed.');
        }

        $admin = $repository->createUser(
            $adminEmail,
            password_hash($adminPassword, PASSWORD_DEFAULT),
            (string) ($input['adminName'] ?? ''),
            'admin'
        );
        $repository->ensureDefaultCalendar($admin['id'], (string) ($values['APP_TIMEZONE'] ?? 'UTC'));
        $settings = $repository->saveInstallSettings((string) ($input['organizationName'] ?? 'SelfHdb'), $admin['id']);
        $repository->appendAuditLog($admin['id'], null, 'setup_install', 'install_settings', '1', $request->ipAddress, [
            'organizationName' => $settings['organization_name'] ?? 'SelfHdb',
        ]);

        $envWritten = false;
        if (!is_file($this->config->envPath) && (is_writable(dirname($this->config->envPath)) || is_writable($this->config->rootPath))) {
            $envWritten = file_put_contents($this->config->envPath, $envContent . "\n", LOCK_EX) !== false;
        } elseif (is_writable($this->config->envPath)) {
            $envWritten = file_put_contents($this->config->envPath, $envContent . "\n", LOCK_EX) !== false;
        }

        return [
            'installed' => true,
            'envWritten' => $envWritten,
            'envContent' => $envWritten ? null : $envContent,
            'organizationName' => $settings['organization_name'] ?? 'SelfHdb',
            'admin' => [
                'id' => $admin['id'],
                'email' => $admin['email'],
                'role' => $admin['role'] ?? 'admin',
            ],
        ];
    }

    private function renderLogin(Request $request, string $message = ''): void
    {
        if (!$this->isSetupComplete()) {
            Response::redirect('/setup');
        }

        $installed = isset($request->query['installed'])
            ? '<p class="notice">SelfHdb is installed. Sign in with the first admin account.</p>'
            : '';
        $html = '<h1>SelfHdb login</h1>'
            . $installed
            . ($message !== '' ? '<p class="error">' . $this->e($message) . '</p>' : '')
            . '<form method="post" action="/login" class="grid">'
            . $this->input('email', 'Email', '', 'email')
            . $this->input('password', 'Password', '', 'password')
            . '<button type="submit">Sign in</button>'
            . '</form>';

        Response::html($this->layout('SelfHdb login', $html));
    }

    private function handleLoginForm(Request $request): void
    {
        try {
            $body = $request->form();
            $result = $this->authService()->login(
                (string) ($body['email'] ?? ''),
                (string) ($body['password'] ?? ''),
                [
                    'id' => 'web-' . substr(hash('sha256', $request->userAgent . '|' . $request->ipAddress), 0, 40),
                    'name' => 'Web browser',
                    'type' => 'browser',
                ],
                $request->ipAddress,
                $request->userAgent
            );
            $secure = $request->isSecure();
            setcookie('selfhdb_access_token', $result['accessToken'], [
                'expires' => time() + $this->config->accessTokenTtlSeconds,
                'path' => '/',
                'secure' => $secure,
                'httponly' => true,
                'samesite' => 'Lax',
            ]);
            Response::redirect(($result['user']['role'] ?? 'member') === 'admin' ? '/admin' : '/shared-with-me');
        } catch (\Throwable $error) {
            $this->renderLogin($request, $error->getMessage());
        }
    }

    private function logoutBrowser(): void
    {
        setcookie('selfhdb_access_token', '', [
            'expires' => time() - 3600,
            'path' => '/',
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        Response::redirect('/login');
    }

    private function renderAdmin(Request $request, string $message = ''): void
    {
        $auth = $this->browserAuth($request);
        if (!$auth) {
            Response::redirect('/login');
        }
        if (($auth['user']['role'] ?? 'member') !== 'admin') {
            Response::html($this->layout('Admin required', '<h1>Admin required</h1><p class="muted">This account does not have admin access.</p>'), 403);
        }
        $settings = $this->repository()->getInstallSettings();
        $users = $this->repository()->listUsers();
        $invites = $this->repository()->listInviteKeys();
        $shares = $this->repository()->listCalendarShares($auth['user']['id']);
        $audit = $this->repository()->listAuditLog(30);

        $userRows = implode('', array_map(fn (array $user): string =>
            '<tr><td>' . $this->e($user['email']) . '</td><td>' . $this->e($user['display_name'] ?? '') . '</td><td>' . $this->e($user['role'] ?? 'member') . '</td><td>' . ((int) $user['is_active'] === 1 ? 'active' : 'inactive') . '</td><td><form method="post" action="/admin/users"><input type="hidden" name="userId" value="' . $this->e($user['id']) . '"><input type="hidden" name="isActive" value="' . ((int) $user['is_active'] === 1 ? '0' : '1') . '"><button type="submit">' . ((int) $user['is_active'] === 1 ? 'Deactivate' : 'Activate') . '</button></form></td></tr>',
            $users
        ));
        $inviteRows = implode('', array_map(fn (array $invite): string =>
            '<tr><td>' . $this->e($invite['label']) . '</td><td>' . $this->e($invite['role']) . '</td><td>' . $this->e((string) $invite['useCount']) . '/' . $this->e((string) ($invite['maxUses'] ?? 'unlimited')) . '</td><td>' . $this->e($invite['expiresAt'] ?? '') . '</td><td>' . ($invite['revokedAt'] ? 'revoked' : 'active') . '</td><td><form method="post" action="/admin/invite-keys"><input type="hidden" name="action" value="revoke"><input type="hidden" name="inviteKeyId" value="' . $this->e($invite['id']) . '"><button type="submit">Revoke</button></form></td></tr>',
            $invites
        ));
        $shareRows = implode('', array_map(fn (array $share): string =>
            '<tr><td>' . $this->e($share['name']) . '</td><td>' . $this->e($share['accessMode'] ?? 'link') . '</td><td>' . $this->e($share['privacyLevel']) . '</td><td>' . $this->e($share['revokedAt'] ?? 'active') . '</td><td>' . $this->e($this->formatShareForResponse($share)['url'] ?? '') . '</td></tr>',
            $shares
        ));
        $auditRows = implode('', array_map(fn (array $entry): string =>
            '<tr><td>' . $this->e($entry['createdAt']) . '</td><td>' . $this->e($entry['email'] ?? '') . '</td><td>' . $this->e($entry['action']) . '</td><td>' . $this->e($entry['targetType'] ?? '') . '</td><td>' . $this->e($entry['targetId'] ?? '') . '</td></tr>',
            $audit
        ));

        $html = '<div class="topline"><h1>' . $this->e($settings['organization_name'] ?? 'SelfHdb') . ' admin</h1><form method="post" action="/logout"><button>Log out</button></form></div>'
            . ($message !== '' ? '<p class="notice">' . $this->e($message) . '</p>' : '')
            . '<section><h2>Create invite key</h2><form method="post" action="/admin/invite-keys" class="inline-form">'
            . $this->input('label', 'Label', 'Employees')
            . '<label>Role<select name="role"><option value="member">Member</option><option value="admin">Admin</option></select></label>'
            . $this->input('maxUses', 'Max uses', '20', 'number')
            . $this->input('expiresAt', 'Expires', '', 'date')
            . '<button type="submit">Create key</button></form></section>'
            . '<section><h2>Users</h2><table><tbody>' . $userRows . '</tbody></table></section>'
            . '<section><h2>Invite keys</h2><table><tbody>' . $inviteRows . '</tbody></table></section>'
            . '<section><h2>Your share links</h2><table><tbody>' . $shareRows . '</tbody></table></section>'
            . '<section><h2>Audit</h2><table><tbody>' . $auditRows . '</tbody></table></section>';

        Response::html($this->layout('SelfHdb admin', $html));
    }

    private function handleAdminInviteKeyForm(Request $request): void
    {
        $auth = $this->requireAdmin($request);
        $body = $request->form();
        if (($body['action'] ?? '') === 'revoke') {
            $invite = $this->repository()->revokeInviteKey((string) ($body['inviteKeyId'] ?? ''));
            $this->repository()->appendAuditLog($auth['user']['id'], $auth['device']['id'], 'invite_key_revoke', 'invite_key', $invite['id'], $request->ipAddress);
            $this->renderAdmin($request, 'Invite key revoked.');
        }

        $invite = $this->repository()->createInviteKey($auth['user']['id'], $body);
        $this->repository()->appendAuditLog($auth['user']['id'], $auth['device']['id'], 'invite_key_create', 'invite_key', $invite['id'], $request->ipAddress);
        $this->renderAdmin($request, 'Invite key created: ' . (string) ($invite['code'] ?? ''));
    }

    private function handleAdminUserForm(Request $request): void
    {
        $auth = $this->requireAdmin($request);
        $body = $request->form();
        $userId = (string) ($body['userId'] ?? '');
        if ($userId === '') {
            $this->renderAdmin($request, 'User id is required.');
        }

        $updated = $this->repository()->updateUserFromAdmin($userId, $body);
        $this->repository()->appendAuditLog($auth['user']['id'], $auth['device']['id'], 'admin_user_update', 'user', $updated['id'], $request->ipAddress);
        $this->renderAdmin($request, 'User updated.');
    }

    private function renderSharedWithMe(Request $request): void
    {
        $auth = $this->browserAuth($request);
        if (!$auth) {
            Response::redirect('/login');
        }
        $shares = $this->repository()->listSharesForRecipient($auth['user']['id'], (string) $auth['user']['email']);
        $items = implode('', array_map(fn (array $share): string =>
            '<article class="card"><h2>' . $this->e($share['name']) . '</h2>' . $this->renderCalendarProjection($share['calendar'] ?? []) . '</article>',
            $shares
        ));

        Response::html($this->layout('Shared with me', '<div class="topline"><h1>Shared with me</h1><form method="post" action="/logout"><button>Log out</button></form></div>' . ($items ?: '<p class="muted">No calendars have been shared with this account yet.</p>')));
    }

    private function renderPublicShare(string $token): void
    {
        $share = $this->repository()->getPublicCalendarShare($token);
        if (!$share) {
            Response::html($this->layout('Share not found', '<h1>Share not found</h1><p class="muted">This calendar link was revoked, expired, or does not exist.</p>'), 404);
        }

        $html = '<h1>' . $this->e($share['name']) . '</h1>'
            . '<p class="muted">Privacy: ' . $this->e($share['privacyLevel']) . '</p>'
            . $this->renderCalendarProjection($share['calendar'] ?? []);
        Response::html($this->layout($share['name'], $html));
    }

    private function browserAuth(Request $request): ?array
    {
        $token = $request->authToken();
        return $token ? $this->authService()->authenticate($token) : null;
    }

    private function requireAdmin(Request $request): array
    {
        $auth = $this->requireAuth($request);
        if (($auth['user']['role'] ?? 'member') !== 'admin') {
            Response::error('forbidden', 'Admin access is required.', 403);
        }

        return $auth;
    }

    private function installerEnvValues(array $input): array
    {
        return [
            'APP_ENV' => trim((string) ($input['APP_ENV'] ?? 'production')) ?: 'production',
            'APP_DEBUG' => trim((string) ($input['APP_DEBUG'] ?? 'false')) ?: 'false',
            'APP_URL' => rtrim(trim((string) ($input['APP_URL'] ?? '')), '/') ?: 'http://localhost',
            'APP_TIMEZONE' => trim((string) ($input['APP_TIMEZONE'] ?? 'UTC')) ?: 'UTC',
            'APP_FORCE_HTTPS' => trim((string) ($input['APP_FORCE_HTTPS'] ?? 'true')) ?: 'true',
            'DB_HOST' => trim((string) ($input['DB_HOST'] ?? '127.0.0.1')) ?: '127.0.0.1',
            'DB_PORT' => trim((string) ($input['DB_PORT'] ?? '3306')) ?: '3306',
            'DB_NAME' => trim((string) ($input['DB_NAME'] ?? 'selfhdb')) ?: 'selfhdb',
            'DB_USER' => trim((string) ($input['DB_USER'] ?? 'root')) ?: 'root',
            'DB_PASSWORD' => (string) ($input['DB_PASSWORD'] ?? ''),
            'DB_CHARSET' => trim((string) ($input['DB_CHARSET'] ?? 'utf8mb4')) ?: 'utf8mb4',
            'ACCESS_TOKEN_SECRET' => trim((string) ($input['ACCESS_TOKEN_SECRET'] ?? '')) ?: Str::randomToken(48),
            'ACCESS_TOKEN_TTL_SECONDS' => trim((string) ($input['ACCESS_TOKEN_TTL_SECONDS'] ?? '900')) ?: '900',
            'REFRESH_TOKEN_TTL_SECONDS' => trim((string) ($input['REFRESH_TOKEN_TTL_SECONDS'] ?? '2592000')) ?: '2592000',
            'RATE_LIMIT_AUTH_PER_MINUTE' => trim((string) ($input['RATE_LIMIT_AUTH_PER_MINUTE'] ?? '5')) ?: '5',
            'RATE_LIMIT_REFRESH_PER_15_MIN' => trim((string) ($input['RATE_LIMIT_REFRESH_PER_15_MIN'] ?? '20')) ?: '20',
            'RATE_LIMIT_SYNC_PUSH_PER_MINUTE' => trim((string) ($input['RATE_LIMIT_SYNC_PUSH_PER_MINUTE'] ?? '100')) ?: '100',
            'RATE_LIMIT_SYNC_PULL_PER_MINUTE' => trim((string) ($input['RATE_LIMIT_SYNC_PULL_PER_MINUTE'] ?? '120')) ?: '120',
            'SYNC_PULL_LIMIT' => trim((string) ($input['SYNC_PULL_LIMIT'] ?? '200')) ?: '200',
            'MAX_JSON_BODY_BYTES' => trim((string) ($input['MAX_JSON_BODY_BYTES'] ?? '262144')) ?: '262144',
        ];
    }

    private function buildEnvContent(array $values): string
    {
        $order = [
            'APP_ENV',
            'APP_DEBUG',
            'APP_URL',
            'APP_TIMEZONE',
            'APP_FORCE_HTTPS',
            'DB_HOST',
            'DB_PORT',
            'DB_NAME',
            'DB_USER',
            'DB_PASSWORD',
            'DB_CHARSET',
            'ACCESS_TOKEN_SECRET',
            'ACCESS_TOKEN_TTL_SECONDS',
            'REFRESH_TOKEN_TTL_SECONDS',
            'RATE_LIMIT_AUTH_PER_MINUTE',
            'RATE_LIMIT_REFRESH_PER_15_MIN',
            'RATE_LIMIT_SYNC_PUSH_PER_MINUTE',
            'RATE_LIMIT_SYNC_PULL_PER_MINUTE',
            'SYNC_PULL_LIMIT',
            'MAX_JSON_BODY_BYTES',
        ];

        return implode("\n", array_map(fn (string $key): string => $key . '=' . trim((string) ($values[$key] ?? '')), $order));
    }

    private function renderCalendarProjection(array $projection): string
    {
        $events = is_array($projection['events'] ?? null) ? $projection['events'] : [];
        if ($events === []) {
            return '<p class="muted">No visible events in this shared calendar.</p>';
        }

        return '<div class="events">' . implode('', array_map(fn (array $event): string =>
            '<article class="event"><strong>' . $this->e($event['title'] ?? 'Busy') . '</strong><span>' . $this->e($event['startsAt'] ?? '') . ' - ' . $this->e($event['endsAt'] ?? '') . '</span>'
            . (!empty($event['location']) ? '<span>' . $this->e($event['location']) . '</span>' : '')
            . (!empty($event['description']) ? '<p>' . $this->e($event['description']) . '</p>' : '')
            . '</article>',
            $events
        )) . '</div>';
    }

    private function formatUserForAdmin(array $user): array
    {
        return [
            'id' => $user['id'],
            'email' => $user['email'],
            'displayName' => $user['display_name'] ?? null,
            'role' => $user['role'] ?? 'member',
            'isActive' => (bool) ($user['is_active'] ?? 1),
            'createdAt' => $user['created_at'] ?? null,
            'updatedAt' => $user['updated_at'] ?? null,
        ];
    }

    private function input(string $name, string $label, string $value = '', string $type = 'text'): string
    {
        return '<label>' . $this->e($label) . '<input name="' . $this->e($name) . '" type="' . $this->e($type) . '" value="' . $this->e($value) . '"></label>';
    }

    private function layout(string $title, string $body): string
    {
        return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'
            . $this->e($title)
            . '</title><style>
            :root{color-scheme:light dark;font-family:Inter,Segoe UI,Arial,sans-serif;background:#f6f7fb;color:#172033}
            body{margin:0;padding:32px;display:flex;justify-content:center}
            main{width:min(1080px,100%);background:#fff;border:1px solid #d9deea;border-radius:8px;padding:24px;box-shadow:0 18px 50px rgba(20,28,45,.08)}
            h1{margin:0 0 12px;font-size:28px} h2{font-size:18px;margin:24px 0 10px}.muted{color:#667085}.grid{display:grid;gap:14px;max-width:680px}
            label{display:grid;gap:6px;font-weight:600} input,select,textarea{font:inherit;border:1px solid #cbd5e1;border-radius:6px;padding:10px;background:#fff;color:#172033}
            textarea{width:100%;box-sizing:border-box;font-family:Consolas,monospace}button{border:0;border-radius:6px;padding:10px 14px;background:#275efe;color:white;font-weight:700;cursor:pointer}
            table{width:100%;border-collapse:collapse;font-size:14px}td{border-top:1px solid #e5e7eb;padding:8px;vertical-align:top}.topline{display:flex;justify-content:space-between;gap:16px;align-items:center}
            .inline-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;align-items:end}.notice{background:#edf7ed;border:1px solid #b7dfb7;padding:12px;border-radius:6px}.error{background:#fff1f2;border:1px solid #fda4af;padding:12px;border-radius:6px}.card,.event{border:1px solid #e5e7eb;border-radius:8px;padding:14px;margin:10px 0}.event{display:grid;gap:4px}
            @media (prefers-color-scheme:dark){:root{background:#111827;color:#e5e7eb}main,input,select,textarea{background:#182235;color:#e5e7eb;border-color:#334155}.muted{color:#aab4c5}td{border-color:#334155}}
            </style></head><body><main>' . $body . '</main></body></html>';
    }

    private function e(mixed $value): string
    {
        return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    private function requireAuth(Request $request): array
    {
        $token = $request->authToken();
        if (!$token) {
            Response::error('unauthorized', 'Bearer token is required.', 401);
        }

        $auth = $this->authService()->authenticate($token);
        if (!$auth) {
            Response::error('unauthorized', 'Access token is invalid or expired.', 401);
        }

        return $auth;
    }

    private function formatShareForResponse(array $share): array
    {
        $token = (string) ($share['token'] ?? $share['publicToken'] ?? '');
        $accessMode = (string) ($share['accessMode'] ?? 'link');
        $url = $token !== '' && $accessMode !== 'org'
            ? $this->config->appUrl . '/share/' . rawurlencode($token)
            : null;
        unset($share['token']);
        unset($share['publicToken']);

        return [
            ...$share,
            'url' => $url,
        ];
    }

    private function enforceTransportSecurity(Request $request): void
    {
        if (!$this->config->hasEnv) {
            return;
        }

        if (!$this->config->forceHttps) {
            return;
        }

        if ($this->config->appEnv === 'production' && !$request->isSecure()) {
            Response::error('https_required', 'HTTPS is required in production.', 400);
        }
    }

    private function enforceRateLimit(string $bucket, string $key, int $limit, int $windowSeconds): void
    {
        if (!$this->rateLimiter()->hit($bucket, $key, $limit, $windowSeconds)) {
            Response::error('rate_limited', 'Too many requests. Please try again later.', 429);
        }
    }
}
