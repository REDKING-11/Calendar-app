const crypto = require('node:crypto');

const CIPHER_VERSION = 1;
const IV_LENGTH = 12;

function toBase64Url(input) {
  return Buffer.from(input).toString('base64url');
}

class CryptoService {
  constructor(masterKey) {
    this.masterKey = Buffer.from(masterKey);
  }

  encryptJson(value, context) {
    return this.encryptText(JSON.stringify(value), context);
  }

  decryptJson(payload, context) {
    return JSON.parse(this.decryptText(payload, context));
  }

  encryptText(value, context = 'calendar-app') {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));

    const encrypted = Buffer.concat([
      cipher.update(String(value), 'utf8'),
      cipher.final(),
    ]);

    return JSON.stringify({
      v: CIPHER_VERSION,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: encrypted.toString('base64'),
    });
  }

  decryptText(payload, context = 'calendar-app') {
    const envelope = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (envelope?.v !== CIPHER_VERSION) {
      throw new Error(`Unsupported cipher payload version: ${envelope?.v}`);
    }

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.masterKey,
      Buffer.from(envelope.iv, 'base64')
    );

    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  hashString(value) {
    return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
  }

  randomToken(byteLength = 32) {
    return crypto.randomBytes(byteLength).toString('base64url');
  }

  pkceChallenge(verifier) {
    return crypto.createHash('sha256').update(verifier, 'utf8').digest('base64url');
  }

  codeHash(code) {
    return crypto.createHash('sha256').update(code, 'utf8').digest('hex');
  }

  base64UrlJson(payload) {
    return toBase64Url(JSON.stringify(payload));
  }
}

module.exports = {
  CIPHER_VERSION,
  CryptoService,
};
