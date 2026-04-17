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

final class Application
{
    private readonly BackendRepository $repository;
    private readonly AuthService $authService;
    private readonly SyncService $syncService;
    private readonly RateLimiter $rateLimiter;

    public function __construct(private readonly AppConfig $config)
    {
        $database = new Database($config);
        $this->repository = new BackendRepository($database->pdo());
        $this->authService = new AuthService($config, $this->repository, new AccessTokenService($config));
        $this->syncService = new SyncService($config, $this->repository);
        $this->rateLimiter = new RateLimiter($config->rootPath . '/storage/runtime');
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
        $router->add('GET', '/v1/health', fn (Request $_request, array $_params) => Response::success([
            'status' => 'ok',
            'app' => 'SelfHdb',
            'environment' => $this->config->appEnv,
        ]));

        $router->add('GET', '/v1/bootstrap/status', fn (Request $_request, array $_params) => Response::success([
            'claimed' => true,
            'enabledProviders' => ['password'],
            'authMode' => 'local_password',
        ]));

        $router->add('POST', '/v1/auth/register', function (Request $request, array $_params): void {
            $this->enforceRateLimit('auth', $request->ipAddress, $this->config->rateLimits['auth'], 60);
            $body = $request->json();
            $result = $this->authService->register(
                (string) ($body['email'] ?? ''),
                (string) ($body['password'] ?? ''),
                is_array($body['device'] ?? null) ? $body['device'] : [],
                $request->ipAddress,
                $request->userAgent
            );
            $this->repository->appendAuditLog($result['user']['id'], $result['device']['id'], 'auth_register', 'user', $result['user']['id'], $request->ipAddress);
            Response::success($result, null, 201);
        });

        $router->add('POST', '/v1/auth/login', function (Request $request, array $_params): void {
            $this->enforceRateLimit('auth', $request->ipAddress, $this->config->rateLimits['auth'], 60);
            $body = $request->json();
            $result = $this->authService->login(
                (string) ($body['email'] ?? ''),
                (string) ($body['password'] ?? ''),
                is_array($body['device'] ?? null) ? $body['device'] : [],
                $request->ipAddress,
                $request->userAgent
            );
            $this->repository->appendAuditLog($result['user']['id'], $result['device']['id'], 'auth_login', 'session', $result['sessionId'], $request->ipAddress);
            Response::success($result);
        });

        $router->add('POST', '/v1/auth/refresh', function (Request $request, array $_params): void {
            $body = $request->json();
            $key = substr(hash('sha256', (string) ($body['refreshToken'] ?? '')), 0, 24);
            $this->enforceRateLimit('refresh', $key, $this->config->rateLimits['refresh'], 900);
            $result = $this->authService->refresh((string) ($body['refreshToken'] ?? ''));
            $this->repository->appendAuditLog($result['user']['id'], $result['device']['id'], 'auth_refresh', 'session', $result['sessionId'], $request->ipAddress);
            Response::success($result);
        });

        $router->add('POST', '/v1/auth/logout', function (Request $request, array $_params): void {
            $auth = $this->requireAuth($request);
            $this->authService->logout($auth['user']['id'], $auth['session']['id']);
            $this->repository->appendAuditLog($auth['user']['id'], $auth['device']['id'], 'auth_logout', 'session', $auth['session']['id'], $request->ipAddress);
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
                ], $this->repository->listDevices($auth['user']['id'])),
            ]);
        });

        $router->add('POST', '/v1/devices/{id}/revoke', function (Request $request, array $params): void {
            $auth = $this->requireAuth($request);
            $this->repository->revokeDevice($auth['user']['id'], (string) $params['id']);
            $this->repository->appendAuditLog($auth['user']['id'], $auth['device']['id'], 'device_revoke', 'device', (string) $params['id'], $request->ipAddress);
            Response::success(['revoked' => true]);
        });

        $router->add('GET', '/v1/sessions', function (Request $request, array $_params): void {
            $auth = $this->requireAuth($request);
            Response::success([
                'sessions' => $this->repository->listSessions($auth['user']['id']),
            ]);
        });

        $router->add('POST', '/v1/sessions/{id}/revoke', function (Request $request, array $params): void {
            $auth = $this->requireAuth($request);
            $this->repository->revokeSession($auth['user']['id'], (string) $params['id']);
            $this->repository->appendAuditLog($auth['user']['id'], $auth['device']['id'], 'session_revoke', 'session', (string) $params['id'], $request->ipAddress);
            Response::success(['revoked' => true]);
        });

        $router->add('GET', '/v1/sync/state', function (Request $request, array $_params): void {
            $auth = $this->requireAuth($request);
            Response::success($this->syncService->state($auth['user']['id'], $auth['device']['id']));
        });

        $router->add('POST', '/v1/sync/bootstrap', function (Request $request, array $_params): void {
            $auth = $this->requireAuth($request);
            Response::success($this->syncService->bootstrap($auth['user']['id'], $auth['device']['id']));
        });

        $router->add('POST', '/v1/sync/push', function (Request $request, array $_params): void {
            $auth = $this->requireAuth($request);
            $this->enforceRateLimit('sync_push', $auth['device']['id'], $this->config->rateLimits['sync_push'], 60);
            $body = $request->json();
            $result = $this->syncService->push(
                $auth['user']['id'],
                $auth['device']['id'],
                is_array($body['envelopes'] ?? null) ? $body['envelopes'] : []
            );
            $this->repository->appendAuditLog($auth['user']['id'], $auth['device']['id'], 'sync_push', 'sync', $auth['device']['id'], $request->ipAddress, ['acceptedCount' => $result['acceptedCount']]);
            Response::success($result);
        });

        $router->add('GET', '/v1/sync/pull', function (Request $request, array $_params): void {
            $auth = $this->requireAuth($request);
            $this->enforceRateLimit('sync_pull', $auth['device']['id'], $this->config->rateLimits['sync_pull'], 60);
            $cursor = (int) ($request->query['cursor'] ?? $request->query['since'] ?? 0);
            Response::success($this->syncService->pull($auth['user']['id'], $auth['device']['id'], max(0, $cursor)));
        });
    }

    private function requireAuth(Request $request): array
    {
        $token = $request->bearerToken();
        if (!$token) {
            Response::error('unauthorized', 'Bearer token is required.', 401);
        }

        $auth = $this->authService->authenticate($token);
        if (!$auth) {
            Response::error('unauthorized', 'Access token is invalid or expired.', 401);
        }

        return $auth;
    }

    private function enforceTransportSecurity(Request $request): void
    {
        if (!$this->config->forceHttps) {
            return;
        }

        if ($this->config->appEnv === 'production' && !$request->isSecure()) {
            Response::error('https_required', 'HTTPS is required in production.', 400);
        }
    }

    private function enforceRateLimit(string $bucket, string $key, int $limit, int $windowSeconds): void
    {
        if (!$this->rateLimiter->hit($bucket, $key, $limit, $windowSeconds)) {
            Response::error('rate_limited', 'Too many requests. Please try again later.', 429);
        }
    }
}
