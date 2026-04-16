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

function hashSecret(secret) {
  return sha256(Buffer.isBuffer(secret) ? secret : Buffer.from(String(secret), 'utf8'));
}

function pkceChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier, 'utf8').digest('base64url');
}

function encodeBase64Url(input) {
  return Buffer.from(input).toString('base64url');
}

function decodeBase64Url(input) {
  return Buffer.from(input, 'base64url');
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

function encryptJson(value, secret, context = 'selfhdb') {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secret, iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);

  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
  });
}

function decryptJson(payload, secret, context = 'selfhdb') {
  const envelope = typeof payload === 'string' ? JSON.parse(payload) : payload;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    secret,
    Buffer.from(envelope.iv, 'base64')
  );

  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString('utf8'));
}

function signJwt(payload, secret) {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  };

  const encodedHeader = encodeBase64Url(JSON.stringify(header));
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyJwt(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format.');
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  const actualBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error('Invalid token signature.');
  }

  const payload = JSON.parse(decodeBase64Url(encodedPayload).toString('utf8'));
  if (payload.exp && Math.floor(Date.now() / 1000) >= payload.exp) {
    throw new Error('Token has expired.');
  }

  return payload;
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

function signHmacRequest({ method, urlPath, timestamp, nonce, body, secret }) {
  const payload = buildSignedRequestPayload({ method, urlPath, timestamp, nonce, body });
  return crypto.createHmac('sha256', secret).update(payload).digest('base64');
}

function verifyHmacRequest({ method, urlPath, timestamp, nonce, body, secret, signature }) {
  const expected = signHmacRequest({ method, urlPath, timestamp, nonce, body, secret });
  const actualBuffer = Buffer.from(String(signature || ''), 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error('Request signature did not match.');
  }

  return true;
}

function verifyDetachedSignature({ payload, signature, publicKey }) {
  const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  return crypto.verify(
    null,
    payloadBuffer,
    crypto.createPublicKey(publicKey),
    Buffer.from(signature, 'base64')
  );
}

function assertFreshTimestamp(timestamp, skewSeconds) {
  const candidate = new Date(timestamp);
  if (Number.isNaN(candidate.getTime())) {
    throw new Error('Invalid timestamp.');
  }

  const deltaMs = Math.abs(Date.now() - candidate.getTime());
  if (deltaMs > skewSeconds * 1000) {
    throw new Error('Timestamp outside the allowed clock skew.');
  }

  return candidate.toISOString();
}

module.exports = {
  assertFreshTimestamp,
  buildSignedRequestPayload,
  createId,
  decryptJson,
  encryptJson,
  hashSecret,
  nowIso,
  pkceChallenge,
  randomToken,
  sha256,
  signHmacRequest,
  signJwt,
  stableStringify,
  verifyDetachedSignature,
  verifyHmacRequest,
  verifyJwt,
};
