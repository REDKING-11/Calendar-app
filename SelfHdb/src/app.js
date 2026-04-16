const Fastify = require('fastify');

const { createConfig } = require('./config');
const { createDb } = require('./db/pool');
const { ApiError, assert } = require('./lib/errors');
const { MemoryRateLimiter, createRateLimitGuard } = require('./lib/rate-limit');
const { AuthService } = require('./services/auth-service');
const { DeviceService } = require('./services/device-service');
const { SyncService } = require('./services/sync-service');

function normalizeOrigin(origin) {
  try {
    return new URL(origin).origin;
  } catch (_error) {
    return '';
  }
}

function createApp(overrides = {}) {
  const config = overrides.config || createConfig();
  const db = overrides.db || createDb(config);
  const rateLimiter = new MemoryRateLimiter();
  const authService = new AuthService({
    db,
    config,
    fetchImpl: overrides.fetchImpl || fetch,
  });
  const deviceService = new DeviceService({
    db,
    config,
    authService,
  });
  const syncService = new SyncService({
    db,
    config,
  });

  const app = Fastify({
    logger: {
      level: config.nodeEnv === 'production' ? 'info' : 'debug',
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.refreshToken',
        'req.body.bootstrapToken',
        'req.body.stepUpToken',
        'req.body.contentPatch',
        'req.body.envelopes',
      ],
    },
  });

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('services', {
    authService,
    deviceService,
    syncService,
  });

  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'OPTIONS') {
      reply.code(204).send();
      return reply;
    }

    const originHeader = request.headers.origin;
    const normalizedOrigin = originHeader ? normalizeOrigin(originHeader) : '';
    if (normalizedOrigin && config.corsAllowedOrigins.includes(normalizedOrigin)) {
      reply.header('Access-Control-Allow-Origin', normalizedOrigin);
      reply.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Device-Id, X-Request-Timestamp, X-Request-Nonce, X-Request-Signature');
      reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      reply.header('Vary', 'Origin');
    }

    const forwardedProto = request.headers['x-forwarded-proto'];
    const protocol = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
    const isSecure =
      request.protocol === 'https' ||
      protocol === 'https' ||
      config.nodeEnv !== 'production' ||
      config.allowInsecureHttp;

    if (!isSecure && request.url !== '/healthz') {
      reply.code(400).send({
        error: 'https_required',
        message: 'HTTPS is required for this backend.',
      });
      return reply;
    }

    return undefined;
  });

  app.decorate('authenticate', async function authenticate(request) {
    const authorizationHeader = request.headers.authorization || '';
    const [scheme, token] = authorizationHeader.split(' ');
    assert(scheme === 'Bearer' && token, 401, 'Bearer access token required.', 'missing_bearer_token');
    request.auth = await authService.authenticateAccessToken(token);
    return request.auth;
  });

  app.decorate('requireScopes', function requireScopes(requiredScopes) {
    return async function scopedAuth(request) {
      const auth = request.auth || (await app.authenticate(request));
      for (const scope of requiredScopes) {
        assert(auth.scopes.includes(scope), 403, `Missing required scope ${scope}.`, 'missing_scope');
      }
    };
  });

  const ensureAuthenticated = async (request) => app.authenticate(request);

  const authRateLimit = createRateLimitGuard(rateLimiter, 'auth', {
    max: 5,
    windowMs: 60 * 1000,
  }, (request) => request.ip);

  const refreshRateLimit = createRateLimitGuard(rateLimiter, 'refresh', {
    max: 30,
    windowMs: 15 * 60 * 1000,
  }, (request) => request.ip);

  const pairingRateLimit = createRateLimitGuard(rateLimiter, 'pairing', {
    max: 5,
    windowMs: 15 * 60 * 1000,
  }, (request) => request.auth?.userId || request.ip);

  const syncRateLimit = createRateLimitGuard(rateLimiter, 'sync', {
    max: 120,
    windowMs: 60 * 1000,
  }, (request) => request.auth?.deviceId || request.ip);

  app.get('/healthz', async () => ({
    ok: true,
    service: 'selfhdb',
    time: new Date().toISOString(),
  }));

  app.get('/v1/bootstrap/status', async () => authService.getBootstrapStatus());

  app.post('/v1/auth/:provider/start', { preHandler: authRateLimit }, async (request) => {
    const provider = request.params.provider;
    const bootstrap = await authService.getBootstrapStatus();
    const flowType = bootstrap.claimed ? 'owner_login' : 'owner_claim';
    return authService.startAuthFlow(provider, request.body || {}, flowType);
  });

  app.get('/v1/auth/:provider/callback', async (request, reply) => {
    const provider = request.params.provider;
    const html = await authService.handleCallback(provider, request.query || {});
    reply.type('text/html').send(html);
  });

  app.get('/v1/auth/flows/:state', { preHandler: authRateLimit }, async (request) => {
    return authService.getFlowStatus(request.params.state);
  });

  app.post('/v1/auth/refresh', { preHandler: refreshRateLimit }, async (request) => {
    return authService.refreshSession(request.body?.refreshToken);
  });

  app.post('/v1/auth/logout', async (request) => {
    const auth = await app.authenticate(request);
    await authService.logoutSession(auth.userId, auth.sessionId);
    return { ok: true };
  });

  app.post('/v1/auth/step-up', async (request) => {
    const auth = await app.authenticate(request);
    return authService.createStepUpToken(
      auth.userId,
      auth.sessionId,
      auth.tokenPayload.iat
    );
  });

  app.post('/v1/auth/pair/consume', { preHandler: authRateLimit }, async (request) => {
    return deviceService.consumePairingBootstrap(request.body || {});
  });

  app.get('/v1/sessions', { preHandler: ensureAuthenticated }, async (request) => {
    const auth = request.auth;
    return {
      sessions: await authService.listSessions(auth.userId),
    };
  });

  app.post('/v1/sessions/:sessionId/revoke', { preHandler: ensureAuthenticated }, async (request) => {
    const auth = request.auth;
    return authService.revokeSession(auth.userId, request.params.sessionId);
  });

  app.get('/v1/devices', { preHandler: ensureAuthenticated }, async (request) => {
    const auth = request.auth;
    return {
      devices: await deviceService.listDevices(auth.userId),
    };
  });

  app.post('/v1/devices/pair/start', { preHandler: [ensureAuthenticated, pairingRateLimit] }, async (request) => {
    const auth = request.auth;
    return deviceService.createPairingCode(auth.userId, request.body?.label);
  });

  app.post('/v1/devices/pair/approve', { preHandler: [ensureAuthenticated, pairingRateLimit] }, async (request) => {
    const auth = request.auth;
    return deviceService.approvePairing({
      userId: auth.userId,
      sessionId: auth.sessionId,
      stepUpToken: request.body?.stepUpToken,
      pairingId: request.body?.pairingId,
      code: request.body?.code,
      candidateDeviceId: request.body?.candidateDeviceId,
      candidateLabel: request.body?.candidateLabel,
      candidatePublicKey: request.body?.candidatePublicKey,
    });
  });

  app.post('/v1/devices/:deviceId/revoke', { preHandler: ensureAuthenticated }, async (request) => {
    const auth = request.auth;
    return deviceService.revokeDevice(auth.userId, request.params.deviceId);
  });

  app.post('/v1/sync/push', { preHandler: [ensureAuthenticated, syncRateLimit] }, async (request) => {
    const auth = request.auth;
    return syncService.pushEnvelopes({
      auth,
      request,
      body: request.body || {},
    });
  });

  app.get('/v1/sync/pull', { preHandler: [ensureAuthenticated, syncRateLimit] }, async (request) => {
    const auth = request.auth;
    return syncService.pullEnvelopes({
      auth,
      since: request.query?.since,
    });
  });

  app.get('/v1/external-accounts', { preHandler: ensureAuthenticated }, async (request) => {
    const auth = request.auth;
    return {
      accounts: await authService.listExternalAccounts(auth.userId),
    };
  });

  app.post('/v1/external-accounts/:provider/connect', { preHandler: ensureAuthenticated }, async (request) => {
    const auth = request.auth;
    return authService.startExternalAccountLink(
      auth.userId,
      request.params.provider,
      request.body?.requestedAccess || 'read'
    );
  });

  app.post('/v1/external-accounts/:accountId/revoke', { preHandler: ensureAuthenticated }, async (request) => {
    const auth = request.auth;
    return authService.revokeExternalAccount(auth.userId, request.params.accountId);
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const code = error instanceof ApiError ? error.code : 'internal_error';
    const message = error instanceof ApiError
      ? error.message
      : 'The backend could not process the request.';

    request.log.error({
      err: error,
      code,
      route: request.routerPath,
    });

    reply.code(statusCode).send({
      error: code,
      message,
      details: error instanceof ApiError ? error.details : undefined,
    });
  });

  app.addHook('onClose', async () => {
    await db.close();
  });

  return app;
}

module.exports = { createApp };
