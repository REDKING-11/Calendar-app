const {
  ApiError,
  assert,
} = require('../lib/errors');
const {
  createId,
  decryptJson,
  encryptJson,
  hashSecret,
  nowIso,
  pkceChallenge,
  randomToken,
  signJwt,
  verifyJwt,
} = require('../lib/crypto');

function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') {
    return null;
  }

  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (_error) {
    return null;
  }
}

class AuthService {
  constructor({ db, config, fetchImpl = fetch }) {
    this.db = db;
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  getProviderConfig(provider) {
    const providerConfig = this.config.providers?.[provider];
    assert(providerConfig, 404, 'Unsupported OAuth provider.', 'unsupported_provider');
    assert(
      providerConfig.clientId && providerConfig.clientSecret,
      400,
      `${provider} OAuth is not configured.`,
      'provider_not_configured'
    );

    return providerConfig;
  }

  buildScopes(provider, requestedAccess = 'read') {
    const providerConfig = this.getProviderConfig(provider);
    const scopes = [...providerConfig.readScopes];
    if (requestedAccess === 'write') {
      scopes.push(...providerConfig.writeScopes);
    }

    return Array.from(new Set(scopes));
  }

  async getOwnerUser() {
    const result = await this.db.query(
      `SELECT id, email, display_name AS "displayName", owner_claimed_at AS "ownerClaimedAt"
       FROM users
       WHERE owner_claimed_at IS NOT NULL
       ORDER BY owner_claimed_at ASC
       LIMIT 1`
    );

    return result.rows[0] || null;
  }

  async getBootstrapStatus() {
    const owner = await this.getOwnerUser();
    return {
      claimed: Boolean(owner),
      enabledProviders: Object.entries(this.config.providers)
        .filter(([, provider]) => provider.clientId && provider.clientSecret)
        .map(([key]) => key),
    };
  }

  async seedDefaultCalendar(client, userId) {
    const calendarId = createId('calendar');
    await client.query(
      `INSERT INTO calendars (id, owner_user_id, name)
       VALUES ($1, $2, $3)`,
      [calendarId, userId, 'Personal']
    );
    await client.query(
      `INSERT INTO calendar_members (calendar_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [calendarId, userId]
    );

    return calendarId;
  }

  async ensureTrustedDevice(client, { userId, deviceId, deviceLabel, devicePublicKey }) {
    const existing = await client.query(
      `SELECT id, status
       FROM trusted_devices
       WHERE id = $1 AND user_id = $2`,
      [deviceId, userId]
    );

    if (existing.rows[0]) {
      await client.query(
        `UPDATE trusted_devices
         SET label = $3,
             public_key = $4,
             status = 'active',
             updated_at = NOW(),
             last_seen_at = NOW(),
             revoked_at = NULL
         WHERE id = $1 AND user_id = $2`,
        [deviceId, userId, deviceLabel, devicePublicKey]
      );
      return deviceId;
    }

    await client.query(
      `INSERT INTO trusted_devices (
        id,
        user_id,
        label,
        public_key,
        status,
        created_at,
        updated_at,
        last_seen_at
      ) VALUES ($1, $2, $3, $4, 'active', NOW(), NOW(), NOW())`,
      [deviceId, userId, deviceLabel, devicePublicKey]
    );

    return deviceId;
  }

  buildAccessToken({ userId, deviceId, sessionId, scopes }) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + this.config.accessTokenTtlSeconds;
    const token = signJwt(
      {
        sub: userId,
        device_id: deviceId,
        session_id: sessionId,
        scopes,
        iat: issuedAt,
        exp: expiresAt,
      },
      this.config.accessTokenSecret
    );

    return {
      token,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }

  async createSession(client, { userId, deviceId, scopes }) {
    const sessionId = createId('sess');
    const refreshToken = randomToken(48);
    const refreshTokenHash = hashSecret(refreshToken);
    const expiresAt = new Date(
      Date.now() + this.config.refreshSessionTtlSeconds * 1000
    ).toISOString();
    const serializedScopes = JSON.stringify(scopes);

    await client.query(
      `INSERT INTO device_sessions (
        id,
        user_id,
        device_id,
        refresh_token_hash,
        scopes,
        status,
        created_at,
        updated_at,
        last_used_at,
        expires_at
      ) VALUES ($1, $2, $3, $4, $5, 'active', NOW(), NOW(), NOW(), $6)`,
      [sessionId, userId, deviceId, refreshTokenHash, serializedScopes, expiresAt]
    );

    const accessToken = this.buildAccessToken({
      userId,
      deviceId,
      sessionId,
      scopes,
    });

    return {
      sessionId,
      refreshToken,
      refreshExpiresAt: expiresAt,
      accessToken: accessToken.token,
      accessTokenExpiresAt: accessToken.expiresAt,
      scopes,
    };
  }

  async audit(client, { userId = null, actorDeviceId = null, action, targetType, targetId, details }) {
    await client.query(
      `INSERT INTO audit_log (
        id,
        user_id,
        actor_device_id,
        action,
        target_type,
        target_id,
        details_cipher_text,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        createId('audit'),
        userId,
        actorDeviceId,
        action,
        targetType || null,
        targetId || null,
        details ? encryptJson(details, this.config.backendMasterKey, `audit:${action}`) : null,
      ]
    );
  }

  buildAuthCompletionHtml(status, message) {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Calendar App Auth</title>
  </head>
  <body style="font-family: Segoe UI, sans-serif; background: #f8fafc; color: #0f172a; padding: 48px;">
    <main style="max-width: 640px; margin: 0 auto; background: white; border-radius: 24px; padding: 32px; box-shadow: 0 20px 60px rgba(15, 23, 42, 0.12);">
      <p style="font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: #b45309; font-weight: 700;">Calendar App</p>
      <h1 style="margin: 8px 0 16px; font-size: 36px;">${status === 'success' ? 'Authorization complete' : 'Authorization failed'}</h1>
      <p style="font-size: 18px; line-height: 1.6;">${message}</p>
      <p style="font-size: 15px; line-height: 1.6; color: #475569;">You can return to the desktop app now.</p>
    </main>
  </body>
</html>`;
  }

  async startAuthFlow(provider, input = {}, flowType = 'owner_login') {
    const providerConfig = this.getProviderConfig(provider);
    const owner = await this.getOwnerUser();

    if (flowType === 'owner_claim') {
      assert(!owner, 409, 'The backend is already claimed.', 'already_claimed');
      assert(input.deviceId, 400, 'deviceId is required for owner auth.', 'missing_device_id');
      assert(input.devicePublicKey, 400, 'devicePublicKey is required for owner auth.', 'missing_device_key');
    }

    if (flowType === 'owner_login') {
      assert(owner, 409, 'The backend has not been claimed yet.', 'backend_not_claimed');
      assert(input.deviceId, 400, 'deviceId is required for owner auth.', 'missing_device_id');
      assert(input.devicePublicKey, 400, 'devicePublicKey is required for owner auth.', 'missing_device_key');
    }

    if (flowType === 'external_account_link') {
      assert(input.initiatorUserId, 401, 'Authenticated user required.', 'unauthorized');
    }

    const state = randomToken(24);
    const codeVerifier = randomToken(48);
    const requestedAccess = input.requestedAccess || 'read';
    const expiresAt = new Date(
      Date.now() + this.config.authFlowTtlSeconds * 1000
    ).toISOString();

    await this.db.query(
      `INSERT INTO auth_flows (
        state,
        provider,
        flow_type,
        requested_access,
        redirect_uri,
        code_verifier_cipher_text,
        device_id,
        device_label,
        device_public_key,
        initiator_user_id,
        status,
        created_at,
        expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', NOW(), $11)`,
      [
        state,
        provider,
        flowType,
        requestedAccess,
        providerConfig.redirectUri,
        encryptJson({ codeVerifier }, this.config.backendMasterKey, `auth-flow:${state}`),
        input.deviceId || null,
        input.deviceLabel || 'Calendar device',
        input.devicePublicKey || null,
        input.initiatorUserId || null,
        expiresAt,
      ]
    );

    const authorizationUrl = new URL(providerConfig.authUrl);
    authorizationUrl.searchParams.set('client_id', providerConfig.clientId);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('redirect_uri', providerConfig.redirectUri);
    authorizationUrl.searchParams.set(
      'scope',
      this.buildScopes(provider, requestedAccess).join(' ')
    );
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('code_challenge', pkceChallenge(codeVerifier));
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');

    for (const [key, value] of Object.entries(providerConfig.extraParams || {})) {
      authorizationUrl.searchParams.set(key, value);
    }

    return {
      state,
      provider,
      authorizationUrl: authorizationUrl.toString(),
      expiresAt,
      flowType,
    };
  }

  async exchangeCode(provider, { code, redirectUri, codeVerifier }) {
    const providerConfig = this.getProviderConfig(provider);
    const response = await this.fetchImpl(providerConfig.tokenUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: providerConfig.clientId,
        client_secret: providerConfig.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!response.ok) {
      throw new ApiError(502, 'OAuth token exchange failed.', 'oauth_exchange_failed', {
        provider,
        status: response.status,
      });
    }

    return response.json();
  }

  async handleCallback(provider, { code, state }) {
    assert(code, 400, 'Missing authorization code.', 'missing_code');
    assert(state, 400, 'Missing auth state.', 'missing_state');

    const flowResult = await this.db.query(
      `SELECT
        state,
        provider,
        flow_type AS "flowType",
        requested_access AS "requestedAccess",
        redirect_uri AS "redirectUri",
        code_verifier_cipher_text AS "codeVerifierCipherText",
        device_id AS "deviceId",
        device_label AS "deviceLabel",
        device_public_key AS "devicePublicKey",
        initiator_user_id AS "initiatorUserId",
        status,
        expires_at AS "expiresAt"
       FROM auth_flows
       WHERE state = $1`,
      [state]
    );

    const flow = flowResult.rows[0];
    assert(flow, 404, 'Auth flow not found.', 'auth_flow_not_found');
    assert(flow.provider === provider, 400, 'Auth flow provider mismatch.', 'auth_flow_mismatch');
    assert(flow.status === 'pending', 409, 'Auth flow already completed.', 'auth_flow_completed');
    assert(
      new Date(flow.expiresAt).getTime() >= Date.now(),
      410,
      'Auth flow has expired.',
      'auth_flow_expired'
    );

    const decryptedFlow = decryptJson(
      flow.codeVerifierCipherText,
      this.config.backendMasterKey,
      `auth-flow:${state}`
    );

    const tokenPayload = await this.exchangeCode(provider, {
      code,
      redirectUri: flow.redirectUri,
      codeVerifier: decryptedFlow.codeVerifier,
    });

    const identity = decodeJwtPayload(tokenPayload.id_token) || {};
    const subject = identity.sub || identity.oid;
    assert(subject, 502, 'OAuth identity payload was incomplete.', 'oauth_identity_missing');

    const client = await this.db.connect();
    let html;
    try {
      await client.query('BEGIN');

      let userId;
      let actorDeviceId = flow.deviceId || null;

      if (flow.flowType === 'owner_claim') {
        const existingOwner = await client.query(
          `SELECT id FROM users WHERE owner_claimed_at IS NOT NULL LIMIT 1`
        );
        assert(existingOwner.rowCount === 0, 409, 'The backend is already claimed.', 'already_claimed');

        userId = createId('user');
        await client.query(
          `INSERT INTO users (
            id,
            email,
            display_name,
            status,
            created_at,
            updated_at,
            owner_claimed_at
          ) VALUES ($1, $2, $3, 'active', NOW(), NOW(), NOW())`,
          [userId, identity.email || identity.preferred_username || null, identity.name || provider]
        );
        await this.seedDefaultCalendar(client, userId);
      } else if (flow.flowType === 'owner_login') {
        const providerIdentity = await client.query(
          `SELECT user_id AS "userId"
           FROM provider_identities
           WHERE provider = $1 AND subject = $2
           LIMIT 1`,
          [provider, subject]
        );
        assert(providerIdentity.rowCount === 1, 403, 'This identity is not allowed on this backend.', 'identity_not_allowed');
        userId = providerIdentity.rows[0].userId;
      } else {
        userId = flow.initiatorUserId;
        assert(userId, 401, 'External account linking requires an authenticated user.', 'unauthorized');
      }

      const existingIdentity = await client.query(
        `SELECT id, user_id AS "userId"
         FROM provider_identities
         WHERE provider = $1 AND subject = $2
         LIMIT 1`,
        [provider, subject]
      );

      if (existingIdentity.rowCount === 0) {
        await client.query(
          `INSERT INTO provider_identities (
            id,
            user_id,
            provider,
            subject,
            email,
            display_name,
            created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [
            createId('ident'),
            userId,
            provider,
            subject,
            identity.email || identity.preferred_username || null,
            identity.name || provider,
          ]
        );
      } else {
        assert(
          existingIdentity.rows[0].userId === userId,
          403,
          'This identity belongs to another account.',
          'identity_conflict'
        );
      }

      let completionPayload;

      if (flow.flowType === 'external_account_link') {
        const tokenId = createId('provtoken');
        await client.query(
          `INSERT INTO provider_tokens (
            id,
            user_id,
            provider,
            subject,
            account_email,
            display_name,
            scope_set,
            permission_mode,
            access_token_cipher_text,
            refresh_token_cipher_text,
            key_version,
            status,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, 'connected', NOW(), NOW())`,
          [
            tokenId,
            userId,
            provider,
            subject,
            identity.email || identity.preferred_username || null,
            identity.name || provider,
            String(tokenPayload.scope || this.buildScopes(provider, flow.requestedAccess).join(' ')),
            flow.requestedAccess,
            tokenPayload.access_token
              ? encryptJson(
                  { value: tokenPayload.access_token },
                  this.config.backendMasterKey,
                  `provider-token:${tokenId}:access`
                )
              : null,
            tokenPayload.refresh_token
              ? encryptJson(
                  { value: tokenPayload.refresh_token },
                  this.config.backendMasterKey,
                  `provider-token:${tokenId}:refresh`
                )
              : null,
          ]
        );

        completionPayload = {
          status: 'linked',
          provider,
          accountEmail: identity.email || identity.preferred_username || null,
        };

        await this.audit(client, {
          userId,
          action: 'external_account_linked',
          targetType: 'provider',
          targetId: provider,
          details: {
            provider,
            subject,
          },
        });

        html = this.buildAuthCompletionHtml(
          'success',
          `${provider} is now connected for hosted calendar sync.`
        );
      } else {
        await this.ensureTrustedDevice(client, {
          userId,
          deviceId: flow.deviceId,
          deviceLabel: flow.deviceLabel || 'Calendar device',
          devicePublicKey: flow.devicePublicKey,
        });

        const session = await this.createSession(client, {
          userId,
          deviceId: flow.deviceId,
          scopes: ['sync:read', 'sync:write', 'devices:manage', 'sessions:manage', 'providers:manage'],
        });

        completionPayload = {
          status: 'authenticated',
          provider,
          user: {
            id: userId,
            email: identity.email || identity.preferred_username || null,
            displayName: identity.name || provider,
          },
          session,
        };

        await this.audit(client, {
          userId,
          actorDeviceId,
          action: flow.flowType === 'owner_claim' ? 'owner_claimed' : 'owner_logged_in',
          targetType: 'device',
          targetId: flow.deviceId,
          details: {
            provider,
            deviceId: flow.deviceId,
          },
        });

        html = this.buildAuthCompletionHtml(
          'success',
          flow.flowType === 'owner_claim'
            ? 'This backend is now claimed and ready to sync your calendar.'
            : 'Your device is now signed in to the hosted backend.'
        );
      }

      await client.query(
        `UPDATE auth_flows
         SET status = 'completed',
             completion_cipher_text = $2,
             completed_at = NOW()
         WHERE state = $1`,
        [
          state,
          encryptJson(completionPayload, this.config.backendMasterKey, `auth-flow:${state}:completion`),
        ]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      await this.db.query(
        `UPDATE auth_flows
         SET status = 'failed',
             error_code = $2,
             completed_at = NOW()
         WHERE state = $1`,
        [state, error.code || 'oauth_callback_failed']
      );
      html = this.buildAuthCompletionHtml('failed', error.message);
    } finally {
      client.release();
    }

    return html;
  }

  async getFlowStatus(state) {
    const result = await this.db.query(
      `SELECT
        state,
        provider,
        flow_type AS "flowType",
        status,
        completion_cipher_text AS "completionCipherText",
        error_code AS "errorCode",
        expires_at AS "expiresAt"
       FROM auth_flows
       WHERE state = $1`,
      [state]
    );

    const flow = result.rows[0];
    assert(flow, 404, 'Auth flow not found.', 'auth_flow_not_found');

    const response = {
      state: flow.state,
      provider: flow.provider,
      flowType: flow.flowType,
      status: flow.status,
      expiresAt: flow.expiresAt,
      errorCode: flow.errorCode,
    };

    if (flow.status === 'completed' && flow.completionCipherText) {
      response.result = decryptJson(
        flow.completionCipherText,
        this.config.backendMasterKey,
        `auth-flow:${state}:completion`
      );
    }

    return response;
  }

  async authenticateAccessToken(token) {
    const payload = verifyJwt(token, this.config.accessTokenSecret);
    const result = await this.db.query(
      `SELECT
        s.id AS "sessionId",
        s.user_id AS "userId",
        s.device_id AS "deviceId",
        s.scopes,
        s.status,
        s.expires_at AS "expiresAt",
        d.status AS "deviceStatus"
       FROM device_sessions s
       JOIN trusted_devices d ON d.id = s.device_id
       WHERE s.id = $1`,
      [payload.session_id]
    );

    const session = result.rows[0];
    assert(session, 401, 'Session not found.', 'session_not_found');
    assert(session.status === 'active', 401, 'Session is not active.', 'session_inactive');
    assert(session.deviceStatus === 'active', 401, 'Device is not active.', 'device_inactive');
    assert(session.deviceId === payload.device_id, 401, 'Device binding mismatch.', 'device_binding_mismatch');
    assert(
      new Date(session.expiresAt).getTime() >= Date.now(),
      401,
      'Session has expired.',
      'session_expired'
    );

    return {
      userId: session.userId,
      deviceId: session.deviceId,
      sessionId: session.sessionId,
      scopes: JSON.parse(session.scopes),
      tokenPayload: payload,
    };
  }

  async refreshSession(refreshToken) {
    assert(refreshToken, 400, 'refreshToken is required.', 'missing_refresh_token');

    const hashedToken = hashSecret(refreshToken);
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `SELECT
          id AS "sessionId",
          user_id AS "userId",
          device_id AS "deviceId",
          scopes,
          status,
          expires_at AS "expiresAt"
         FROM device_sessions
         WHERE refresh_token_hash = $1
         LIMIT 1`,
        [hashedToken]
      );

      const session = result.rows[0];
      assert(session, 401, 'Refresh token not recognized.', 'invalid_refresh_token');
      assert(session.status === 'active', 401, 'Session is not active.', 'session_inactive');
      assert(
        new Date(session.expiresAt).getTime() >= Date.now(),
        401,
        'Refresh session has expired.',
        'session_expired'
      );

      const nextRefreshToken = randomToken(48);
      const nextRefreshHash = hashSecret(nextRefreshToken);
      const nextExpiresAt = new Date(
        Date.now() + this.config.refreshSessionTtlSeconds * 1000
      ).toISOString();

      await client.query(
        `UPDATE device_sessions
         SET refresh_token_hash = $2,
             updated_at = NOW(),
             last_used_at = NOW(),
             expires_at = $3
         WHERE id = $1`,
        [session.sessionId, nextRefreshHash, nextExpiresAt]
      );

      const scopes = JSON.parse(session.scopes);
      const accessToken = this.buildAccessToken({
        userId: session.userId,
        deviceId: session.deviceId,
        sessionId: session.sessionId,
        scopes,
      });

      await client.query('COMMIT');

      return {
        sessionId: session.sessionId,
        refreshToken: nextRefreshToken,
        refreshExpiresAt: nextExpiresAt,
        accessToken: accessToken.token,
        accessTokenExpiresAt: accessToken.expiresAt,
        scopes,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async logoutSession(userId, sessionId) {
    await this.db.query(
      `UPDATE device_sessions
       SET status = 'revoked',
           revoked_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [sessionId, userId]
    );
  }

  async listSessions(userId) {
    const result = await this.db.query(
      `SELECT
        s.id AS "sessionId",
        s.device_id AS "deviceId",
        d.label AS "deviceLabel",
        s.status,
        s.created_at AS "createdAt",
        s.updated_at AS "updatedAt",
        s.last_used_at AS "lastUsedAt",
        s.expires_at AS "expiresAt",
        s.revoked_at AS "revokedAt"
       FROM device_sessions s
       JOIN trusted_devices d ON d.id = s.device_id
       WHERE s.user_id = $1
       ORDER BY s.created_at DESC`,
      [userId]
    );

    return result.rows;
  }

  async revokeSession(userId, sessionId) {
    const result = await this.db.query(
      `UPDATE device_sessions
       SET status = 'revoked',
           revoked_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id AS "sessionId"`,
      [sessionId, userId]
    );

    assert(result.rowCount === 1, 404, 'Session not found.', 'session_not_found');
    return result.rows[0];
  }

  async createStepUpToken(userId, sessionId, tokenIssuedAtSeconds) {
    const freshWindowSeconds = Math.min(300, this.config.stepUpTtlSeconds);
    assert(
      Math.floor(Date.now() / 1000) - tokenIssuedAtSeconds <= freshWindowSeconds,
      401,
      'Step-up approval requires a freshly issued access token.',
      'reauth_required'
    );

    const stepUpId = createId('stepup');
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + this.config.stepUpTtlSeconds * 1000).toISOString();

    await this.db.query(
      `INSERT INTO step_up_tokens (
        id,
        user_id,
        session_id,
        token_hash,
        status,
        created_at,
        expires_at
      ) VALUES ($1, $2, $3, $4, 'active', NOW(), $5)`,
      [stepUpId, userId, sessionId, hashSecret(token), expiresAt]
    );

    return {
      stepUpId,
      token,
      expiresAt,
    };
  }

  async consumeStepUpToken(userId, sessionId, stepUpToken) {
    const hashedToken = hashSecret(stepUpToken);
    const result = await this.db.query(
      `UPDATE step_up_tokens
       SET status = 'consumed',
           consumed_at = NOW()
       WHERE user_id = $1
         AND session_id = $2
         AND token_hash = $3
         AND status = 'active'
         AND expires_at >= NOW()
       RETURNING id AS "stepUpId"`,
      [userId, sessionId, hashedToken]
    );

    assert(result.rowCount === 1, 401, 'Step-up approval is missing or expired.', 'step_up_invalid');
    return result.rows[0];
  }

  async listExternalAccounts(userId) {
    const result = await this.db.query(
      `SELECT
        id AS "accountId",
        provider,
        subject,
        account_email AS "accountEmail",
        display_name AS "displayName",
        permission_mode AS "permissionMode",
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        revoked_at AS "revokedAt",
        last_synced_at AS "lastSyncedAt"
       FROM provider_tokens
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [userId]
    );

    return result.rows;
  }

  async startExternalAccountLink(userId, provider, requestedAccess = 'read') {
    return this.startAuthFlow(
      provider,
      {
        initiatorUserId: userId,
        requestedAccess,
      },
      'external_account_link'
    );
  }

  async revokeExternalAccount(userId, accountId) {
    const result = await this.db.query(
      `UPDATE provider_tokens
       SET status = 'revoked',
           revoked_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING id AS "accountId", provider`,
      [accountId, userId]
    );

    assert(result.rowCount === 1, 404, 'External account not found.', 'external_account_not_found');
    return result.rows[0];
  }
}

module.exports = { AuthService };
