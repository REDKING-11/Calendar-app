const fs = require('node:fs');
const path = require('node:path');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseBase64Secret(name, fallback = null) {
  const value = process.env[name];
  if (!value) {
    if (fallback !== null) {
      return fallback;
    }
    throw new Error(`Missing required environment variable ${name}.`);
  }

  const buffer = Buffer.from(value, 'base64');
  if (buffer.length < 32) {
    throw new Error(`${name} must decode to at least 32 bytes.`);
  }

  return buffer;
}

function parseOrigins(value = '') {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function createConfig() {
  const envPath = path.join(process.cwd(), '.env');
  loadEnvFile(envPath);

  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    host: process.env.HOST || '0.0.0.0',
    port: parseInteger(process.env.PORT, 4318),
    publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:4318',
    allowInsecureHttp: parseBoolean(process.env.ALLOW_INSECURE_HTTP, false),
    corsAllowedOrigins: parseOrigins(process.env.CORS_ALLOWED_ORIGINS),
    postgresUrl: process.env.POSTGRES_URL,
    accessTokenTtlSeconds: parseInteger(process.env.ACCESS_TOKEN_TTL_SECONDS, 900),
    refreshSessionTtlSeconds: parseInteger(process.env.REFRESH_SESSION_TTL_SECONDS, 60 * 60 * 24 * 30),
    authFlowTtlSeconds: parseInteger(process.env.AUTH_FLOW_TTL_SECONDS, 600),
    pairingCodeTtlSeconds: parseInteger(process.env.PAIRING_CODE_TTL_SECONDS, 600),
    pairingBootstrapTtlSeconds: parseInteger(process.env.PAIRING_BOOTSTRAP_TTL_SECONDS, 600),
    stepUpTtlSeconds: parseInteger(process.env.STEP_UP_TTL_SECONDS, 300),
    requestSkewSeconds: parseInteger(process.env.REQUEST_SKEW_SECONDS, 300),
    syncPullLimit: parseInteger(process.env.SYNC_PULL_LIMIT, 250),
    backendMasterKey: parseBase64Secret('BACKEND_MASTER_KEY_BASE64', Buffer.alloc(32, 7)),
    accessTokenSecret: parseBase64Secret('ACCESS_TOKEN_SECRET_BASE64', Buffer.alloc(32, 13)),
    requestSigningSecret: parseBase64Secret('REQUEST_SIGNING_SECRET_BASE64', Buffer.alloc(32, 19)),
    providers: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        redirectUri:
          process.env.GOOGLE_REDIRECT_URI || `${process.env.PUBLIC_BASE_URL || 'http://localhost:4318'}/v1/auth/google/callback`,
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        revokeUrl: 'https://oauth2.googleapis.com/revoke',
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
      },
      microsoft: {
        clientId: process.env.MICROSOFT_CLIENT_ID || '',
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
        redirectUri:
          process.env.MICROSOFT_REDIRECT_URI || `${process.env.PUBLIC_BASE_URL || 'http://localhost:4318'}/v1/auth/microsoft/callback`,
        authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        revokeUrl: null,
        readScopes: ['openid', 'profile', 'email', 'offline_access', 'Calendars.Read'],
        writeScopes: ['Calendars.ReadWrite'],
        extraParams: {},
      },
    },
  };
}

module.exports = { createConfig };
