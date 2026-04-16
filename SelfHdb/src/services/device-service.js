const { assert } = require('../lib/errors');
const { createId, hashSecret, randomToken } = require('../lib/crypto');

class DeviceService {
  constructor({ db, config, authService }) {
    this.db = db;
    this.config = config;
    this.authService = authService;
  }

  async listDevices(userId) {
    const result = await this.db.query(
      `SELECT
        id AS "deviceId",
        label,
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        last_seen_at AS "lastSeenAt",
        revoked_at AS "revokedAt"
       FROM trusted_devices
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [userId]
    );

    return result.rows;
  }

  async createPairingCode(userId, label = 'New device') {
    const pairingId = createId('pair');
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + this.config.pairingCodeTtlSeconds * 1000).toISOString();

    await this.db.query(
      `INSERT INTO pairing_requests (
        id,
        user_id,
        code_hash,
        label,
        status,
        created_at,
        expires_at
      ) VALUES ($1, $2, $3, $4, 'pending', NOW(), $5)`,
      [pairingId, userId, hashSecret(code), label, expiresAt]
    );

    return {
      pairingId,
      code,
      expiresAt,
    };
  }

  async approvePairing({ userId, sessionId, stepUpToken, pairingId, code, candidateDeviceId, candidateLabel, candidatePublicKey }) {
    assert(pairingId, 400, 'pairingId is required.', 'missing_pairing_id');
    assert(code, 400, 'code is required.', 'missing_pairing_code');
    assert(candidateDeviceId, 400, 'candidateDeviceId is required.', 'missing_candidate_device');
    assert(candidatePublicKey, 400, 'candidatePublicKey is required.', 'missing_candidate_key');

    await this.authService.consumeStepUpToken(userId, sessionId, stepUpToken);

    const result = await this.db.query(
      `SELECT
        id AS "pairingId",
        user_id AS "userId",
        code_hash AS "codeHash",
        status,
        expires_at AS "expiresAt"
       FROM pairing_requests
       WHERE id = $1`,
      [pairingId]
    );

    const pairing = result.rows[0];
    assert(pairing, 404, 'Pairing request not found.', 'pairing_not_found');
    assert(pairing.userId === userId, 403, 'Pairing request does not belong to this user.', 'forbidden');
    assert(pairing.status === 'pending', 409, 'Pairing request is no longer pending.', 'pairing_not_pending');
    assert(new Date(pairing.expiresAt).getTime() >= Date.now(), 410, 'Pairing request has expired.', 'pairing_expired');
    assert(pairing.codeHash === hashSecret(code), 400, 'Pairing code did not match.', 'pairing_code_invalid');

    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO trusted_devices (
          id,
          user_id,
          label,
          public_key,
          status,
          created_at,
          updated_at,
          last_seen_at
        ) VALUES ($1, $2, $3, $4, 'active', NOW(), NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET
          label = EXCLUDED.label,
          public_key = EXCLUDED.public_key,
          status = 'active',
          updated_at = NOW(),
          last_seen_at = NOW(),
          revoked_at = NULL`,
        [candidateDeviceId, userId, candidateLabel || 'Trusted device', candidatePublicKey]
      );

      const bootstrapToken = randomToken(48);
      const bootstrapExpiresAt = new Date(
        Date.now() + this.config.pairingBootstrapTtlSeconds * 1000
      ).toISOString();

      await client.query(
        `UPDATE pairing_requests
         SET status = 'approved',
             candidate_device_id = $2,
             candidate_label = $3,
             candidate_public_key = $4,
             bootstrap_token_hash = $5,
             approved_at = NOW(),
             expires_at = $6
         WHERE id = $1`,
        [
          pairingId,
          candidateDeviceId,
          candidateLabel || 'Trusted device',
          candidatePublicKey,
          hashSecret(bootstrapToken),
          bootstrapExpiresAt,
        ]
      );

      await this.authService.audit(client, {
        userId,
        actorDeviceId: candidateDeviceId,
        action: 'pairing_approved',
        targetType: 'device',
        targetId: candidateDeviceId,
        details: {
          pairingId,
        },
      });

      await client.query('COMMIT');

      return {
        pairingId,
        candidateDeviceId,
        bootstrapToken,
        bootstrapExpiresAt,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async consumePairingBootstrap({ pairingId, bootstrapToken }) {
    const result = await this.db.query(
      `SELECT
        id AS "pairingId",
        user_id AS "userId",
        candidate_device_id AS "candidateDeviceId",
        status,
        bootstrap_token_hash AS "bootstrapTokenHash",
        expires_at AS "expiresAt"
       FROM pairing_requests
       WHERE id = $1`,
      [pairingId]
    );

    const pairing = result.rows[0];
    assert(pairing, 404, 'Pairing request not found.', 'pairing_not_found');
    assert(pairing.status === 'approved', 409, 'Pairing request is not approved.', 'pairing_not_approved');
    assert(new Date(pairing.expiresAt).getTime() >= Date.now(), 410, 'Bootstrap token has expired.', 'bootstrap_expired');
    assert(pairing.bootstrapTokenHash === hashSecret(bootstrapToken), 400, 'Bootstrap token did not match.', 'bootstrap_invalid');

    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const session = await this.authService.createSession(client, {
        userId: pairing.userId,
        deviceId: pairing.candidateDeviceId,
        scopes: ['sync:read', 'sync:write', 'devices:manage', 'sessions:manage', 'providers:manage'],
      });

      await client.query(
        `UPDATE pairing_requests
         SET status = 'consumed',
             bootstrap_token_hash = NULL,
             expires_at = NOW()
         WHERE id = $1`,
        [pairingId]
      );

      await client.query('COMMIT');
      return session;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeDevice(userId, deviceId) {
    assert(deviceId, 400, 'deviceId is required.', 'missing_device_id');

    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const updatedDevice = await client.query(
        `UPDATE trusted_devices
         SET status = 'revoked',
             revoked_at = NOW(),
             updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING id AS "deviceId"`,
        [deviceId, userId]
      );

      assert(updatedDevice.rowCount === 1, 404, 'Device not found.', 'device_not_found');

      await client.query(
        `UPDATE device_sessions
         SET status = 'revoked',
             revoked_at = NOW(),
             updated_at = NOW()
         WHERE device_id = $1 AND user_id = $2`,
        [deviceId, userId]
      );

      await this.authService.audit(client, {
        userId,
        actorDeviceId: deviceId,
        action: 'device_revoked',
        targetType: 'device',
        targetId: deviceId,
      });

      await client.query('COMMIT');
      return updatedDevice.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

module.exports = { DeviceService };
