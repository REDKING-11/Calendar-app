const crypto = require('node:crypto');
const http = require('node:http');

const GOOGLE_GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const MICROSOFT_MAIL_SEND_SCOPE = 'Mail.Send';
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function parseScopeSet(scopeSet = '') {
  return String(scopeSet || '')
    .split(/\s+/g)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function getMailSendScope(provider) {
  if (provider === 'google') {
    return GOOGLE_GMAIL_SEND_SCOPE;
  }

  if (provider === 'microsoft') {
    return MICROSOFT_MAIL_SEND_SCOPE;
  }

  return '';
}

function hasMailSendScope(provider, scopeSet = '') {
  const requiredScope = getMailSendScope(provider);
  if (!requiredScope) {
    return false;
  }

  return parseScopeSet(scopeSet).includes(requiredScope);
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
    this.callbackServers = new Map();
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
        writeScopes: [
          'https://www.googleapis.com/auth/calendar.events',
          GOOGLE_GMAIL_SEND_SCOPE,
        ],
      },
      {
        id: 'microsoft',
        label: 'Microsoft',
        configured: Boolean(process.env.CALENDAR_MICROSOFT_CLIENT_ID),
        delegatedOnly: true,
        readScopes: ['openid', 'profile', 'email', 'offline_access', 'Calendars.Read'],
        writeScopes: ['Calendars.ReadWrite', MICROSOFT_MAIL_SEND_SCOPE],
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
        writeScopes: [
          'https://www.googleapis.com/auth/calendar.events',
          GOOGLE_GMAIL_SEND_SCOPE,
        ],
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
        writeScopes: ['Calendars.ReadWrite', MICROSOFT_MAIL_SEND_SCOPE],
        extraParams: {},
      };
    }

    throw new Error(`Unsupported OAuth provider: ${provider}`);
  }

  listConnectedAccounts() {
    return this.db
      .prepare(
        `SELECT
          a.account_id AS accountId,
          a.provider,
          a.subject,
          a.email,
          a.display_name AS displayName,
          a.permission_mode AS permissionMode,
          a.status,
          a.can_write AS canWrite,
          a.write_scope_granted AS writeScopeGranted,
          a.created_at AS createdAt,
          a.updated_at AS updatedAt,
          a.last_sync_at AS lastSyncAt,
          t.scope_set AS scopeSet
         FROM connected_accounts a
         LEFT JOIN token_records t ON t.account_id = a.account_id
         ORDER BY a.created_at ASC`
      )
      .all()
      .map((row) => ({
        ...row,
        canWrite: Boolean(row.canWrite),
        writeScopeGranted: Boolean(row.writeScopeGranted),
        mailScopeGranted: hasMailSendScope(row.provider, row.scopeSet),
        emailSendCapable:
          row.status === 'connected' && hasMailSendScope(row.provider, row.scopeSet),
      }));
  }

  buildScopes(config, accessLevel = 'read') {
    const scopes = [...config.readScopes];
    if (accessLevel === 'write') {
      scopes.push(...config.writeScopes);
    }

    return Array.from(new Set(scopes));
  }

  getOAuthFlow(state) {
    return this.db
      .prepare(
        `SELECT
          state,
          provider,
          requested_access AS requestedAccess,
          redirect_uri AS redirectUri,
          code_verifier_cipher_text AS codeVerifierCipherText,
          created_at AS createdAt,
          expires_at AS expiresAt
         FROM oauth_flows
         WHERE state = :state`
      )
      .get({ state });
  }

  async ensureCallbackServer(config) {
    const redirectUrl = new URL(config.redirectUri);
    const serverKey = `${redirectUrl.protocol}//${redirectUrl.host}`;
    if (this.callbackServers.has(serverKey)) {
      return this.callbackServers.get(serverKey);
    }

    const server = http.createServer(async (request, response) => {
      const requestUrl = new URL(request.url || '/', config.redirectUri);
      if (requestUrl.pathname !== redirectUrl.pathname) {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
      }

      const state = requestUrl.searchParams.get('state');
      const code = requestUrl.searchParams.get('code');
      const error = requestUrl.searchParams.get('error');

      if (error) {
        response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        response.end(
          `<html><body><h1>Calendar connection failed</h1><p>${error}</p><p>You can close this tab and try again.</p></body></html>`
        );
        return;
      }

      if (!state || !code) {
        response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        response.end(
          '<html><body><h1>Missing callback data</h1><p>You can close this tab and try again.</p></body></html>'
        );
        return;
      }

      try {
        const account = await this.finishConnectByState(state, code);
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(
          `<html><body><h1>Calendar connection complete</h1><p>${account?.email || account?.displayName || 'Account'} is now connected.</p><p>You can close this tab and return to the app.</p></body></html>`
        );
      } catch (callbackError) {
        response.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
        response.end(
          `<html><body><h1>Calendar connection failed</h1><p>${callbackError?.message || 'The sign-in could not be completed.'}</p><p>You can close this tab and try again.</p></body></html>`
        );
      }
    });

    await new Promise((resolve, reject) => {
      const handleError = (error) => {
        server.off('listening', handleListening);
        reject(error);
      };
      const handleListening = () => {
        server.off('error', handleError);
        resolve();
      };

      server.once('error', handleError);
      server.once('listening', handleListening);
      server.listen(Number(redirectUrl.port), redirectUrl.hostname);
    });

    this.callbackServers.set(serverKey, server);
    return server;
  }

  async startConnect(provider, accessLevel = 'read') {
    const config = this.getProviderConfig(provider);
    if (!config.clientId) {
      throw new Error(`${provider} OAuth is not configured yet. Add the client ID first.`);
    }

    await this.ensureCallbackServer(config);

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

  findExistingAccount(provider, identity = {}) {
    if (!identity?.sub && !identity?.oid && !identity?.email && !identity?.preferred_username) {
      return null;
    }

    return (
      this.db
        .prepare(
          `SELECT
            account_id AS accountId
           FROM connected_accounts
           WHERE provider = :provider
             AND (
               (:subject IS NOT NULL AND subject = :subject)
               OR (:email IS NOT NULL AND LOWER(email) = LOWER(:email))
             )
           ORDER BY created_at ASC
           LIMIT 1`
        )
        .get({
          provider,
          subject: identity.sub || identity.oid || null,
          email: identity.email || identity.preferred_username || null,
        }) || null
    );
  }

  upsertTokenRecord({ accountId, provider, scopeSet, tokenPayload, timestamp }) {
    const existingToken = this.db
      .prepare(
        `SELECT token_id AS tokenId
         FROM token_records
         WHERE account_id = :accountId
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .get({ accountId });

    const tokenId = existingToken?.tokenId || `token_${crypto.randomUUID()}`;
    const accessTokenCipherText = tokenPayload.access_token
      ? this.cryptoService.encryptText(tokenPayload.access_token, `oauth-token:${tokenId}:access`)
      : null;
    const refreshTokenCipherText = tokenPayload.refresh_token
      ? this.cryptoService.encryptText(
          tokenPayload.refresh_token,
          `oauth-token:${tokenId}:refresh`
        )
      : null;
    const expiresAt = tokenPayload.expires_in
      ? new Date(Date.now() + Number(tokenPayload.expires_in) * 1000).toISOString()
      : null;

    if (existingToken) {
      this.db
        .prepare(
          `UPDATE token_records
           SET provider = :provider,
               scope_set = :scopeSet,
               access_token_cipher_text = :accessTokenCipherText,
               refresh_token_cipher_text = COALESCE(:refreshTokenCipherText, refresh_token_cipher_text),
               expires_at = :expiresAt,
               updated_at = :updatedAt
           WHERE token_id = :tokenId`
        )
        .run({
          tokenId,
          provider,
          scopeSet,
          accessTokenCipherText,
          refreshTokenCipherText,
          expiresAt,
          updatedAt: timestamp,
        });
      return tokenId;
    }

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
        accessTokenCipherText,
        refreshTokenCipherText,
        expiresAt,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

    return tokenId;
  }

  async finishConnectWithFlow(flow, code) {
    if (!flow) {
      throw new Error('OAuth flow was not found.');
    }

    if (new Date(flow.expiresAt).getTime() < Date.now()) {
      throw new Error('OAuth flow has expired.');
    }

    const config = this.getProviderConfig(flow.provider);
    const codeVerifier = this.cryptoService.decryptText(
      flow.codeVerifierCipherText,
      `oauth-flow:${flow.state}`
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
    const timestamp = nowIso();
    const canWrite = flow.requestedAccess === 'write';
    const scopeSet = String(
      tokenPayload.scope || this.buildScopes(config, flow.requestedAccess).join(' ')
    );
    const existingAccount = this.findExistingAccount(flow.provider, identity);
    const accountId = existingAccount?.accountId || `acct_${crypto.randomUUID()}`;

    this.db.exec('BEGIN');

    try {
      if (existingAccount) {
        this.db
          .prepare(
            `UPDATE connected_accounts
             SET subject = :subject,
                 email = :email,
                 display_name = :displayName,
                 permission_mode = :permissionMode,
                 status = 'connected',
                 can_write = :canWrite,
                 write_scope_granted = :writeScopeGranted,
                 updated_at = :updatedAt
             WHERE account_id = :accountId`
          )
          .run({
            accountId,
            subject: identity.sub || identity.oid || null,
            email: identity.email || identity.preferred_username || null,
            displayName: identity.name || identity.given_name || flow.provider,
            permissionMode: flow.requestedAccess,
            canWrite: canWrite ? 1 : 0,
            writeScopeGranted: canWrite ? 1 : 0,
            updatedAt: timestamp,
          });
      } else {
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
            provider: flow.provider,
            subject: identity.sub || identity.oid || null,
            email: identity.email || identity.preferred_username || null,
            displayName: identity.name || identity.given_name || flow.provider,
            permissionMode: flow.requestedAccess,
            canWrite: canWrite ? 1 : 0,
            writeScopeGranted: canWrite ? 1 : 0,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
      }

      this.upsertTokenRecord({
        accountId,
        provider: flow.provider,
        scopeSet,
        tokenPayload,
        timestamp,
      });

      this.db.prepare('DELETE FROM oauth_flows WHERE state = :state').run({ state: flow.state });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }

    this.onAudit?.('oauth_connect_completed', {
      targetType: 'account',
      targetId: accountId,
      details: {
        provider: flow.provider,
        permissionMode: flow.requestedAccess,
        mailScopeGranted: hasMailSendScope(flow.provider, scopeSet),
      },
    });

    return this.listConnectedAccounts().find((account) => account.accountId === accountId);
  }

  async finishConnectByState(state, code) {
    const flow = this.getOAuthFlow(state);
    return this.finishConnectWithFlow(flow, code);
  }

  async finishConnect({ provider, state, code }) {
    const flow = this.getOAuthFlow(state);
    if (!flow || flow.provider !== provider) {
      throw new Error('OAuth flow was not found.');
    }

    return this.finishConnectWithFlow(flow, code);
  }

  getAccountTokenRow(accountId) {
    return this.db
      .prepare(
        `SELECT
          a.account_id AS accountId,
          a.provider,
          a.email,
          a.display_name AS displayName,
          a.status,
          t.token_id AS tokenId,
          t.scope_set AS scopeSet,
          t.access_token_cipher_text AS accessTokenCipherText,
          t.refresh_token_cipher_text AS refreshTokenCipherText,
          t.expires_at AS expiresAt
         FROM connected_accounts a
         LEFT JOIN token_records t ON t.account_id = a.account_id
         WHERE a.account_id = :accountId
         LIMIT 1`
      )
      .get({ accountId });
  }

  async refreshAccessToken(accountId) {
    const account = this.getAccountTokenRow(accountId);
    if (!account?.tokenId || !account?.refreshTokenCipherText) {
      throw new Error('A refresh token is not available for this account.');
    }

    const config = this.getProviderConfig(account.provider);
    const refreshToken = this.cryptoService.decryptText(
      account.refreshTokenCipherText,
      `oauth-token:${account.tokenId}:refresh`
    );

    const tokenResponse = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`OAuth token refresh failed: ${errorText}`);
    }

    const tokenPayload = await tokenResponse.json();
    const timestamp = nowIso();
    const nextScopeSet = String(tokenPayload.scope || account.scopeSet || '');

    this.db
      .prepare(
        `UPDATE token_records
         SET scope_set = :scopeSet,
             access_token_cipher_text = :accessTokenCipherText,
             refresh_token_cipher_text = COALESCE(:refreshTokenCipherText, refresh_token_cipher_text),
             expires_at = :expiresAt,
             updated_at = :updatedAt
         WHERE token_id = :tokenId`
      )
      .run({
        tokenId: account.tokenId,
        scopeSet: nextScopeSet,
        accessTokenCipherText: tokenPayload.access_token
          ? this.cryptoService.encryptText(
              tokenPayload.access_token,
              `oauth-token:${account.tokenId}:access`
            )
          : account.accessTokenCipherText,
        refreshTokenCipherText: tokenPayload.refresh_token
          ? this.cryptoService.encryptText(
              tokenPayload.refresh_token,
              `oauth-token:${account.tokenId}:refresh`
            )
          : null,
        expiresAt: tokenPayload.expires_in
          ? new Date(Date.now() + Number(tokenPayload.expires_in) * 1000).toISOString()
          : account.expiresAt,
        updatedAt: timestamp,
      });

    return this.getAccountTokenRow(accountId);
  }

  async getAccessTokenForAccount(accountId) {
    let account = this.getAccountTokenRow(accountId);
    if (!account?.tokenId || !account?.accessTokenCipherText) {
      throw new Error('Connected account token was not found.');
    }

    const expiresAtTime = account.expiresAt ? new Date(account.expiresAt).getTime() : null;
    if (expiresAtTime && expiresAtTime - TOKEN_REFRESH_SKEW_MS <= Date.now()) {
      account = await this.refreshAccessToken(accountId);
    }

    if (!account?.accessTokenCipherText) {
      throw new Error('Connected account token was not found.');
    }

    return this.cryptoService.decryptText(
      account.accessTokenCipherText,
      `oauth-token:${account.tokenId}:access`
    );
  }

  resolveReminderSenderAccount(scope = 'internal') {
    const accounts = this.listConnectedAccounts().filter((account) => account.emailSendCapable);
    if (scope === 'work') {
      return accounts.find((account) => account.provider === 'google') || null;
    }

    if (scope === 'personal') {
      return accounts.find((account) => account.provider === 'microsoft') || null;
    }

    return accounts[0] || null;
  }

  async sendEmailViaGoogle(accessToken, recipient, subject, bodyText) {
    const mimeMessage = [
      `To: ${recipient}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      bodyText,
    ].join('\r\n');
    const raw = Buffer.from(mimeMessage, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');

    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google email send failed: ${errorText}`);
    }
  }

  async sendEmailViaMicrosoft(accessToken, recipient, subject, bodyText) {
    const response = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject,
          body: {
            contentType: 'Text',
            content: bodyText,
          },
          toRecipients: [
            {
              emailAddress: {
                address: recipient,
              },
            },
          ],
        },
        saveToSentItems: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Microsoft email send failed: ${errorText}`);
    }
  }

  async sendReminderEmail({ scope = 'internal', recipients = [], subject, bodyText }) {
    const senderAccount = this.resolveReminderSenderAccount(scope);
    if (!senderAccount) {
      throw new Error('No connected account with mail permissions is available for this scope.');
    }

    const accessToken = await this.getAccessTokenForAccount(senderAccount.accountId);
    for (const recipient of recipients) {
      if (senderAccount.provider === 'google') {
        await this.sendEmailViaGoogle(accessToken, recipient, subject, bodyText);
        continue;
      }

      if (senderAccount.provider === 'microsoft') {
        await this.sendEmailViaMicrosoft(accessToken, recipient, subject, bodyText);
        continue;
      }

      throw new Error(`Unsupported reminder email provider: ${senderAccount.provider}`);
    }

    return {
      senderAccountId: senderAccount.accountId,
      provider: senderAccount.provider,
      recipients,
    };
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

  close() {
    for (const server of this.callbackServers.values()) {
      server.close();
    }
    this.callbackServers.clear();
  }
}

module.exports = { OAuthService };
