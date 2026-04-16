const crypto = require('node:crypto');
const os = require('node:os');

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function hashApprovalCode(code) {
  return crypto.createHash('sha256').update(code, 'utf8').digest('hex');
}

class TrustedDeviceService {
  constructor({ db, vault, onAudit }) {
    this.db = db;
    this.vault = vault;
    this.onAudit = onAudit;
    this.privateKeySecretName = 'local-device-private-key';
  }

  ensureLocalDevice(preferredDeviceId) {
    const existingLocal = this.db
      .prepare(
        `SELECT device_id AS deviceId, label, public_key AS publicKey, status, trust_level AS trustLevel
         FROM trusted_devices
         WHERE is_local = 1
         LIMIT 1`
      )
      .get();

    if (existingLocal) {
      if (!this.vault.getSecret(this.privateKeySecretName)) {
        const pair = crypto.generateKeyPairSync('ed25519');
        this.vault.setSecret(
          this.privateKeySecretName,
          pair.privateKey.export({ type: 'pkcs8', format: 'pem' })
        );

        this.db
          .prepare(
            `UPDATE trusted_devices
             SET public_key = :publicKey, updated_at = :updatedAt
             WHERE device_id = :deviceId`
          )
          .run({
            publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }),
            updatedAt: nowIso(),
            deviceId: existingLocal.deviceId,
          });
      }

      this.touch(existingLocal.deviceId);
      return existingLocal;
    }

    const pair = crypto.generateKeyPairSync('ed25519');
    const deviceId = preferredDeviceId || createId('device');
    const timestamp = nowIso();

    this.vault.setSecret(
      this.privateKeySecretName,
      pair.privateKey.export({ type: 'pkcs8', format: 'pem' })
    );

    this.db
      .prepare(
        `INSERT INTO trusted_devices (
          device_id,
          label,
          public_key,
          status,
          is_local,
          trust_level,
          created_at,
          updated_at,
          last_seen_at
        ) VALUES (
          :deviceId,
          :label,
          :publicKey,
          'active',
          1,
          'full',
          :createdAt,
          :updatedAt,
          :lastSeenAt
        )`
      )
      .run({
        deviceId,
        label: `${os.hostname()} (${process.platform})`,
        publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }),
        createdAt: timestamp,
        updatedAt: timestamp,
        lastSeenAt: timestamp,
      });

    this.onAudit?.('device_registered', {
      targetType: 'device',
      targetId: deviceId,
      details: { isLocal: true },
    });

    return {
      deviceId,
      label: `${os.hostname()} (${process.platform})`,
      publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }),
      status: 'active',
      trustLevel: 'full',
    };
  }

  getLocalPrivateKey() {
    const privateKeyPem = this.vault.getSecret(this.privateKeySecretName);
    if (!privateKeyPem) {
      throw new Error('Local device private key is missing.');
    }

    return crypto.createPrivateKey(privateKeyPem);
  }

  signPayload(payload) {
    const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
    return crypto.sign(null, payloadBuffer, this.getLocalPrivateKey()).toString('base64');
  }

  touch(deviceId) {
    this.db
      .prepare(
        `UPDATE trusted_devices
         SET last_seen_at = :lastSeenAt, updated_at = :updatedAt
         WHERE device_id = :deviceId`
      )
      .run({
        deviceId,
        lastSeenAt: nowIso(),
        updatedAt: nowIso(),
      });
  }

  listTrustedDevices() {
    return this.db
      .prepare(
        `SELECT
          device_id AS deviceId,
          label,
          status,
          is_local AS isLocal,
          trust_level AS trustLevel,
          created_at AS createdAt,
          updated_at AS updatedAt,
          last_seen_at AS lastSeenAt,
          revoked_at AS revokedAt
         FROM trusted_devices
         ORDER BY is_local DESC, created_at ASC`
      )
      .all()
      .map((row) => ({
        ...row,
        isLocal: Boolean(row.isLocal),
      }));
  }

  getLocalDeviceProfile() {
    const device = this.db
      .prepare(
        `SELECT
          device_id AS deviceId,
          label,
          public_key AS publicKey,
          status,
          trust_level AS trustLevel
         FROM trusted_devices
         WHERE is_local = 1
         LIMIT 1`
      )
      .get();

    if (!device) {
      throw new Error('The local trusted device is not initialized.');
    }

    return device;
  }

  createPairingApproval(label) {
    const approvalId = createId('pair');
    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const timestamp = nowIso();

    this.db
      .prepare(
        `INSERT INTO pairing_approvals (
          approval_id,
          code_hash,
          label,
          status,
          expires_at,
          created_at
        ) VALUES (
          :approvalId,
          :codeHash,
          :label,
          'pending',
          :expiresAt,
          :createdAt
        )`
      )
      .run({
        approvalId,
        codeHash: hashApprovalCode(code),
        label: label || 'New device',
        expiresAt,
        createdAt: timestamp,
      });

    this.onAudit?.('pairing_requested', {
      targetType: 'pairing',
      targetId: approvalId,
      details: {
        label: label || 'New device',
        expiresAt,
      },
    });

    return {
      approvalId,
      code,
      expiresAt,
    };
  }

  approvePairing({ approvalId, code, candidateDeviceId, label, publicKey }) {
    const approval = this.db
      .prepare(
        `SELECT
          approval_id AS approvalId,
          code_hash AS codeHash,
          status,
          expires_at AS expiresAt
         FROM pairing_approvals
         WHERE approval_id = :approvalId`
      )
      .get({ approvalId });

    if (!approval) {
      throw new Error('Pairing approval not found.');
    }

    if (approval.status !== 'pending') {
      throw new Error('Pairing approval is no longer pending.');
    }

    if (new Date(approval.expiresAt).getTime() < Date.now()) {
      throw new Error('Pairing approval has expired.');
    }

    if (hashApprovalCode(String(code)) !== approval.codeHash) {
      throw new Error('Pairing code did not match.');
    }

    const deviceId = candidateDeviceId || createId('device');
    const timestamp = nowIso();

    this.db
      .prepare(
        `INSERT OR REPLACE INTO trusted_devices (
          device_id,
          label,
          public_key,
          status,
          is_local,
          trust_level,
          created_at,
          updated_at,
          last_seen_at
        ) VALUES (
          :deviceId,
          :label,
          :publicKey,
          'active',
          0,
          'full',
          :createdAt,
          :updatedAt,
          :lastSeenAt
        )`
      )
      .run({
        deviceId,
        label: label || 'Trusted device',
        publicKey,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastSeenAt: timestamp,
      });

    this.db
      .prepare(
        `UPDATE pairing_approvals
         SET candidate_device_id = :candidateDeviceId,
             public_key = :publicKey,
             approved_by = :approvedBy,
             status = 'approved',
             approved_at = :approvedAt
         WHERE approval_id = :approvalId`
      )
      .run({
        approvalId,
        candidateDeviceId: deviceId,
        publicKey,
        approvedBy: this.listTrustedDevices().find((device) => device.isLocal)?.deviceId || null,
        approvedAt: timestamp,
      });

    this.onAudit?.('pairing_approved', {
      targetType: 'device',
      targetId: deviceId,
      details: { approvalId },
    });

    return {
      approvalId,
      deviceId,
      label: label || 'Trusted device',
      status: 'active',
    };
  }

  revokeDevice(deviceId) {
    const device = this.db
      .prepare(
        `SELECT device_id AS deviceId, is_local AS isLocal, status
         FROM trusted_devices
         WHERE device_id = :deviceId`
      )
      .get({ deviceId });

    if (!device) {
      throw new Error('Trusted device not found.');
    }

    if (device.isLocal) {
      throw new Error('The local device cannot revoke itself.');
    }

    this.db
      .prepare(
        `UPDATE trusted_devices
         SET status = 'revoked', revoked_at = :revokedAt, updated_at = :updatedAt
         WHERE device_id = :deviceId`
      )
      .run({
        deviceId,
        revokedAt: nowIso(),
        updatedAt: nowIso(),
      });

    this.onAudit?.('device_revoked', {
      targetType: 'device',
      targetId: deviceId,
    });

    return {
      deviceId,
      status: 'revoked',
    };
  }
}

module.exports = { TrustedDeviceService };
