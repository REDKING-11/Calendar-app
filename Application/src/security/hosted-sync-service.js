const path = require('node:path');

const { buildSelfHdbEnv } = require('../shared/selfhdb-setup');

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function isLoopbackHost(hostname) {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(hostname || '').toLowerCase());
}

function normalizeBaseUrl(candidate) {
  let parsedUrl;
  try {
    parsedUrl = new URL(String(candidate || '').trim());
  } catch (_error) {
    throw new Error('Hosted backend URL must be a valid URL.');
  }

  if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
    throw new Error('Hosted backend URL must use HTTP or HTTPS.');
  }

  if (parsedUrl.protocol === 'http:' && !isLoopbackHost(parsedUrl.hostname)) {
    throw new Error('Hosted backend must use HTTPS unless it is running on localhost.');
  }

  parsedUrl.hash = '';
  parsedUrl.search = '';

  return parsedUrl.toString().replace(/\/$/, '');
}

class HostedSyncService {
  constructor({
    db,
    cryptoService,
    deviceService,
    fetchImpl = fetch,
    onAudit,
    callbacks,
  }) {
    this.db = db;
    this.cryptoService = cryptoService;
    this.deviceService = deviceService;
    this.fetchImpl = fetchImpl;
    this.onAudit = onAudit;
    this.callbacks = callbacks || {};
    this.stateId = 'default';
  }

  initializeSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hosted_sync_state (
        state_id TEXT PRIMARY KEY,
        base_url TEXT,
        provider TEXT,
        connection_status TEXT NOT NULL DEFAULT 'disconnected',
        backend_claimed INTEGER NOT NULL DEFAULT 0,
        enabled_providers_json TEXT NOT NULL DEFAULT '[]',
        pending_auth_state TEXT,
        pending_flow_type TEXT,
        pending_auth_expires_at TEXT,
        account_email TEXT,
        display_name TEXT,
        session_id TEXT,
        access_token_cipher_text TEXT,
        refresh_token_cipher_text TEXT,
        access_token_expires_at TEXT,
        refresh_token_expires_at TEXT,
        server_cursor INTEGER NOT NULL DEFAULT 0,
        last_pushed_sequence INTEGER NOT NULL DEFAULT 0,
        last_synced_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    const existing = this.db
      .prepare(
        `SELECT state_id AS stateId
         FROM hosted_sync_state
         WHERE state_id = :stateId`
      )
      .get({ stateId: this.stateId });

    if (!existing) {
      const timestamp = nowIso();
      this.db
        .prepare(
          `INSERT INTO hosted_sync_state (
            state_id,
            connection_status,
            backend_claimed,
            enabled_providers_json,
            server_cursor,
            last_pushed_sequence,
            created_at,
            updated_at
          ) VALUES (
            :stateId,
            'disconnected',
            0,
            '[]',
            0,
            0,
            :createdAt,
            :updatedAt
          )`
        )
        .run({
          stateId: this.stateId,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
    }
  }

  getStateRow() {
    return this.db
      .prepare(
        `SELECT
          state_id AS stateId,
          base_url AS baseUrl,
          provider,
          connection_status AS connectionStatus,
          backend_claimed AS backendClaimed,
          enabled_providers_json AS enabledProvidersJson,
          account_email AS accountEmail,
          display_name AS displayName,
          session_id AS sessionId,
          access_token_cipher_text AS accessTokenCipherText,
          refresh_token_cipher_text AS refreshTokenCipherText,
          access_token_expires_at AS accessTokenExpiresAt,
          refresh_token_expires_at AS refreshTokenExpiresAt,
          server_cursor AS serverCursor,
          last_pushed_sequence AS lastPushedSequence,
          last_synced_at AS lastSyncedAt,
          last_error AS lastError,
          created_at AS createdAt,
          updated_at AS updatedAt
         FROM hosted_sync_state
         WHERE state_id = :stateId`
      )
      .get({ stateId: this.stateId });
  }

  updateState(patch = {}) {
    const current = this.getStateRow();
    const nextState = {
      ...current,
      ...patch,
      updatedAt: nowIso(),
    };

    this.db
      .prepare(
        `UPDATE hosted_sync_state
         SET
           base_url = :baseUrl,
           provider = :provider,
           connection_status = :connectionStatus,
           backend_claimed = :backendClaimed,
           enabled_providers_json = :enabledProvidersJson,
           pending_auth_state = NULL,
           pending_flow_type = NULL,
           pending_auth_expires_at = NULL,
           account_email = :accountEmail,
           display_name = :displayName,
           session_id = :sessionId,
           access_token_cipher_text = :accessTokenCipherText,
           refresh_token_cipher_text = :refreshTokenCipherText,
           access_token_expires_at = :accessTokenExpiresAt,
           refresh_token_expires_at = :refreshTokenExpiresAt,
           server_cursor = :serverCursor,
           last_pushed_sequence = :lastPushedSequence,
           last_synced_at = :lastSyncedAt,
           last_error = :lastError,
           updated_at = :updatedAt
         WHERE state_id = :stateId`
      )
      .run(nextState);

    return this.getState();
  }

  getState() {
    const row = this.getStateRow();
    return {
      enabled: Boolean(row?.baseUrl),
      baseUrl: row?.baseUrl || '',
      authMode: row?.provider || null,
      connectionStatus: row?.connectionStatus || 'disconnected',
      backendClaimed: Boolean(row?.backendClaimed),
      enabledProviders: parseJson(row?.enabledProvidersJson, []),
      accountEmail: row?.accountEmail || null,
      displayName: row?.displayName || null,
      sessionId: row?.sessionId || null,
      accessTokenExpiresAt: row?.accessTokenExpiresAt || null,
      refreshTokenExpiresAt: row?.refreshTokenExpiresAt || null,
      serverCursor: Number(row?.serverCursor || 0),
      lastPushedSequence: Number(row?.lastPushedSequence || 0),
      lastSyncedAt: row?.lastSyncedAt || null,
      lastError: row?.lastError || null,
      createdAt: row?.createdAt || null,
      updatedAt: row?.updatedAt || null,
    };
  }

  getStoredTokens() {
    const row = this.getStateRow();
    return {
      accessToken: row?.accessTokenCipherText
        ? this.cryptoService.decryptText(
            row.accessTokenCipherText,
            'hosted-sync:access-token'
          )
        : null,
      refreshToken: row?.refreshTokenCipherText
        ? this.cryptoService.decryptText(
            row.refreshTokenCipherText,
            'hosted-sync:refresh-token'
          )
        : null,
      accessTokenExpiresAt: row?.accessTokenExpiresAt || null,
      refreshTokenExpiresAt: row?.refreshTokenExpiresAt || null,
      sessionId: row?.sessionId || null,
      baseUrl: row?.baseUrl || null,
    };
  }

  async parseResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }

    const text = await response.text();
    return text ? { message: text } : {};
  }

  async requestJson({ method = 'GET', baseUrl, path: urlPath, body, accessToken }) {
    const headers = {
      Accept: 'application/json',
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const response = await this.fetchImpl(`${baseUrl}${urlPath}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const payload = await this.parseResponse(response);
    if (!response.ok) {
      const error = new Error(
        payload?.message || `Hosted backend request failed with status ${response.status}.`
      );
      error.statusCode = response.status;
      error.code = payload?.error || 'hosted_backend_request_failed';
      error.details = payload?.details;
      throw error;
    }

    return payload?.result ?? payload;
  }

  buildDevicePayload(deviceLabel) {
    const localDevice = this.deviceService.getLocalDeviceProfile();

    return {
      id: localDevice.deviceId,
      name: String(deviceLabel || localDevice.label || '').trim() || localDevice.label,
      type: 'desktop',
    };
  }

  resetSessionState(baseUrl, authMode, enabledProviders, backendClaimed) {
    return this.updateState({
      baseUrl,
      provider: authMode || null,
      connectionStatus: baseUrl ? 'configured' : 'disconnected',
      backendClaimed: backendClaimed ? 1 : 0,
      enabledProvidersJson: JSON.stringify(enabledProviders || []),
      accountEmail: null,
      displayName: null,
      sessionId: null,
      accessTokenCipherText: null,
      refreshTokenCipherText: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      serverCursor: 0,
      lastPushedSequence: 0,
      lastSyncedAt: null,
      lastError: null,
    });
  }

  async testConnection(baseUrl) {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const health = await this.requestJson({
      method: 'GET',
      baseUrl: normalizedBaseUrl,
      path: '/v1/health',
    });
    const bootstrap = await this.requestJson({
      method: 'GET',
      baseUrl: normalizedBaseUrl,
      path: '/v1/bootstrap/status',
    });

    if (!Array.isArray(bootstrap.enabledProviders) || !bootstrap.enabledProviders.includes('password')) {
      throw new Error('This backend does not advertise password sign-in support.');
    }

    this.resetSessionState(
      normalizedBaseUrl,
      bootstrap.authMode || 'local_password',
      bootstrap.enabledProviders,
      bootstrap.claimed
    );

    this.onAudit?.('hosted_connection_verified', {
      targetType: 'hosted_backend',
      targetId: normalizedBaseUrl,
      details: {
        authMode: bootstrap.authMode || 'local_password',
        status: health.status || 'ok',
      },
    });

    return {
      hosted: this.getState(),
      health,
      bootstrap,
    };
  }

  storeAuthenticatedSession(baseUrl, sessionResult, authMode = 'local_password') {
    const latestCursor = Number(sessionResult?.syncState?.serverCursor || 0);

    this.updateState({
      baseUrl,
      provider: authMode,
      connectionStatus: 'connected',
      backendClaimed: 1,
      enabledProvidersJson: JSON.stringify(['password']),
      accountEmail: sessionResult?.user?.email || null,
      displayName: sessionResult?.device?.name || null,
      sessionId: sessionResult?.sessionId || null,
      accessTokenCipherText: this.cryptoService.encryptText(
        sessionResult.accessToken,
        'hosted-sync:access-token'
      ),
      refreshTokenCipherText: this.cryptoService.encryptText(
        sessionResult.refreshToken,
        'hosted-sync:refresh-token'
      ),
      accessTokenExpiresAt: sessionResult.accessTokenExpiresAt || null,
      refreshTokenExpiresAt: sessionResult.refreshTokenExpiresAt || null,
      serverCursor: latestCursor,
      lastError: null,
    });
  }

  async register({ baseUrl, email, password, deviceName }) {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    await this.testConnection(normalizedBaseUrl);
    const result = await this.requestJson({
      method: 'POST',
      baseUrl: normalizedBaseUrl,
      path: '/v1/auth/register',
      body: {
        email,
        password,
        device: this.buildDevicePayload(deviceName),
      },
    });

    this.storeAuthenticatedSession(normalizedBaseUrl, result);

    this.onAudit?.('hosted_auth_registered', {
      targetType: 'hosted_backend',
      targetId: normalizedBaseUrl,
      details: {
        accountEmail: result?.user?.email || null,
      },
    });

    return {
      hosted: this.getState(),
      result,
    };
  }

  async login({ baseUrl, email, password, deviceName }) {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    await this.testConnection(normalizedBaseUrl);
    const result = await this.requestJson({
      method: 'POST',
      baseUrl: normalizedBaseUrl,
      path: '/v1/auth/login',
      body: {
        email,
        password,
        device: this.buildDevicePayload(deviceName),
      },
    });

    this.storeAuthenticatedSession(normalizedBaseUrl, result);

    this.onAudit?.('hosted_auth_logged_in', {
      targetType: 'hosted_backend',
      targetId: normalizedBaseUrl,
      details: {
        accountEmail: result?.user?.email || null,
      },
    });

    return {
      hosted: this.getState(),
      result,
    };
  }

  async refreshSession() {
    const state = this.getState();
    const tokens = this.getStoredTokens();

    if (!tokens.baseUrl || !tokens.refreshToken) {
      throw new Error('Hosted backend refresh token is missing.');
    }

    const result = await this.requestJson({
      method: 'POST',
      baseUrl: tokens.baseUrl,
      path: '/v1/auth/refresh',
      body: {
        refreshToken: tokens.refreshToken,
      },
    });

    this.storeAuthenticatedSession(tokens.baseUrl, {
      ...result,
      user: result.user || { email: state.accountEmail },
      device: result.device || { name: state.displayName },
      syncState: { serverCursor: state.serverCursor },
    });

    return result.accessToken;
  }

  async ensureAccessToken() {
    const state = this.getState();
    const tokens = this.getStoredTokens();

    if (!state.baseUrl || !tokens.refreshToken) {
      throw new Error('Hosted backend is not signed in yet.');
    }

    if (tokens.accessToken && tokens.accessTokenExpiresAt) {
      const accessExpiry = new Date(tokens.accessTokenExpiresAt).getTime();
      if (accessExpiry - Date.now() > 30 * 1000) {
        return tokens.accessToken;
      }
    }

    const refreshExpiry = tokens.refreshTokenExpiresAt
      ? new Date(tokens.refreshTokenExpiresAt).getTime()
      : 0;
    if (refreshExpiry && refreshExpiry <= Date.now()) {
      this.updateState({
        connectionStatus: state.baseUrl ? 'configured' : 'disconnected',
        accountEmail: null,
        displayName: null,
        sessionId: null,
        accessTokenCipherText: null,
        refreshTokenCipherText: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        lastError: 'Hosted backend session expired. Sign in again.',
      });
      throw new Error('Hosted backend session expired. Sign in again.');
    }

    return this.refreshSession();
  }

  async authorizedRequest(input, allowRetry = true) {
    const accessToken = await this.ensureAccessToken();
    const state = this.getState();

    try {
      return await this.requestJson({
        ...input,
        baseUrl: state.baseUrl,
        accessToken,
      });
    } catch (error) {
      if (allowRetry && error.statusCode === 401) {
        await this.refreshSession();
        return this.authorizedRequest(input, false);
      }

      throw error;
    }
  }

  async disconnect() {
    const state = this.getState();
    const baseUrl = state.baseUrl;

    try {
      if (state.connectionStatus === 'connected') {
        await this.authorizedRequest({
          method: 'POST',
          path: '/v1/auth/logout',
          body: {},
        });
      }
    } catch (_error) {
      // Local disconnect should still succeed even if the remote session is already gone.
    }

    this.updateState({
      connectionStatus: baseUrl ? 'configured' : 'disconnected',
      accountEmail: null,
      displayName: null,
      sessionId: null,
      accessTokenCipherText: null,
      refreshTokenCipherText: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      lastError: null,
    });

    this.onAudit?.('hosted_auth_disconnected', {
      targetType: 'hosted_backend',
      targetId: baseUrl || 'unconfigured',
    });

    return this.getState();
  }

  async syncNow() {
    const state = this.getState();
    if (!state.baseUrl) {
      throw new Error('Configure a hosted backend URL first.');
    }

    if (state.connectionStatus !== 'connected') {
      throw new Error('Sign in to the hosted backend before syncing.');
    }

    const localDevice = this.deviceService.getLocalDeviceProfile();
    const firstSync = state.serverCursor === 0 && state.lastPushedSequence === 0;

    if (firstSync) {
      this.callbacks.prepareHostedBootstrap?.();
      const bootstrap = await this.authorizedRequest({
        method: 'POST',
        path: '/v1/sync/bootstrap',
        body: {},
      });
      this.updateState({
        serverCursor: Number(bootstrap?.serverCursor || 0),
        lastError: null,
      });
    }

    const latestState = this.getState();
    const initialPull = await this.authorizedRequest({
      method: 'GET',
      path: `/v1/sync/pull?cursor=${encodeURIComponent(latestState.serverCursor)}`,
    });

    let appliedRemote = 0;
    for (const envelope of initialPull.envelopes || []) {
      if (envelope.deviceId === localDevice.deviceId) {
        continue;
      }

      this.callbacks.applyEnvelope?.(envelope);
      appliedRemote += 1;
    }

    let nextCursor = Number(
      initialPull.latestServerCursor || initialPull.serverCursor || latestState.serverCursor || 0
    );
    const localEnvelopes = this.callbacks.listEnvelopesSince?.(latestState.lastPushedSequence) || [];
    let pushedCount = 0;
    let lastPushedSequence = latestState.lastPushedSequence;

    if (localEnvelopes.length > 0) {
      const pushResult = await this.authorizedRequest({
        method: 'POST',
        path: '/v1/sync/push',
        body: {
          envelopes: localEnvelopes,
        },
      });

      pushedCount = Number(pushResult.acceptedCount || 0);
      lastPushedSequence = Math.max(
        latestState.lastPushedSequence,
        ...localEnvelopes.map((envelope) => Number(envelope.deviceSequence || 0))
      );

      const secondPull = await this.authorizedRequest({
        method: 'GET',
        path: `/v1/sync/pull?cursor=${encodeURIComponent(
          pushResult.latestServerCursor || nextCursor
        )}`,
      });

      for (const envelope of secondPull.envelopes || []) {
        if (envelope.deviceId === localDevice.deviceId) {
          continue;
        }

        this.callbacks.applyEnvelope?.(envelope);
        appliedRemote += 1;
      }

      nextCursor = Number(
        secondPull.latestServerCursor || pushResult.latestServerCursor || nextCursor || 0
      );
    }

    this.updateState({
      connectionStatus: 'connected',
      serverCursor: nextCursor,
      lastPushedSequence,
      lastSyncedAt: nowIso(),
      lastError: null,
    });

    this.onAudit?.('hosted_sync_completed', {
      targetType: 'hosted_backend',
      targetId: state.baseUrl,
      details: {
        pushedCount,
        pulledCount: appliedRemote,
        serverCursor: nextCursor,
      },
    });

    return {
      hosted: this.getState(),
      sync: {
        pushedCount,
        pulledCount: appliedRemote,
        serverCursor: nextCursor,
      },
    };
  }

  buildEnvFile(values) {
    return buildSelfHdbEnv(values);
  }

  buildDefaultEnvFilename() {
    return path.join(process.cwd(), '.env');
  }
}

module.exports = {
  HostedSyncService,
  normalizeBaseUrl,
};
