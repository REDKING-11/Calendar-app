const crypto = require('node:crypto');

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function randomToken(byteLength = 32) {
  return crypto.randomBytes(byteLength).toString('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

function buildSignedRequestPayload({ method, urlPath, timestamp, nonce, body }) {
  return [
    String(method || 'GET').toUpperCase(),
    urlPath || '/',
    String(timestamp || ''),
    String(nonce || ''),
    sha256(stableStringify(body || {})),
  ].join('\n');
}

function buildEnvelopePayload(envelope) {
  return JSON.stringify({
    deviceId: envelope.deviceId,
    deviceSequence: envelope.deviceSequence,
    entity: envelope.entity,
    entityId: envelope.entityId,
    operation: envelope.operation,
    contentPatch: envelope.contentPatch || null,
    encryptedPatch: envelope.encryptedPatch || null,
    metadataPatch: envelope.metadataPatch || {},
    nonce: envelope.nonce,
    clientTimestamp: envelope.clientTimestamp,
  });
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
    shell,
    fetchImpl = fetch,
    onAudit,
    callbacks,
  }) {
    this.db = db;
    this.cryptoService = cryptoService;
    this.deviceService = deviceService;
    this.shell = shell;
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
          pending_auth_state AS pendingAuthState,
          pending_flow_type AS pendingFlowType,
          pending_auth_expires_at AS pendingAuthExpiresAt,
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
           pending_auth_state = :pendingAuthState,
           pending_flow_type = :pendingFlowType,
           pending_auth_expires_at = :pendingAuthExpiresAt,
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
      provider: row?.provider || null,
      connectionStatus: row?.connectionStatus || 'disconnected',
      backendClaimed: Boolean(row?.backendClaimed),
      enabledProviders: parseJson(row?.enabledProvidersJson, []),
      pendingAuthState: row?.pendingAuthState || null,
      pendingFlowType: row?.pendingFlowType || null,
      pendingAuthExpiresAt: row?.pendingAuthExpiresAt || null,
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

  async requestJson({ method = 'GET', baseUrl, path, body, accessToken, signed }) {
    const headers = {
      Accept: 'application/json',
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    if (signed) {
      const timestamp = nowIso();
      const nonce = randomToken(16);
      const payload = buildSignedRequestPayload({
        method,
        urlPath: path,
        timestamp,
        nonce,
        body: body || {},
      });

      headers['X-Device-Id'] = signed.deviceId;
      headers['X-Request-Timestamp'] = timestamp;
      headers['X-Request-Nonce'] = nonce;
      headers['X-Request-Signature'] = this.deviceService.signPayload(payload);
    }

    const response = await this.fetchImpl(`${baseUrl}${path}`, {
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

    return payload;
  }

  async startAuth(provider, baseUrl) {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const bootstrap = await this.requestJson({
      method: 'GET',
      baseUrl: normalizedBaseUrl,
      path: '/v1/bootstrap/status',
    });

    if (!Array.isArray(bootstrap.enabledProviders) || !bootstrap.enabledProviders.includes(provider)) {
      throw new Error(`${provider} is not enabled on this backend.`);
    }

    const localDevice = this.deviceService.getLocalDeviceProfile();
    const currentState = this.getState();
    const resetSyncCursors = currentState.baseUrl && currentState.baseUrl !== normalizedBaseUrl;

    const flow = await this.requestJson({
      method: 'POST',
      baseUrl: normalizedBaseUrl,
      path: `/v1/auth/${provider}/start`,
      body: {
        deviceId: localDevice.deviceId,
        deviceLabel: localDevice.label,
        devicePublicKey: localDevice.publicKey,
      },
    });

    this.updateState({
      baseUrl: normalizedBaseUrl,
      provider,
      connectionStatus: 'pending_auth',
      backendClaimed: bootstrap.claimed ? 1 : 0,
      enabledProvidersJson: JSON.stringify(bootstrap.enabledProviders || []),
      pendingAuthState: flow.state,
      pendingFlowType: flow.flowType,
      pendingAuthExpiresAt: flow.expiresAt,
      accessTokenCipherText: null,
      refreshTokenCipherText: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      sessionId: null,
      lastError: null,
      accountEmail: null,
      displayName: null,
      ...(resetSyncCursors
        ? {
            serverCursor: 0,
            lastPushedSequence: 0,
            lastSyncedAt: null,
          }
        : {}),
    });

    this.onAudit?.('hosted_auth_started', {
      targetType: 'hosted_backend',
      targetId: normalizedBaseUrl,
      details: {
        provider,
        flowType: flow.flowType,
      },
    });

    if (this.shell?.openExternal) {
      await this.shell.openExternal(flow.authorizationUrl);
    }

    return {
      hosted: this.getState(),
      flow,
    };
  }

  async pollAuthFlow() {
    const state = this.getState();
    if (!state.baseUrl || !state.pendingAuthState) {
      throw new Error('There is no pending hosted sign-in flow.');
    }

    const result = await this.requestJson({
      method: 'GET',
      baseUrl: state.baseUrl,
      path: `/v1/auth/flows/${encodeURIComponent(state.pendingAuthState)}`,
    });

    if (result.status === 'completed' && result.result?.session) {
      this.updateState({
        connectionStatus: 'connected',
        pendingAuthState: null,
        pendingFlowType: null,
        pendingAuthExpiresAt: null,
        accountEmail: result.result.user?.email || null,
        displayName: result.result.user?.displayName || null,
        sessionId: result.result.session.sessionId,
        accessTokenCipherText: this.cryptoService.encryptText(
          result.result.session.accessToken,
          'hosted-sync:access-token'
        ),
        refreshTokenCipherText: this.cryptoService.encryptText(
          result.result.session.refreshToken,
          'hosted-sync:refresh-token'
        ),
        accessTokenExpiresAt: result.result.session.accessTokenExpiresAt,
        refreshTokenExpiresAt: result.result.session.refreshExpiresAt,
        lastError: null,
      });

      this.onAudit?.('hosted_auth_completed', {
        targetType: 'hosted_backend',
        targetId: state.baseUrl,
        details: {
          provider: state.provider,
          accountEmail: result.result.user?.email || null,
        },
      });
    } else if (result.status === 'failed') {
      this.updateState({
        connectionStatus: state.baseUrl ? 'configured' : 'disconnected',
        pendingAuthState: null,
        pendingFlowType: null,
        pendingAuthExpiresAt: null,
        lastError: result.errorCode || 'Hosted sign-in failed.',
      });
    }

    return {
      hosted: this.getState(),
      flow: result,
    };
  }

  async refreshSession() {
    const currentState = this.getState();
    const tokens = this.getStoredTokens();

    if (!tokens.baseUrl || !tokens.refreshToken) {
      throw new Error('Hosted backend refresh token is missing.');
    }

    const session = await this.requestJson({
      method: 'POST',
      baseUrl: tokens.baseUrl,
      path: '/v1/auth/refresh',
      body: {
        refreshToken: tokens.refreshToken,
      },
    });

    this.updateState({
      connectionStatus: 'connected',
      sessionId: session.sessionId,
      accessTokenCipherText: this.cryptoService.encryptText(
        session.accessToken,
        'hosted-sync:access-token'
      ),
      refreshTokenCipherText: this.cryptoService.encryptText(
        session.refreshToken,
        'hosted-sync:refresh-token'
      ),
      accessTokenExpiresAt: session.accessTokenExpiresAt,
      refreshTokenExpiresAt: session.refreshExpiresAt,
      lastError: null,
      provider: currentState.provider,
      baseUrl: currentState.baseUrl,
    });

    return session.accessToken;
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
        accessTokenCipherText: null,
        refreshTokenCipherText: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        sessionId: null,
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
      // The local disconnect path should still succeed even if the remote session is already gone.
    }

    this.updateState({
      connectionStatus: baseUrl ? 'configured' : 'disconnected',
      pendingAuthState: null,
      pendingFlowType: null,
      pendingAuthExpiresAt: null,
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
    }

    const initialPull = await this.authorizedRequest({
      method: 'GET',
      path: `/v1/sync/pull?since=${encodeURIComponent(state.serverCursor)}`,
    });

    let appliedRemote = 0;
    for (const envelope of initialPull.envelopes || []) {
      if (envelope.deviceId === localDevice.deviceId) {
        continue;
      }

      this.callbacks.applyEnvelope?.(envelope);
      appliedRemote += 1;
    }

    let nextCursor = Number(initialPull.nextCursor || state.serverCursor || 0);
    const localEnvelopes = this.callbacks.listEnvelopesSince?.(state.lastPushedSequence) || [];
    let pushedCount = 0;
    let duplicateCount = 0;
    let lastPushedSequence = state.lastPushedSequence;

    if (localEnvelopes.length > 0) {
      const signedEnvelopes = localEnvelopes.map((envelope) => ({
        ...envelope,
        signature: this.deviceService.signPayload(buildEnvelopePayload(envelope)),
        signatureKeyId: localDevice.deviceId,
      }));

      const pushResult = await this.authorizedRequest({
        method: 'POST',
        path: '/v1/sync/push',
        body: {
          envelopes: signedEnvelopes,
        },
        signed: {
          deviceId: localDevice.deviceId,
        },
      });

      pushedCount = pushResult.accepted?.length || 0;
      duplicateCount = pushResult.duplicates?.length || 0;
      lastPushedSequence = Math.max(
        state.lastPushedSequence,
        ...signedEnvelopes.map((envelope) => Number(envelope.deviceSequence || 0))
      );

      const secondPull = await this.authorizedRequest({
        method: 'GET',
        path: `/v1/sync/pull?since=${encodeURIComponent(nextCursor)}`,
      });

      for (const envelope of secondPull.envelopes || []) {
        if (envelope.deviceId === localDevice.deviceId) {
          continue;
        }

        this.callbacks.applyEnvelope?.(envelope);
        appliedRemote += 1;
      }

      nextCursor = Number(secondPull.nextCursor || nextCursor || 0);
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
        duplicateCount,
        pulledCount: appliedRemote,
        serverCursor: nextCursor,
      },
    });

    return {
      hosted: this.getState(),
      sync: {
        pushedCount,
        duplicateCount,
        pulledCount: appliedRemote,
        serverCursor: nextCursor,
      },
    };
  }
}

module.exports = {
  HostedSyncService,
  buildSignedRequestPayload,
  buildEnvelopePayload,
  normalizeBaseUrl,
  stableStringify,
};
