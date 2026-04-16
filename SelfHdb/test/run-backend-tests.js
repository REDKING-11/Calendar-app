const assert = require('node:assert/strict');

const {
  buildSignedRequestPayload,
  decryptJson,
  encryptJson,
  signJwt,
  stableStringify,
  verifyJwt,
} = require('../src/lib/crypto');
const { MemoryRateLimiter } = require('../src/lib/rate-limit');

function testJsonCryptoRoundTrip() {
  const secret = Buffer.alloc(32, 5);
  const payload = {
    title: 'Hosted sync item',
    tags: ['a', 'b'],
  };
  const encrypted = encryptJson(payload, secret, 'test');
  const decrypted = decryptJson(encrypted, secret, 'test');
  assert.deepEqual(decrypted, payload);
}

function testStableStringify() {
  const left = stableStringify({ b: 2, a: 1, nested: { z: true, a: false } });
  const right = stableStringify({ nested: { a: false, z: true }, a: 1, b: 2 });
  assert.equal(left, right);
}

function testJwtRoundTrip() {
  const secret = Buffer.alloc(32, 9);
  const token = signJwt(
    {
      sub: 'user_1',
      device_id: 'device_1',
      session_id: 'sess_1',
      scopes: ['sync:read'],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
    },
    secret
  );
  const payload = verifyJwt(token, secret);
  assert.equal(payload.sub, 'user_1');
  assert.equal(payload.device_id, 'device_1');
}

function testRateLimiter() {
  const limiter = new MemoryRateLimiter();
  const first = limiter.consume('auth', '127.0.0.1', { max: 1, windowMs: 1000 });
  assert.equal(first.allowed, true);
  const second = limiter.consume('auth', '127.0.0.1', { max: 1, windowMs: 1000 });
  assert.equal(second.allowed, false);
}

function testSignedRequestPayload() {
  const payload = buildSignedRequestPayload({
    method: 'post',
    urlPath: '/v1/sync/push',
    timestamp: '2026-01-01T00:00:00.000Z',
    nonce: 'abc',
    body: { z: 1, a: 2 },
  });

  assert.equal(typeof payload, 'string');
  assert.equal(payload.includes('/v1/sync/push'), true);
}

function main() {
  const checks = [
    ['json_crypto_round_trip', testJsonCryptoRoundTrip],
    ['stable_stringify', testStableStringify],
    ['jwt_round_trip', testJwtRoundTrip],
    ['rate_limiter', testRateLimiter],
    ['signed_request_payload', testSignedRequestPayload],
  ];

  for (const [name, check] of checks) {
    check();
    console.log(`PASS ${name}`);
  }
}

main();
