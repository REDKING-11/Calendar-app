const crypto = require('node:crypto');
const http = require('node:http');

const GOOGLE_GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const MICROSOFT_MAIL_SEND_SCOPE = 'Mail.Send';
const MICROSOFT_DEFAULT_AUTHORITY = 'common';
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;
const OAUTH_PROVIDER_SETUP = {
  google: {
    label: 'Google',
    clientIdEnv: 'CALENDAR_GOOGLE_CLIENT_ID',
    redirectUriEnv: 'CALENDAR_GOOGLE_REDIRECT_URI',
    clientIdMetaKey: 'oauth.google.clientId',
    redirectUriMetaKey: 'oauth.google.redirectUri',
    defaultRedirectUri: 'http://127.0.0.1:45781/oauth/google/callback',
  },
  microsoft: {
    label: 'Outlook',
    clientIdEnv: 'CALENDAR_MICROSOFT_CLIENT_ID',
    redirectUriEnv: 'CALENDAR_MICROSOFT_REDIRECT_URI',
    authorityEnv: 'CALENDAR_MICROSOFT_AUTHORITY',
    clientIdMetaKey: 'oauth.microsoft.clientId',
    redirectUriMetaKey: 'oauth.microsoft.redirectUri',
    authorityMetaKey: 'oauth.microsoft.authority',
    defaultRedirectUri: 'http://localhost:45782/oauth/microsoft/callback',
    defaultAuthority: MICROSOFT_DEFAULT_AUTHORITY,
  },
};

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

function sanitizeOAuthClientId(value) {
  const candidate = String(value || '').trim();
  if (!candidate) {
    return '';
  }

  if (candidate.length > 500 || /[\s\u0000-\u001f\u007f]/.test(candidate)) {
    throw new Error('OAuth client ID must be a single line without spaces.');
  }

  return candidate;
}

function sanitizeOAuthRedirectUri(value, provider) {
  const setup = OAUTH_PROVIDER_SETUP[provider];
  const candidate = String(value || '').trim() || setup?.defaultRedirectUri || '';

  try {
    const parsed = new URL(candidate);
    const hostname = parsed.hostname.toLowerCase();
    if (
      parsed.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost'].includes(hostname) ||
      !parsed.port
    ) {
      throw new Error('Redirect URI must use localhost with an explicit port.');
    }

    return parsed.toString();
  } catch (_error) {
    throw new Error('OAuth redirect URI must be a localhost HTTP URL with a port.');
  }
}

function sanitizeMicrosoftAuthority(value) {
  const candidate = String(value || '').trim().toLowerCase() || MICROSOFT_DEFAULT_AUTHORITY;
  if (!/^[a-z0-9][a-z0-9._-]{0,199}$/i.test(candidate)) {
    throw new Error(
      'Microsoft authority must be "common", "organizations", "consumers", or a tenant domain/GUID.'
    );
  }

  return candidate;
}

function buildMicrosoftAuthorityBase(authority = MICROSOFT_DEFAULT_AUTHORITY) {
  return `https://login.microsoftonline.com/${encodeURIComponent(
    sanitizeMicrosoftAuthority(authority)
  )}/oauth2/v2.0`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeOAuthErrorText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getMicrosoftOAuthHints(config = {}, error = '', errorDescription = '') {
  const detail = `${error} ${errorDescription}`.toLowerCase();
  const redirectUri = config.redirectUri || OAUTH_PROVIDER_SETUP.microsoft.defaultRedirectUri;
  const authority = sanitizeMicrosoftAuthority(
    config.authority || OAUTH_PROVIDER_SETUP.microsoft.defaultAuthority
  );

  const hints = [
    `Check Microsoft Entra Authentication -> Mobile and desktop applications and make sure the redirect URI matches exactly: ${redirectUri}.`,
    `Match the Microsoft authority to the app registration: "common" for multitenant + personal, "organizations" for work/school only, "consumers" for personal-only, or your tenant domain/GUID for single-tenant apps.`,
  ];

  if (
    detail.includes('invalid_request') ||
    detail.includes('not valid for the app') ||
    detail.includes('tenant') ||
    detail.includes('audience') ||
    detail.includes('account')
  ) {
    hints.push(
      `The app is currently using the "${authority}" authority. If your registration is single-tenant, switch Calendar App to your tenant domain or GUID.`
    );
  }

  if (String(redirectUri).includes('127.0.0.1')) {
    hints.push(
      'Microsoft Learn notes that HTTP 127.0.0.1 loopback URIs need app-manifest editing instead of the normal Redirect URIs text box. Using localhost is the simpler portal setup.'
    );
  }

  return hints;
}

function buildOAuthCallbackErrorPage(config = {}, error = '', errorDescription = '', errorUri = '') {
  const providerLabel = OAUTH_PROVIDER_SETUP[config.provider]?.label || 'Provider';
  const description =
    normalizeOAuthErrorText(errorDescription) ||
    normalizeOAuthErrorText(error) ||
    'The sign-in could not be completed.';
  const hints =
    config.provider === 'microsoft'
      ? getMicrosoftOAuthHints(config, error, description)
      : [];
  const hintMarkup = hints.length
    ? `<h2>What to check</h2><ul>${hints
        .map((hint) => `<li>${escapeHtml(hint)}</li>`)
        .join('')}</ul>`
    : '';
  const errorUriMarkup = errorUri
    ? `<p>More info: <a href="${escapeHtml(errorUri)}">${escapeHtml(errorUri)}</a></p>`
    : '';

  return `<!doctype html>
<html>
  <body>
    <h1>${escapeHtml(providerLabel)} connection failed</h1>
    <p>${escapeHtml(description)}</p>
    ${hintMarkup}
    ${errorUriMarkup}
    <p>You can close this tab and try again.</p>
  </body>
</html>`;
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

function normalizeCalendarColor(color, fallback = '#4f9d69') {
  const candidate = String(color || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(candidate) ? candidate.toLowerCase() : fallback;
}

function buildRepeatFromRrule(recurrence = []) {
  const ruleLine = (Array.isArray(recurrence) ? recurrence : [recurrence]).find((entry) =>
    String(entry || '').trim().toUpperCase().startsWith('RRULE:')
  );
  if (!ruleLine) {
    return 'none';
  }

  const match = String(ruleLine)
    .trim()
    .toUpperCase()
    .match(/FREQ=([A-Z]+)/);
  switch (match?.[1]) {
    case 'DAILY':
      return 'daily';
    case 'WEEKLY':
      return 'weekly';
    case 'MONTHLY':
      return 'monthly';
    default:
      return 'none';
  }
}

function buildRepeatFromMicrosoftPattern(pattern = {}) {
  switch (String(pattern?.type || '').trim().toLowerCase()) {
    case 'daily':
      return 'daily';
    case 'weekly':
      return 'weekly';
    case 'absolutemonthly':
    case 'relativemonthly':
      return 'monthly';
    default:
      return 'none';
  }
}

function formatDateOnly(date) {
  const value = date instanceof Date ? date : new Date(date);
  return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
}

function stripMilliseconds(isoValue) {
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) {
    return String(isoValue || '');
  }

  return date.toISOString().replace(/\.\d{3}Z$/, '');
}

function buildGoogleRecurrence(repeat) {
  switch (String(repeat || 'none').trim().toLowerCase()) {
    case 'daily':
      return ['RRULE:FREQ=DAILY'];
    case 'weekly':
      return ['RRULE:FREQ=WEEKLY'];
    case 'monthly':
      return ['RRULE:FREQ=MONTHLY'];
    default:
      return undefined;
  }
}

function buildMicrosoftRecurrence(repeat, startsAt) {
  const startDate = formatDateOnly(startsAt);
  if (!startDate) {
    return undefined;
  }

  const normalized = String(repeat || 'none').trim().toLowerCase();
  if (normalized === 'daily') {
    return {
      pattern: { type: 'daily', interval: 1 },
      range: { type: 'noEnd', startDate },
    };
  }

  if (normalized === 'weekly') {
    const weekday = new Date(startsAt)
      .toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
      .toLowerCase();
    return {
      pattern: { type: 'weekly', interval: 1, daysOfWeek: [weekday] },
      range: { type: 'noEnd', startDate },
    };
  }

  if (normalized === 'monthly') {
    return {
      pattern: { type: 'absoluteMonthly', interval: 1, dayOfMonth: new Date(startsAt).getUTCDate() },
      range: { type: 'noEnd', startDate },
    };
  }

  return undefined;
}

function buildGoogleCalendarEventPayload(event = {}, attendees = []) {
  const payload = {
    summary: event.title || 'Untitled event',
    description: event.description || '',
    location: event.location || '',
    attendees: attendees.map((email) => ({ email })),
  };

  if (event.isAllDay) {
    payload.start = { date: formatDateOnly(event.startsAt) };
    payload.end = { date: formatDateOnly(event.endsAt) };
  } else {
    payload.start = {
      dateTime: new Date(event.startsAt).toISOString(),
      timeZone: event.sourceTimeZone || 'UTC',
    };
    payload.end = {
      dateTime: new Date(event.endsAt).toISOString(),
      timeZone: event.sourceTimeZone || 'UTC',
    };
  }

  const recurrence = buildGoogleRecurrence(event.repeat);
  if (recurrence) {
    payload.recurrence = recurrence;
  }

  return payload;
}

function buildMicrosoftCalendarEventPayload(event = {}, attendees = []) {
  const payload = {
    subject: event.title || 'Untitled event',
    body: {
      contentType: 'Text',
      content: event.description || '',
    },
    location: event.location ? { displayName: event.location } : undefined,
    isAllDay: Boolean(event.isAllDay),
    start: {
      dateTime: event.isAllDay ? `${formatDateOnly(event.startsAt)}T00:00:00` : stripMilliseconds(event.startsAt),
      timeZone: event.sourceTimeZone || 'UTC',
    },
    end: {
      dateTime: event.isAllDay ? `${formatDateOnly(event.endsAt)}T00:00:00` : stripMilliseconds(event.endsAt),
      timeZone: event.sourceTimeZone || 'UTC',
    },
    attendees: attendees.map((email) => ({
      emailAddress: { address: email },
      type: 'required',
    })),
  };

  const recurrence = buildMicrosoftRecurrence(event.repeat, event.startsAt);
  if (recurrence) {
    payload.recurrence = recurrence;
  }

  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

function buildGoogleDateTime(entry = {}, fallbackMinutes = 60) {
  if (entry?.date) {
    const startsAt = new Date(`${entry.date}T00:00:00.000Z`);
    const endsAt = new Date(startsAt);
    endsAt.setUTCMinutes(endsAt.getUTCMinutes() + fallbackMinutes);
    return {
      date: startsAt,
      fallbackDate: endsAt,
      isAllDay: true,
      sourceTimeZone: String(entry?.timeZone || ''),
    };
  }

  const date = new Date(entry?.dateTime || '');
  const fallbackDate = new Date(date);
  fallbackDate.setUTCMinutes(fallbackDate.getUTCMinutes() + fallbackMinutes);
  return {
    date,
    fallbackDate,
    isAllDay: false,
    sourceTimeZone: String(entry?.timeZone || ''),
  };
}

function buildMicrosoftDateTime(entry = {}, fallbackMinutes = 60) {
  const rawDateTime = String(entry?.dateTime || '').trim();
  const date = rawDateTime.endsWith('Z') ? new Date(rawDateTime) : new Date(rawDateTime);
  const fallbackDate = new Date(date);
  fallbackDate.setUTCMinutes(fallbackDate.getUTCMinutes() + fallbackMinutes);
  return {
    date,
    fallbackDate,
    isAllDay: false,
    sourceTimeZone: String(entry?.timeZone || ''),
  };
}

function mapGoogleCalendarItem(accountId, item = {}) {
  return {
    accountId,
    provider: 'google',
    remoteCalendarId: String(item.id || ''),
    displayName: String(item.summary || item.id || 'Google Calendar').trim(),
    selected: Boolean(item.selected ?? true),
    color: normalizeCalendarColor(item.backgroundColor, '#4f9d69'),
    timeZone: String(item.timeZone || ''),
    primary: Boolean(item.primary),
    accessRole: String(item.accessRole || ''),
  };
}

function mapGoogleEventItem(item = {}, calendar = {}) {
  const startInfo = buildGoogleDateTime(item.start || {}, 24 * 60);
  const endInfo = buildGoogleDateTime(item.end || {}, startInfo.isAllDay ? 24 * 60 : 60);
  const startsAt = startInfo.date;
  const endsAt = endInfo.date;

  if (Number.isNaN(startsAt.getTime())) {
    return null;
  }

  const effectiveEndsAt =
    Number.isNaN(endsAt.getTime()) || endsAt <= startsAt ? endInfo.fallbackDate : endsAt;

  return {
    provider: 'google',
    remoteCalendarId: String(calendar.remoteCalendarId || calendar.id || ''),
    remoteEventId: String(item.id || ''),
    remoteVersion: String(item.etag || item.updated || item.sequence || ''),
    remoteDeleted: String(item.status || '').trim().toLowerCase() === 'cancelled',
    title: String(item.summary || 'Imported event').trim() || 'Imported event',
    description: String(item.description || ''),
    location: String(item.location || ''),
    people: Array.isArray(item.attendees)
      ? item.attendees
          .map((attendee) => attendee?.email || attendee?.displayName || '')
          .filter(Boolean)
      : [],
    type: 'meeting',
    completed: false,
    repeat: buildRepeatFromRrule(item.recurrence),
    hasDeadline: false,
    groupName: '',
    startsAt: startsAt.toISOString(),
    endsAt: effectiveEndsAt.toISOString(),
    isAllDay: Boolean(startInfo.isAllDay),
    sourceTimeZone: startInfo.sourceTimeZone || endInfo.sourceTimeZone || calendar.timeZone || '',
    reminderMinutesBeforeStart: null,
    desktopNotificationEnabled: false,
    emailNotificationEnabled: false,
    emailNotificationRecipients: [],
    notifications: [],
    color: normalizeCalendarColor(calendar.color, '#4f9d69'),
    tags: [],
    syncPolicy: 'internal_only',
    visibility: 'private',
    externalProviderLinks: [
      {
        provider: 'google',
        externalEventId: String(item.id || ''),
        url: String(item.htmlLink || ''),
      },
    ],
  };
}

function mapMicrosoftCalendarItem(accountId, item = {}) {
  return {
    accountId,
    provider: 'microsoft',
    remoteCalendarId: String(item.id || ''),
    displayName: String(item.name || item.id || 'Outlook Calendar').trim(),
    selected: Boolean(item.canEdit ?? true),
    color: normalizeCalendarColor(item.hexColor, '#4d8cf5'),
    timeZone: String(item?.owner?.mailboxSettings?.timeZone || item?.timeZone || ''),
    primary: Boolean(item.isDefaultCalendar),
    accessRole: item.canEdit ? 'writer' : 'reader',
  };
}

function mapMicrosoftEventItem(item = {}, calendar = {}) {
  const startInfo = buildMicrosoftDateTime(item.start || {}, item.isAllDay ? 24 * 60 : 60);
  const endInfo = buildMicrosoftDateTime(item.end || {}, item.isAllDay ? 24 * 60 : 60);
  const startsAt = startInfo.date;
  const endsAt = endInfo.date;

  if (Number.isNaN(startsAt.getTime())) {
    return null;
  }

  const effectiveEndsAt =
    Number.isNaN(endsAt.getTime()) || endsAt <= startsAt ? endInfo.fallbackDate : endsAt;

  return {
    provider: 'microsoft',
    remoteCalendarId: String(calendar.remoteCalendarId || calendar.id || ''),
    remoteEventId: String(item.id || ''),
    remoteVersion: String(item['@odata.etag'] || item.changeKey || item.lastModifiedDateTime || ''),
    remoteDeleted: Boolean(item.isCancelled),
    title: String(item.subject || 'Imported event').trim() || 'Imported event',
    description: String(item.bodyPreview || ''),
    location: String(item.location?.displayName || ''),
    people: Array.isArray(item.attendees)
      ? item.attendees
          .map((attendee) => attendee?.emailAddress?.address || attendee?.emailAddress?.name || '')
          .filter(Boolean)
      : [],
    type: 'meeting',
    completed: false,
    repeat: buildRepeatFromMicrosoftPattern(item.recurrence?.pattern),
    hasDeadline: false,
    groupName: '',
    startsAt: startsAt.toISOString(),
    endsAt: effectiveEndsAt.toISOString(),
    isAllDay: Boolean(item.isAllDay),
    sourceTimeZone: startInfo.sourceTimeZone || endInfo.sourceTimeZone || calendar.timeZone || '',
    reminderMinutesBeforeStart: null,
    desktopNotificationEnabled: false,
    emailNotificationEnabled: false,
    emailNotificationRecipients: [],
    notifications: [],
    color: normalizeCalendarColor(calendar.color, '#4d8cf5'),
    tags: [],
    syncPolicy: 'internal_only',
    visibility: 'private',
    externalProviderLinks: [
      {
        provider: 'microsoft',
        externalEventId: String(item.id || ''),
        url: String(item.webLink || item.onlineMeetingUrl || ''),
      },
    ],
  };
}

class OAuthService {
  constructor({ db, cryptoService, shell, onAudit }) {
    this.db = db;
    this.cryptoService = cryptoService;
    this.shell = shell;
    this.onAudit = onAudit;
    this.callbackServers = new Map();
  }

  getMetaValue(key) {
    const row = this.db
      .prepare('SELECT value FROM app_meta WHERE key = :key')
      .get({ key });

    return row?.value ?? '';
  }

  setMetaValue(key, value) {
    this.db
      .prepare(
        `INSERT INTO app_meta (key, value)
         VALUES (:key, :value)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run({
        key,
        value: String(value || ''),
      });
  }

  getResolvedClientSetup(provider) {
    const setup = OAUTH_PROVIDER_SETUP[provider];
    if (!setup) {
      throw new Error(`Unsupported OAuth provider: ${provider}`);
    }

    const storedClientId = this.getMetaValue(setup.clientIdMetaKey);
    const envClientId = process.env[setup.clientIdEnv] || '';
    const storedRedirectUri = this.getMetaValue(setup.redirectUriMetaKey);
    const envRedirectUri = process.env[setup.redirectUriEnv] || '';
    const storedAuthority = setup.authorityMetaKey ? this.getMetaValue(setup.authorityMetaKey) : '';
    const envAuthority = setup.authorityEnv ? process.env[setup.authorityEnv] || '' : '';
    const clientId = storedClientId || envClientId || '';
    const redirectUri = storedRedirectUri || envRedirectUri || setup.defaultRedirectUri;
    const authority = setup.defaultAuthority
      ? sanitizeMicrosoftAuthority(storedAuthority || envAuthority || setup.defaultAuthority)
      : '';

    return {
      ...setup,
      provider,
      clientId,
      clientIdSource: storedClientId ? 'settings' : envClientId ? 'environment' : '',
      redirectUri,
      redirectUriSource: storedRedirectUri ? 'settings' : envRedirectUri ? 'environment' : 'default',
      authority,
      authoritySource: setup.defaultAuthority
        ? storedAuthority
          ? 'settings'
          : envAuthority
            ? 'environment'
            : 'default'
        : '',
    };
  }

  getClientConfigSnapshot() {
    return Object.fromEntries(
      Object.keys(OAUTH_PROVIDER_SETUP).map((provider) => {
        const setup = this.getResolvedClientSetup(provider);
        return [
          provider,
          {
            provider,
            label: setup.label,
            clientId: setup.clientId,
            clientIdConfigured: Boolean(setup.clientId),
            clientIdSource: setup.clientIdSource,
            redirectUri: setup.redirectUri,
            redirectUriSource: setup.redirectUriSource,
            defaultRedirectUri: setup.defaultRedirectUri,
            authority: setup.authority,
            authoritySource: setup.authoritySource,
            defaultAuthority: setup.defaultAuthority || '',
          },
        ];
      })
    );
  }

  updateClientConfig(input = {}) {
    for (const provider of Object.keys(OAUTH_PROVIDER_SETUP)) {
      if (!Object.prototype.hasOwnProperty.call(input || {}, provider)) {
        continue;
      }

      const setup = OAUTH_PROVIDER_SETUP[provider];
      const providerInput = input?.[provider] || {};
      if (Object.prototype.hasOwnProperty.call(providerInput, 'clientId')) {
        this.setMetaValue(setup.clientIdMetaKey, sanitizeOAuthClientId(providerInput.clientId));
      }

      if (Object.prototype.hasOwnProperty.call(providerInput, 'redirectUri')) {
        this.setMetaValue(
          setup.redirectUriMetaKey,
          sanitizeOAuthRedirectUri(providerInput.redirectUri, provider)
        );
      }

      if (provider === 'microsoft' && Object.prototype.hasOwnProperty.call(providerInput, 'authority')) {
        this.setMetaValue(
          setup.authorityMetaKey,
          sanitizeMicrosoftAuthority(providerInput.authority)
        );
      }
    }

    return this.getClientConfigSnapshot();
  }

  getProviders() {
    const googleSetup = this.getResolvedClientSetup('google');
    const microsoftSetup = this.getResolvedClientSetup('microsoft');

    return [
      {
        id: 'google',
        label: 'Google',
        configured: Boolean(googleSetup.clientId),
        clientIdSource: googleSetup.clientIdSource,
        redirectUri: googleSetup.redirectUri,
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
        label: 'Outlook',
        configured: Boolean(microsoftSetup.clientId),
        clientIdSource: microsoftSetup.clientIdSource,
        redirectUri: microsoftSetup.redirectUri,
        delegatedOnly: true,
        readScopes: ['openid', 'profile', 'email', 'offline_access', 'Calendars.Read'],
        writeScopes: ['Calendars.ReadWrite', MICROSOFT_MAIL_SEND_SCOPE],
      },
    ];
  }

  getProviderConfig(provider) {
    if (provider === 'google') {
      const clientSetup = this.getResolvedClientSetup(provider);
      return {
        provider,
        clientId: clientSetup.clientId,
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        revokeUrl: 'https://oauth2.googleapis.com/revoke',
        redirectUri: clientSetup.redirectUri,
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
      const clientSetup = this.getResolvedClientSetup(provider);
      const authorityBase = buildMicrosoftAuthorityBase(clientSetup.authority);
      return {
        provider,
        clientId: clientSetup.clientId,
        authUrl: `${authorityBase}/authorize`,
        tokenUrl: `${authorityBase}/token`,
        revokeUrl: null,
        redirectUri: clientSetup.redirectUri,
        authority: clientSetup.authority,
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
      const errorDescription = requestUrl.searchParams.get('error_description');
      const errorUri = requestUrl.searchParams.get('error_uri');

      if (error) {
        response.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        response.end(buildOAuthCallbackErrorPage(config, error, errorDescription, errorUri));
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
          `<!doctype html><html><body><h1>Calendar connection complete</h1><p>${escapeHtml(
            account?.email || account?.displayName || 'Account'
          )} is now connected.</p><p>You can close this tab and return to the app.</p></body></html>`
        );
      } catch (callbackError) {
        response.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
        response.end(
          `<!doctype html><html><body><h1>Calendar connection failed</h1><p>${escapeHtml(
            callbackError?.message || 'The sign-in could not be completed.'
          )}</p><p>You can close this tab and try again.</p></body></html>`
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
      const label = OAUTH_PROVIDER_SETUP[provider]?.label || provider;
      throw new Error(`${label} connection is not configured yet. Add the OAuth client ID in Settings first.`);
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
      await this.shell.openExternal(authorizationUrl.toString());
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

  async requestProviderJson(url, accessToken, options = {}) {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (response.status === 204) {
      return {};
    }

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json()
      : { message: await response.text() };

    if (!response.ok) {
      throw new Error(
        payload?.error?.message || payload?.message || `Provider request failed with status ${response.status}.`
      );
    }

    return payload;
  }

  async listExternalCalendars(accountId) {
    const account = this.getAccountTokenRow(accountId);
    if (!account || account.status !== 'connected') {
      throw new Error('Connected account was not found.');
    }

    const accessToken = await this.getAccessTokenForAccount(accountId);
    if (account.provider === 'google') {
      let nextPageToken = '';
      const calendars = [];

      do {
        const url = new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList');
        url.searchParams.set('maxResults', '250');
        if (nextPageToken) {
          url.searchParams.set('pageToken', nextPageToken);
        }

        const payload = await this.requestProviderJson(url.toString(), accessToken);
        calendars.push(
          ...(Array.isArray(payload.items) ? payload.items : []).map((item) =>
            mapGoogleCalendarItem(accountId, item)
          )
        );
        nextPageToken = String(payload.nextPageToken || '').trim();
      } while (nextPageToken);

      return calendars.filter((calendar) => calendar.remoteCalendarId);
    }

    if (account.provider === 'microsoft') {
      const calendars = [];
      let nextUrl = 'https://graph.microsoft.com/v1.0/me/calendars?$top=100';

      while (nextUrl) {
        const payload = await this.requestProviderJson(nextUrl, accessToken);
        calendars.push(
          ...(Array.isArray(payload.value) ? payload.value : []).map((item) =>
            mapMicrosoftCalendarItem(accountId, item)
          )
        );
        nextUrl = String(payload['@odata.nextLink'] || '').trim();
      }

      return calendars.filter((calendar) => calendar.remoteCalendarId);
    }

    throw new Error(`Provider does not support calendar listing: ${account.provider}`);
  }

  async listExternalEvents(accountId, remoteCalendarId, context = {}) {
    const account = this.getAccountTokenRow(accountId);
    if (!account || account.status !== 'connected') {
      throw new Error('Connected account was not found.');
    }

    const accessToken = await this.getAccessTokenForAccount(accountId);
    const calendar = {
      remoteCalendarId,
      color: context.color || '#4f9d69',
      timeZone: context.timeZone || '',
    };

    if (account.provider === 'google') {
      let nextPageToken = '';
      const events = [];

      do {
        const url = new URL(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
            remoteCalendarId
          )}/events`
        );
        url.searchParams.set('singleEvents', 'true');
        url.searchParams.set('showDeleted', 'true');
        url.searchParams.set('maxResults', '2500');
        if (nextPageToken) {
          url.searchParams.set('pageToken', nextPageToken);
        }

        const payload = await this.requestProviderJson(url.toString(), accessToken);
        events.push(
          ...(Array.isArray(payload.items) ? payload.items : [])
            .map((item) => mapGoogleEventItem(item, calendar))
            .filter(Boolean)
        );
        nextPageToken = String(payload.nextPageToken || '').trim();
      } while (nextPageToken);

      return {
        provider: 'google',
        remoteCalendarId,
        events,
        syncCursor: null,
      };
    }

    if (account.provider === 'microsoft') {
      const events = [];
      let nextUrl = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(
        remoteCalendarId
      )}/events?$top=250&$select=id,subject,bodyPreview,location,attendees,start,end,isAllDay,isCancelled,recurrence,webLink,onlineMeetingUrl,lastModifiedDateTime,changeKey`;

      while (nextUrl) {
        const payload = await this.requestProviderJson(nextUrl, accessToken);
        events.push(
          ...(Array.isArray(payload.value) ? payload.value : [])
            .map((item) => mapMicrosoftEventItem(item, calendar))
            .filter(Boolean)
        );
        nextUrl = String(payload['@odata.nextLink'] || '').trim();
      }

      return {
        provider: 'microsoft',
        remoteCalendarId,
        events,
        syncCursor: null,
      };
    }

    throw new Error(`Provider does not support event listing: ${account.provider}`);
  }

  async createOutboundCalendarEvent({ accountId, remoteCalendarId, event, attendees = [] }) {
    const account = this.getAccountTokenRow(accountId);
    if (!account || account.status !== 'connected') {
      throw new Error('Connected account was not found.');
    }

    const accessToken = await this.getAccessTokenForAccount(accountId);
    if (account.provider === 'google') {
      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
          remoteCalendarId
        )}/events`
      );
      url.searchParams.set('sendUpdates', 'all');
      const payload = await this.requestProviderJson(url.toString(), accessToken, {
        method: 'POST',
        body: buildGoogleCalendarEventPayload(event, attendees),
      });
      return {
        accountId,
        provider: 'google',
        remoteCalendarId,
        remoteEventId: String(payload.id || ''),
        remoteVersion: String(payload.etag || payload.updated || payload.sequence || ''),
        url: String(payload.htmlLink || ''),
      };
    }

    if (account.provider === 'microsoft') {
      const url = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(
        remoteCalendarId
      )}/events`;
      const payload = await this.requestProviderJson(url, accessToken, {
        method: 'POST',
        body: buildMicrosoftCalendarEventPayload(event, attendees),
      });
      return {
        accountId,
        provider: 'microsoft',
        remoteCalendarId,
        remoteEventId: String(payload.id || ''),
        remoteVersion: String(payload['@odata.etag'] || payload.changeKey || payload.lastModifiedDateTime || ''),
        url: String(payload.webLink || payload.onlineMeetingUrl || ''),
      };
    }

    throw new Error(`Provider does not support calendar invites: ${account.provider}`);
  }

  async updateOutboundCalendarEvent({
    accountId,
    remoteCalendarId,
    remoteEventId,
    event,
    attendees = [],
  }) {
    const account = this.getAccountTokenRow(accountId);
    if (!account || account.status !== 'connected') {
      throw new Error('Connected account was not found.');
    }

    const accessToken = await this.getAccessTokenForAccount(accountId);
    if (account.provider === 'google') {
      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
          remoteCalendarId
        )}/events/${encodeURIComponent(remoteEventId)}`
      );
      url.searchParams.set('sendUpdates', 'all');
      const payload = await this.requestProviderJson(url.toString(), accessToken, {
        method: 'PATCH',
        body: buildGoogleCalendarEventPayload(event, attendees),
      });
      return {
        accountId,
        provider: 'google',
        remoteCalendarId,
        remoteEventId: String(payload.id || remoteEventId),
        remoteVersion: String(payload.etag || payload.updated || payload.sequence || ''),
        url: String(payload.htmlLink || ''),
      };
    }

    if (account.provider === 'microsoft') {
      const url = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(
        remoteCalendarId
      )}/events/${encodeURIComponent(remoteEventId)}`;
      const payload = await this.requestProviderJson(url, accessToken, {
        method: 'PATCH',
        body: buildMicrosoftCalendarEventPayload(event, attendees),
      });
      return {
        accountId,
        provider: 'microsoft',
        remoteCalendarId,
        remoteEventId: String(payload.id || remoteEventId),
        remoteVersion: String(payload['@odata.etag'] || payload.changeKey || payload.lastModifiedDateTime || ''),
        url: String(payload.webLink || payload.onlineMeetingUrl || ''),
      };
    }

    throw new Error(`Provider does not support calendar invite updates: ${account.provider}`);
  }

  async deleteOutboundCalendarEvent({ accountId, remoteCalendarId, remoteEventId }) {
    const account = this.getAccountTokenRow(accountId);
    if (!account || account.status !== 'connected') {
      throw new Error('Connected account was not found.');
    }

    const accessToken = await this.getAccessTokenForAccount(accountId);
    if (account.provider === 'google') {
      const url = new URL(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
          remoteCalendarId
        )}/events/${encodeURIComponent(remoteEventId)}`
      );
      url.searchParams.set('sendUpdates', 'all');
      await this.requestProviderJson(url.toString(), accessToken, {
        method: 'DELETE',
      });
      return { provider: 'google', remoteEventId };
    }

    if (account.provider === 'microsoft') {
      const url = `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(
        remoteCalendarId
      )}/events/${encodeURIComponent(remoteEventId)}`;
      await this.requestProviderJson(url, accessToken, {
        method: 'DELETE',
      });
      return { provider: 'microsoft', remoteEventId };
    }

    throw new Error(`Provider does not support calendar invite deletion: ${account.provider}`);
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
