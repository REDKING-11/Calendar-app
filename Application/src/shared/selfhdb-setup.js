const SELF_HDB_ENV_FIELD_DEFINITIONS = [
  {
    key: 'APP_ENV',
    label: 'App environment',
    defaultValue: 'production',
  },
  {
    key: 'APP_DEBUG',
    label: 'Debug mode',
    defaultValue: 'false',
  },
  {
    key: 'APP_URL',
    label: 'Public backend URL',
    defaultValue: '',
  },
  {
    key: 'APP_TIMEZONE',
    label: 'Server timezone',
    defaultValue: 'UTC',
  },
  {
    key: 'APP_FORCE_HTTPS',
    label: 'Force HTTPS',
    defaultValue: 'true',
  },
  {
    key: 'DB_HOST',
    label: 'Database host',
    defaultValue: '127.0.0.1',
  },
  {
    key: 'DB_PORT',
    label: 'Database port',
    defaultValue: '3306',
  },
  {
    key: 'DB_NAME',
    label: 'Database name',
    defaultValue: 'selfhdb',
  },
  {
    key: 'DB_USER',
    label: 'Database user',
    defaultValue: 'selfhdb_user',
  },
  {
    key: 'DB_PASSWORD',
    label: 'Database password',
    defaultValue: 'change-me',
  },
  {
    key: 'DB_CHARSET',
    label: 'Database charset',
    defaultValue: 'utf8mb4',
  },
  {
    key: 'ACCESS_TOKEN_SECRET',
    label: 'Access token secret',
    defaultValue: '',
  },
  {
    key: 'ACCESS_TOKEN_TTL_SECONDS',
    label: 'Access token lifetime',
    defaultValue: '900',
  },
  {
    key: 'REFRESH_TOKEN_TTL_SECONDS',
    label: 'Refresh token lifetime',
    defaultValue: '2592000',
  },
  {
    key: 'RATE_LIMIT_AUTH_PER_MINUTE',
    label: 'Auth rate limit',
    defaultValue: '5',
  },
  {
    key: 'RATE_LIMIT_REFRESH_PER_15_MIN',
    label: 'Refresh rate limit',
    defaultValue: '20',
  },
  {
    key: 'RATE_LIMIT_SYNC_PUSH_PER_MINUTE',
    label: 'Sync push rate limit',
    defaultValue: '100',
  },
  {
    key: 'RATE_LIMIT_SYNC_PULL_PER_MINUTE',
    label: 'Sync pull rate limit',
    defaultValue: '120',
  },
  {
    key: 'SYNC_PULL_LIMIT',
    label: 'Sync pull limit',
    defaultValue: '200',
  },
  {
    key: 'MAX_JSON_BODY_BYTES',
    label: 'Max JSON body size',
    defaultValue: '262144',
  },
];

function randomSecret(length = 48) {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const bytes = new Uint8Array(length);

  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function createDefaultSelfHdbEnvValues(baseUrl = '') {
  const values = {};

  for (const field of SELF_HDB_ENV_FIELD_DEFINITIONS) {
    values[field.key] = field.defaultValue;
  }

  values.APP_URL = normalizeBaseUrl(baseUrl);
  values.ACCESS_TOKEN_SECRET = randomSecret(48);

  return values;
}

function buildSelfHdbEnv(values = {}) {
  const resolved = {
    ...createDefaultSelfHdbEnvValues(values.APP_URL),
    ...values,
  };

  return SELF_HDB_ENV_FIELD_DEFINITIONS.map((field) => {
    const value = resolved[field.key] ?? field.defaultValue ?? '';
    return `${field.key}=${String(value).trim()}`;
  }).join('\n');
}

module.exports = {
  SELF_HDB_ENV_FIELD_DEFINITIONS,
  createDefaultSelfHdbEnvValues,
  buildSelfHdbEnv,
};
