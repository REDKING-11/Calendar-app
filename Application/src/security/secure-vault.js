const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VAULT_VERSION = 1;

function nowIso() {
  return new Date().toISOString();
}

class SecureVault {
  constructor(baseDir, safeStorage) {
    this.baseDir = baseDir;
    this.safeStorage = safeStorage;
    this.vaultPath = path.join(baseDir, 'security-vault.json');
    this.cachedRecord = null;
    this.cachedMasterKey = null;
  }

  isPlatformProtectionAvailable() {
    return Boolean(this.safeStorage?.isEncryptionAvailable?.());
  }

  loadRecord() {
    if (this.cachedRecord) {
      return this.cachedRecord;
    }

    if (!fs.existsSync(this.vaultPath)) {
      return null;
    }

    const raw = fs.readFileSync(this.vaultPath, 'utf8');
    const record = JSON.parse(raw);
    this.cachedRecord = record;
    return record;
  }

  saveRecord(record) {
    fs.mkdirSync(path.dirname(this.vaultPath), { recursive: true });
    fs.writeFileSync(this.vaultPath, JSON.stringify(record, null, 2));
    this.cachedRecord = record;
  }

  protectString(value) {
    if (this.isPlatformProtectionAvailable()) {
      return {
        mode: 'safeStorage',
        value: this.safeStorage.encryptString(value).toString('base64'),
      };
    }

    return {
      mode: 'plaintext_fallback',
      value: Buffer.from(value, 'utf8').toString('base64'),
    };
  }

  unprotectString(entry) {
    if (!entry?.value) {
      return '';
    }

    const buffer = Buffer.from(entry.value, 'base64');

    if (entry.mode === 'safeStorage') {
      if (!this.isPlatformProtectionAvailable()) {
        throw new Error('Platform encryption is not available to unwrap protected secrets.');
      }

      return this.safeStorage.decryptString(buffer);
    }

    return buffer.toString('utf8');
  }

  ensureMasterKey() {
    if (this.cachedMasterKey) {
      return {
        key: this.cachedMasterKey,
        created: false,
        rotatedAt: this.loadRecord()?.rotatedAt || null,
        protectionMode: this.loadRecord()?.masterKey?.mode || 'unknown',
      };
    }

    const existingRecord = this.loadRecord();
    if (existingRecord?.masterKey?.value) {
      this.cachedMasterKey = Buffer.from(
        this.unprotectString(existingRecord.masterKey),
        'base64'
      );

      return {
        key: this.cachedMasterKey,
        created: false,
        rotatedAt: existingRecord.rotatedAt || null,
        protectionMode: existingRecord.masterKey.mode,
      };
    }

    const nextKey = crypto.randomBytes(32);
    const createdAt = nowIso();
    const record = {
      version: VAULT_VERSION,
      createdAt,
      rotatedAt: createdAt,
      masterKey: this.protectString(nextKey.toString('base64')),
      secrets: {},
    };

    this.saveRecord(record);
    this.cachedMasterKey = nextKey;

    return {
      key: nextKey,
      created: true,
      rotatedAt: createdAt,
      protectionMode: record.masterKey.mode,
    };
  }

  setSecret(name, value) {
    if (!this.loadRecord()) {
      this.ensureMasterKey();
    }

    const record = this.loadRecord() || {
      version: VAULT_VERSION,
      createdAt: nowIso(),
      rotatedAt: nowIso(),
      masterKey: this.protectString(crypto.randomBytes(32).toString('base64')),
      secrets: {},
    };

    record.secrets = {
      ...(record.secrets || {}),
      [name]: this.protectString(value),
    };

    this.saveRecord(record);
  }

  getSecret(name) {
    const record = this.loadRecord();
    if (!record?.secrets?.[name]) {
      return null;
    }

    return this.unprotectString(record.secrets[name]);
  }

  deleteSecret(name) {
    const record = this.loadRecord();
    if (!record?.secrets?.[name]) {
      return;
    }

    const nextSecrets = { ...(record.secrets || {}) };
    delete nextSecrets[name];
    record.secrets = nextSecrets;
    this.saveRecord(record);
  }

  rotateMasterKey(nextKey) {
    const record = this.loadRecord();
    if (!record) {
      throw new Error('Vault must exist before rotating its master key.');
    }

    record.masterKey = this.protectString(nextKey.toString('base64'));
    record.rotatedAt = nowIso();
    this.saveRecord(record);
    this.cachedMasterKey = nextKey;

    return {
      key: nextKey,
      rotatedAt: record.rotatedAt,
      protectionMode: record.masterKey.mode,
    };
  }

  getStatus() {
    const record = this.loadRecord();
    const protectionMode = record?.masterKey?.mode || 'missing';

    return {
      exists: Boolean(record),
      protectionMode,
      platformProtectionAvailable: this.isPlatformProtectionAvailable(),
      createdAt: record?.createdAt || null,
      rotatedAt: record?.rotatedAt || null,
      hasSecrets: Object.keys(record?.secrets || {}).length > 0,
      degradedProtection: protectionMode !== 'safeStorage',
    };
  }
}

module.exports = { SecureVault };
