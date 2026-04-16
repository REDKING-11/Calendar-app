const {
  assert,
} = require('../lib/errors');
const {
  assertFreshTimestamp,
  buildSignedRequestPayload,
  createId,
  encryptJson,
  hashSecret,
  verifyDetachedSignature,
} = require('../lib/crypto');

class SyncService {
  constructor({ db, config }) {
    this.db = db;
    this.config = config;
  }

  async getDefaultCalendar(userId) {
    const result = await this.db.query(
      `SELECT id, owner_user_id AS "ownerUserId"
       FROM calendars
       WHERE owner_user_id = $1
       ORDER BY created_at ASC
       LIMIT 1`,
      [userId]
    );

    assert(result.rowCount === 1, 404, 'No calendar found for this user.', 'calendar_not_found');
    return result.rows[0];
  }

  async assertCalendarRole(userId, calendarId, allowedRoles = ['owner']) {
    const result = await this.db.query(
      `SELECT role
       FROM calendar_members
       WHERE calendar_id = $1 AND user_id = $2 AND status = 'active'
       LIMIT 1`,
      [calendarId, userId]
    );

    const membership = result.rows[0];
    assert(membership, 403, 'Calendar access denied.', 'calendar_forbidden');
    assert(
      allowedRoles.includes(membership.role),
      403,
      'Calendar role does not allow this action.',
      'calendar_role_forbidden'
    );

    return membership.role;
  }

  async getDevicePublicKey(userId, deviceId) {
    const result = await this.db.query(
      `SELECT public_key AS "publicKey", status
       FROM trusted_devices
       WHERE id = $1 AND user_id = $2
       LIMIT 1`,
      [deviceId, userId]
    );

    const device = result.rows[0];
    assert(device, 404, 'Trusted device not found.', 'device_not_found');
    assert(device.status === 'active', 401, 'Trusted device is not active.', 'device_inactive');
    return device.publicKey;
  }

  async rememberRequestNonce(actorType, actorId, nonce, signatureHash) {
    await this.db.query(
      `DELETE FROM nonce_replay_cache
       WHERE expires_at < NOW()`
    );

    const expiresAt = new Date(Date.now() + this.config.requestSkewSeconds * 2000).toISOString();
    try {
      await this.db.query(
        `INSERT INTO nonce_replay_cache (
          id,
          actor_type,
          actor_id,
          nonce,
          signature_hash,
          created_at,
          expires_at
        ) VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
        [createId('nonce'), actorType, actorId, nonce, signatureHash, expiresAt]
      );
    } catch (error) {
      if (String(error.message).includes('duplicate key')) {
        throw new Error('Request nonce was already used.');
      }

      throw error;
    }
  }

  async verifySignedPushRequest({ request, auth }) {
    const deviceId = request.headers['x-device-id'];
    const timestamp = request.headers['x-request-timestamp'];
    const nonce = request.headers['x-request-nonce'];
    const signature = request.headers['x-request-signature'];

    assert(deviceId, 400, 'Missing X-Device-Id header.', 'missing_device_header');
    assert(timestamp, 400, 'Missing X-Request-Timestamp header.', 'missing_timestamp_header');
    assert(nonce, 400, 'Missing X-Request-Nonce header.', 'missing_nonce_header');
    assert(signature, 400, 'Missing X-Request-Signature header.', 'missing_signature_header');
    assert(deviceId === auth.deviceId, 401, 'Device header does not match the session.', 'device_binding_mismatch');

    assertFreshTimestamp(timestamp, this.config.requestSkewSeconds);

    const publicKey = await this.getDevicePublicKey(auth.userId, deviceId);
    const payload = buildSignedRequestPayload({
      method: request.method,
      urlPath: request.routerPath || request.url,
      timestamp,
      nonce,
      body: request.body,
    });

    const verified = verifyDetachedSignature({
      payload,
      signature,
      publicKey,
    });
    assert(verified, 401, 'Sync request signature is invalid.', 'invalid_request_signature');

    await this.rememberRequestNonce('device', deviceId, nonce, hashSecret(signature));
  }

  buildEnvelopePayload(envelope) {
    return JSON.stringify({
      deviceId: envelope.deviceId,
      deviceSequence: envelope.deviceSequence,
      entity: envelope.entity,
      entityId: envelope.entityId,
      operation: envelope.operation,
      contentPatch: envelope.contentPatch || null,
      encryptedPatch: envelope.encryptedPatch || null,
      metadataPatch: envelope.metadataPatch,
      nonce: envelope.nonce,
      clientTimestamp: envelope.clientTimestamp,
    });
  }

  async materializeEvent(client, { userId, calendarId, deviceId, envelope, storedCipherText }) {
    const metadataPatch = envelope.metadataPatch || {};
    const deleted = Boolean(metadataPatch.deleted || envelope.operation === 'delete');
    const startsAt = metadataPatch.startsAt || metadataPatch.starts_at;
    const endsAt = metadataPatch.endsAt || metadataPatch.ends_at;
    const visibility = metadataPatch.visibility || 'private';
    const syncPolicy = metadataPatch.syncPolicy || metadataPatch.sync_policy || 'internal_only';

    if (!deleted) {
      assert(startsAt, 400, 'metadataPatch.startsAt is required.', 'missing_starts_at');
      assert(endsAt, 400, 'metadataPatch.endsAt is required.', 'missing_ends_at');
    }

    const existing = await client.query(
      `SELECT id, version
       FROM events_metadata
       WHERE id = $1
       LIMIT 1`,
      [envelope.entityId]
    );

    if (existing.rowCount === 0) {
      await client.query(
        `INSERT INTO events_metadata (
          id,
          calendar_id,
          owner_user_id,
          starts_at,
          ends_at,
          visibility,
          sync_policy,
          deleted,
          version,
          content_cipher_version,
          updated_at,
          updated_by_device_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, 1, NOW(), $9)`,
        [
          envelope.entityId,
          calendarId,
          userId,
          startsAt || new Date().toISOString(),
          endsAt || new Date().toISOString(),
          visibility,
          syncPolicy,
          deleted,
          deviceId,
        ]
      );
    } else {
      await client.query(
        `UPDATE events_metadata
         SET starts_at = $2,
             ends_at = $3,
             visibility = $4,
             sync_policy = $5,
             deleted = $6,
             version = version + 1,
             updated_at = NOW(),
             updated_by_device_id = $7
         WHERE id = $1`,
        [
          envelope.entityId,
          startsAt || new Date().toISOString(),
          endsAt || new Date().toISOString(),
          visibility,
          syncPolicy,
          deleted,
          deviceId,
        ]
      );
    }

    if (!deleted && storedCipherText) {
      await client.query(
        `INSERT INTO event_content_blobs (
          event_id,
          cipher_text,
          key_version,
          content_hash,
          updated_at
        ) VALUES ($1, $2, 1, $3, NOW())
        ON CONFLICT (event_id) DO UPDATE SET
          cipher_text = EXCLUDED.cipher_text,
          key_version = EXCLUDED.key_version,
          content_hash = EXCLUDED.content_hash,
          updated_at = NOW()`,
        [envelope.entityId, storedCipherText, hashSecret(storedCipherText)]
      );
    }
  }

  async pushEnvelopes({ auth, request, body }) {
    assert(Array.isArray(body?.envelopes), 400, 'envelopes must be an array.', 'invalid_envelopes');
    assert(body.envelopes.length > 0, 400, 'At least one envelope is required.', 'empty_envelopes');

    await this.verifySignedPushRequest({ request, auth });

    const defaultCalendar = await this.getDefaultCalendar(auth.userId);
    const calendarId = body.calendarId || defaultCalendar.id;
    await this.assertCalendarRole(auth.userId, calendarId, ['owner', 'edit']);

    const publicKey = await this.getDevicePublicKey(auth.userId, auth.deviceId);
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const accepted = [];
      const duplicates = [];

      for (const envelope of body.envelopes) {
        assert(envelope.deviceId === auth.deviceId, 401, 'Envelope device mismatch.', 'device_mismatch');
        assert(Number.isInteger(envelope.deviceSequence), 400, 'deviceSequence must be an integer.', 'invalid_device_sequence');
        assert(envelope.entityId, 400, 'entityId is required.', 'missing_entity_id');
        assert(envelope.entity, 400, 'entity is required.', 'missing_entity');
        assert(envelope.operation, 400, 'operation is required.', 'missing_operation');
        assert(envelope.clientTimestamp, 400, 'clientTimestamp is required.', 'missing_client_timestamp');
        assert(envelope.nonce, 400, 'nonce is required.', 'missing_nonce');
        assert(envelope.signature, 400, 'signature is required.', 'missing_signature');
        assertFreshTimestamp(envelope.clientTimestamp, this.config.requestSkewSeconds);

        const signatureValid = verifyDetachedSignature({
          payload: this.buildEnvelopePayload(envelope),
          signature: envelope.signature,
          publicKey,
        });
        assert(signatureValid, 401, 'Envelope signature is invalid.', 'invalid_envelope_signature');

        const existing = await client.query(
          `SELECT id, server_sequence AS "serverSequence"
           FROM change_envelopes
           WHERE device_id = $1 AND device_sequence = $2
           LIMIT 1`,
          [auth.deviceId, envelope.deviceSequence]
        );

        if (existing.rowCount === 1) {
          duplicates.push({
            envelopeId: existing.rows[0].id,
            serverSequence: Number(existing.rows[0].serverSequence),
            deviceSequence: envelope.deviceSequence,
          });
          continue;
        }

        const envelopeId = createId('env');
        const storedCipherText =
          envelope.contentPatch || envelope.encryptedPatch
            ? encryptJson(
                {
                  contentPatch: envelope.contentPatch || null,
                  encryptedPatch: envelope.encryptedPatch || null,
                },
                this.config.backendMasterKey,
                `change-envelope:${envelopeId}`
              )
            : null;

        const inserted = await client.query(
          `INSERT INTO change_envelopes (
            id,
            user_id,
            calendar_id,
            device_id,
            device_sequence,
            entity,
            entity_id,
            operation,
            payload_cipher_text,
            metadata_patch,
            nonce,
            client_timestamp,
            signature,
            signature_key_id,
            created_at
          ) VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10::jsonb,
            $11,
            $12,
            $13,
            $14,
            NOW()
          )
          RETURNING server_sequence AS "serverSequence"`,
          [
            envelopeId,
            auth.userId,
            calendarId,
            auth.deviceId,
            envelope.deviceSequence,
            envelope.entity,
            envelope.entityId,
            envelope.operation,
            storedCipherText,
            JSON.stringify(envelope.metadataPatch || {}),
            envelope.nonce,
            envelope.clientTimestamp,
            envelope.signature,
            envelope.signatureKeyId || auth.deviceId,
          ]
        );

        if (envelope.entity === 'event') {
          await this.materializeEvent(client, {
            userId: auth.userId,
            calendarId,
            deviceId: auth.deviceId,
            envelope,
            storedCipherText,
          });
        }

        accepted.push({
          envelopeId,
          serverSequence: Number(inserted.rows[0].serverSequence),
          deviceSequence: envelope.deviceSequence,
        });
      }

      await client.query('COMMIT');

      return {
        accepted,
        duplicates,
        serverSequence: accepted.length > 0
          ? Math.max(...accepted.map((item) => item.serverSequence))
          : duplicates.length > 0
            ? Math.max(...duplicates.map((item) => item.serverSequence))
            : Number(body.since || 0),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async pullEnvelopes({ auth, since }) {
    const defaultCalendar = await this.getDefaultCalendar(auth.userId);
    await this.assertCalendarRole(auth.userId, defaultCalendar.id, ['owner', 'edit', 'view']);

    const cursor = Number.parseInt(String(since || '0'), 10) || 0;
    const result = await this.db.query(
      `SELECT
        id,
        server_sequence AS "serverSequence",
        calendar_id AS "calendarId",
        device_id AS "deviceId",
        device_sequence AS "deviceSequence",
        entity,
        entity_id AS "entityId",
        operation,
        payload_cipher_text AS "payloadCipherText",
        metadata_patch AS "metadataPatch",
        nonce,
        client_timestamp AS "clientTimestamp",
        signature,
        signature_key_id AS "signatureKeyId",
        created_at AS "createdAt"
       FROM change_envelopes
       WHERE user_id = $1
         AND server_sequence > $2
       ORDER BY server_sequence ASC
       LIMIT $3`,
      [auth.userId, cursor, this.config.syncPullLimit]
    );

    const envelopes = result.rows.map((row) => {
      const decryptedPayload = row.payloadCipherText
        ? decryptJson(
            row.payloadCipherText,
            this.config.backendMasterKey,
            `change-envelope:${row.id}`
          )
        : { contentPatch: null, encryptedPatch: null };

      return {
        envelopeId: row.id,
        serverSequence: Number(row.serverSequence),
        calendarId: row.calendarId,
        deviceId: row.deviceId,
        deviceSequence: Number(row.deviceSequence),
        entity: row.entity,
        entityId: row.entityId,
        operation: row.operation,
        contentPatch: decryptedPayload.contentPatch || null,
        encryptedPatch: decryptedPayload.encryptedPatch || null,
        metadataPatch: row.metadataPatch,
        nonce: row.nonce,
        clientTimestamp: row.clientTimestamp,
        signature: row.signature,
        signatureKeyId: row.signatureKeyId,
        createdAt: row.createdAt,
      };
    });

    await this.db.query(
      `INSERT INTO sync_cursors (
        id,
        user_id,
        device_id,
        last_seen_server_sequence,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (user_id, device_id) DO UPDATE SET
        last_seen_server_sequence = EXCLUDED.last_seen_server_sequence,
        updated_at = NOW()`,
      [
        createId('cursor'),
        auth.userId,
        auth.deviceId,
        envelopes.length > 0 ? envelopes[envelopes.length - 1].serverSequence : cursor,
      ]
    );

    return {
      since: cursor,
      nextCursor: envelopes.length > 0 ? envelopes[envelopes.length - 1].serverSequence : cursor,
      envelopes,
    };
  }
}

module.exports = { SyncService };
