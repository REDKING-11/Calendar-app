const crypto = require('node:crypto');

function nowIso() {
  return new Date().toISOString();
}

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

class OAuthService {
  constructor({ db, cryptoService, shell, onAudit }) {
    this.db = db;
    this.cryptoService = cryptoService;
    this.shell = shell;
    this.onAudit = onAudit;
  }

  getProviders() {
    return [
      {
        id: 'google',
        label: 'Google',
        configured: Boolean(process.env.CALENDAR_GOOGLE_CLIENT_ID),
        delegatedOnly: true,
        readScopes: [
          'openid',
          'profile',
          'email',
          'https://www.googleapis.com/auth/calendar.readonly',
        ],
        writeScopes: ['https://www.googleapis.com/auth/calendar.events'],
      },
      {
        id: 'microsoft',
        label: 'Microsoft',
        configured: Boolean(process.env.CALENDAR_MICROSOFT_CLIENT_ID),
        delegatedOnly: true,
        readScopes: ['openid', 'profile', 'email', 'offline_access', 'Calendars.Read'],
        writeScopes: ['Calendars.ReadWrite'],
      },
    ];
  }

  getProviderConfig(provider) {
    if (provider === 'google') {
      const clientId = process.env.CALENDAR_GOOGLE_CLIENT_ID;
      return {
        provider,
        clientId,
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        revokeUrl: 'https://oauth2.googleapis.com/revoke',
        redirectUri:
          process.env.CALENDAR_GOOGLE_REDIRECT_URI || 'http://127.0.0.1:45781/oauth/google/callback',
        readScopes: [
          'openid',
          'profile',
          'email',
          'https://www.googleapis.com/auth/calendar.readonly',
        ],
        writeScopes: ['https://www.googleapis.com/auth/calendar.events'],
        extraParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      };
    }

    if (provider === 'microsoft') {
      const clientId = process.env.CALENDAR_MICROSOFT_CLIENT_ID;
      return {
        provider,
        clientId,
        authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        revokeUrl: null,
        redirectUri:
          process.env.CALENDAR_MICROSOFT_REDIRECT_URI ||
          'http://127.0.0.1:45782/oauth/microsoft/callback',
        readScopes: ['openid', 'profile', 'email', 'offline_access', 'Calendars.Read'],
        writeScopes: ['Calendars.ReadWrite'],
        extraParams: {},
      };
    }

    throw new Error(`Unsupported OAuth provider: ${provider}`);
  }

  listConnectedAccounts() {
    return this.db
      .prepare(
        `SELECT
          account_id AS accountId,
          provider,
          subject,
          email,
          display_name AS displayName,
          permission_mode AS permissionMode,
          status,
          can_write AS canWrite,
          write_scope_granted AS writeScopeGranted,
          created_at AS createdAt,
          updated_at AS updatedAt,
          last_sync_at AS lastSyncAt
         FROM connected_accounts
         ORDER BY created_at ASC`
      )
      .all()
      .map((row) => ({
        ...row,
        canWrite: Boolean(row.canWrite),
        writeScopeGranted: Boolean(row.writeScopeGranted),
      }));
  }

  buildScopes(config, accessLevel = 'read') {
    const scopes = [...config.readScopes];
    if (accessLevel === 'write') {
      scopes.push(...config.writeScopes);
    }

    return Array.from(new Set(scopes));
  }

  startConnect(provider, accessLevel = 'read') {
    const config = this.getProviderConfig(provider);
    if (!config.clientId) {
      throw new Error(`${provider} OAuth is not configured yet. Add the client ID first.`);
    }

    const state = crypto.randomUUID();
    const codeVerifier = this.cryptoService.randomToken(48);
    const codeChallenge = this.cryptoService.pkceChallenge(codeVerifier);
    const scopes = this.buildScopes(config, accessLevel);
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    this.db
      .prepare(
        `INSERT INTO oauth_flows (
          state,
          provider,
          requested_access,
          redirect_uri,
          code_verifier_cipher_text,
          created_at,
          expires_at
        ) VALUES (
          :state,
          :provider,
          :requestedAccess,
          :redirectUri,
          :codeVerifierCipherText,
          :createdAt,
          :expiresAt
        )`
      )
      .run({
        state,
        provider,
        requestedAccess: accessLevel,
        redirectUri: config.redirectUri,
        codeVerifierCipherText: this.cryptoService.encryptText(
          codeVerifier,
          `oauth-flow:${state}`
        ),
        createdAt,
        expiresAt,
      });

    const authorizationUrl = new URL(config.authUrl);
    authorizationUrl.searchParams.set('client_id', config.clientId);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('redirect_uri', config.redirectUri);
    authorizationUrl.searchParams.set('scope', scopes.join(' '));
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('code_challenge', codeChallenge);
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');

    for (const [key, value] of Object.entries(config.extraParams || {})) {
      authorizationUrl.searchParams.set(key, value);
    }

    this.onAudit?.('oauth_connect_started', {
      targetType: 'provider',
      targetId: provider,
      details: {
        accessLevel,
        state,
      },
    });

    if (this.shell?.openExternal) {
      this.shell.openExternal(authorizationUrl.toString());
    }

    return {
      provider,
      accessLevel,
      state,
      redirectUri: config.redirectUri,
      authorizationUrl: authorizationUrl.toString(),
      expiresAt,
    };
  }

  async finishConnect({ provider, state, code }) {
    const config = this.getProviderConfig(provider);
    const flow = this.db
      .prepare(
        `SELECT
          state,
          provider,
          requested_access AS requestedAccess,
          redirect_uri AS redirectUri,
          code_verifier_cipher_text AS codeVerifierCipherText,
          expires_at AS expiresAt
         FROM oauth_flows
         WHERE state = :state`
      )
      .get({ state });

    if (!flow || flow.provider !== provider) {
      throw new Error('OAuth flow was not found.');
    }

    if (new Date(flow.expiresAt).getTime() < Date.now()) {
      throw new Error('OAuth flow has expired.');
    }

    const codeVerifier = this.cryptoService.decryptText(
      flow.codeVerifierCipherText,
      `oauth-flow:${state}`
    );

    const tokenResponse = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: flow.redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`OAuth token exchange failed: ${errorText}`);
    }

    const tokenPayload = await tokenResponse.json();
    const identity = decodeJwtPayload(tokenPayload.id_token) || {};
    const accountId = `acct_${crypto.randomUUID()}`;
    const tokenId = `token_${crypto.randomUUID()}`;
    const timestamp = nowIso();
    const canWrite = flow.requestedAccess === 'write';
    const scopeSet = String(tokenPayload.scope || this.buildScopes(config, flow.requestedAccess).join(' '));

    this.db.exec('BEGIN');

    try {
      this.db
        .prepare(
          `INSERT INTO connected_accounts (
            account_id,
            provider,
            subject,
            email,
            display_name,
            permission_mode,
            status,
            can_write,
            write_scope_granted,
            created_at,
            updated_at
          ) VALUES (
            :accountId,
            :provider,
            :subject,
            :email,
            :displayName,
            :permissionMode,
            'connected',
            :canWrite,
            :writeScopeGranted,
            :createdAt,
            :updatedAt
          )`
        )
        .run({
          accountId,
          provider,
          subject: identity.sub || identity.oid || null,
          email: identity.email || identity.preferred_username || null,
          displayName: identity.name || identity.given_name || provider,
          permissionMode: flow.requestedAccess,
          canWrite: canWrite ? 1 : 0,
          writeScopeGranted: canWrite ? 1 : 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        });

      this.db
        .prepare(
          `INSERT INTO token_records (
            token_id,
            account_id,
            provider,
            scope_set,
            access_token_cipher_text,
            refresh_token_cipher_text,
            expires_at,
            created_at,
            updated_at
          ) VALUES (
            :tokenId,
            :accountId,
            :provider,
            :scopeSet,
            :accessTokenCipherText,
            :refreshTokenCipherText,
            :expiresAt,
            :createdAt,
            :updatedAt
          )`
        )
        .run({
          tokenId,
          accountId,
          provider,
          scopeSet,
          accessTokenCipherText: tokenPayload.access_token
            ? this.cryptoService.encryptText(
                tokenPayload.access_token,
                `oauth-token:${tokenId}:access`
              )
            : null,
          refreshTokenCipherText: tokenPayload.refresh_token
            ? this.cryptoService.encryptText(
                tokenPayload.refresh_token,
                `oauth-token:${tokenId}:refresh`
              )
            : null,
          expiresAt: tokenPayload.expires_in
            ? new Date(Date.now() + Number(tokenPayload.expires_in) * 1000).toISOString()
            : null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });

      this.db.prepare('DELETE FROM oauth_flows WHERE state = :state').run({ state });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    this.onAudit?.('oauth_connect_completed', {
      targetType: 'account',
      targetId: accountId,
      details: {
        provider,
        permissionMode: flow.requestedAccess,
      },
    });

    return this.listConnectedAccounts().find((account) => account.accountId === accountId);
  }

  disconnectAccount(accountId) {
    const timestamp = nowIso();
    const account = this.db
      .prepare(
        `SELECT account_id AS accountId, provider
         FROM connected_accounts
         WHERE account_id = :accountId`
      )
      .get({ accountId });

    if (!account) {
      throw new Error('Connected account not found.');
    }

    this.db.exec('BEGIN');

    try {
      this.db.prepare('DELETE FROM token_records WHERE account_id = :accountId').run({ accountId });
      this.db
        .prepare(
          `UPDATE connected_accounts
           SET status = 'disconnected', updated_at = :updatedAt
           WHERE account_id = :accountId`
        )
        .run({
          accountId,
          updatedAt: timestamp,
        });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    this.onAudit?.('oauth_account_disconnected', {
      targetType: 'account',
      targetId: accountId,
      details: { provider: account.provider },
    });

    return {
      accountId,
      status: 'disconnected',
    };
  }

  async revokeAccount(accountId) {
    const account = this.db
      .prepare(
        `SELECT
          a.account_id AS accountId,
          a.provider,
          t.token_id AS tokenId,
          t.refresh_token_cipher_text AS refreshTokenCipherText,
          t.access_token_cipher_text AS accessTokenCipherText
         FROM connected_accounts a
         LEFT JOIN token_records t ON t.account_id = a.account_id
         WHERE a.account_id = :accountId
         LIMIT 1`
      )
      .get({ accountId });

    if (!account) {
      throw new Error('Connected account not found.');
    }

    const config = this.getProviderConfig(account.provider);
    const refreshToken = account.refreshTokenCipherText
      ? this.cryptoService.decryptText(
          account.refreshTokenCipherText,
          `oauth-token:${account.tokenId}:refresh`
        )
      : null;
    const accessToken = account.accessTokenCipherText
      ? this.cryptoService.decryptText(
          account.accessTokenCipherText,
          `oauth-token:${account.tokenId}:access`
        )
      : null;

    if (config.revokeUrl && (refreshToken || accessToken)) {
      await fetch(config.revokeUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          token: refreshToken || accessToken,
        }),
      });
    }

    const disconnected = this.disconnectAccount(accountId);

    this.onAudit?.('oauth_account_revoked', {
      targetType: 'account',
      targetId: accountId,
      details: {
        provider: account.provider,
        remoteRevocationAttempted: Boolean(config.revokeUrl),
      },
    });

    return disconnected;
  }
}

module.exports = { OAuthService };
