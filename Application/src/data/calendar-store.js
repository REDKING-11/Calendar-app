const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { CryptoService, CIPHER_VERSION } = require('../security/crypto-service');
const { HostedSyncService } = require('../security/hosted-sync-service');
const { OAuthService } = require('../security/oauth-service');
const { ReauthService } = require('../security/reauth-service');
const { SecureVault } = require('../security/secure-vault');
const { TrustedDeviceService } = require('../security/trusted-device-service');
const {
  sanitizeEventCreateInput,
  sanitizeEventUpdateInput,
  validateImportPath,
} = require('../security/validation');

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function buildDemoEvents() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const day = today.getDate();

  return [
    {
      title: 'Local-first architecture review',
      description: 'Walk through the sync model, local data ownership, and next implementation risks.',
      type: 'event',
      completed: false,
      repeat: 'none',
      hasDeadline: false,
      groupName: '',
      startsAt: new Date(year, month, day, 10, 0, 0, 0).toISOString(),
      endsAt: new Date(year, month, day, 11, 0, 0, 0).toISOString(),
      color: '#4f9d69',
      tags: [
        { id: createId('tag'), label: 'Architecture', color: '#1d4ed8' },
        { id: createId('tag'), label: 'Review', color: '#9a3412' },
      ],
    },
    {
      title: 'Phone sync UX sketch',
      description: 'Map the pairing flow and identify where mobile editing should stay intentionally lightweight.',
      type: 'appointment',
      completed: false,
      repeat: 'none',
      hasDeadline: false,
      groupName: '',
      startsAt: new Date(year, month, day + 1, 14, 0, 0, 0).toISOString(),
      endsAt: new Date(year, month, day + 1, 15, 0, 0, 0).toISOString(),
      color: '#4d8cf5',
      tags: [{ id: createId('tag'), label: 'UX', color: '#7c3aed' }],
    },
    {
      title: 'Pairing flow test',
      description: 'Run through QR-based pairing and confirm the basic LAN sync handoff works.',
      type: 'task',
      completed: false,
      repeat: 'weekly',
      hasDeadline: true,
      groupName: 'Launch prep',
      startsAt: new Date(year, month, day + 3, 9, 30, 0, 0).toISOString(),
      endsAt: new Date(year, month, day + 3, 10, 0, 0, 0).toISOString(),
      color: '#e3a13b',
      tags: [{ id: createId('tag'), label: 'Testing', color: '#be123c' }],
    },
  ];
}

function parseLegacyTagLabel(label) {
  return typeof label === 'string' ? label.trim() : '';
}

function buildLegacyTagLookup(tags = []) {
  const lookup = new Map();

  for (const tag of tags) {
    const normalizedLabel = parseLegacyTagLabel(tag?.label).toLowerCase();
    if (!normalizedLabel) {
      continue;
    }

    lookup.set(normalizedLabel, {
      id: tag.id || createId('tag'),
      label: parseLegacyTagLabel(tag.label),
      color: tag.color || '#475569',
    });
  }

  return lookup;
}

function normalizeLegacyTags(tags = [], catalog = []) {
  const knownTags = buildLegacyTagLookup(catalog);

  return (tags || [])
    .filter((tag) => parseLegacyTagLabel(tag?.label))
    .map((tag) => {
      const label = parseLegacyTagLabel(tag.label);
      const knownTag = knownTags.get(label.toLowerCase());

      if (knownTag) {
        return {
          id: knownTag.id,
          label: knownTag.label,
          color: tag.color || knownTag.color,
        };
      }

      return {
        id: tag.id || createId('tag'),
        label,
        color: tag.color || '#475569',
      };
    });
}

function mergeLegacyTagCatalog(existingTags = [], incomingTags = []) {
  const merged = buildLegacyTagLookup(existingTags);

  for (const tag of incomingTags) {
    const label = parseLegacyTagLabel(tag?.label);
    if (!label) {
      continue;
    }

    merged.set(label.toLowerCase(), {
      id: tag.id || merged.get(label.toLowerCase())?.id || createId('tag'),
      label,
      color: tag.color || merged.get(label.toLowerCase())?.color || '#475569',
    });
  }

  return Array.from(merged.values()).sort((left, right) =>
    left.label.localeCompare(right.label)
  );
}

function migrateLegacyState(state = {}) {
  const nextState = {
    schemaVersion: 2,
    deviceId: state.deviceId || createId('device'),
    lastSequence: Number(state.lastSequence || 0),
    events: Array.isArray(state.events) ? state.events : [],
    changes: Array.isArray(state.changes) ? state.changes : [],
    tags: Array.isArray(state.tags) ? state.tags : [],
  };

  nextState.tags = mergeLegacyTagCatalog(
    nextState.tags,
    nextState.events.flatMap((event) => event.tags || [])
  );

  return nextState;
}

class CalendarStore {
  constructor(baseDir, options = {}) {
    this.baseDir = baseDir;
    this.databasePath = path.join(baseDir, 'calendar-data.db');
    this.legacyJsonPath = path.join(baseDir, 'calendar-data.json');
    this.legacyBackupPath = path.join(baseDir, 'calendar-data.legacy-backup.enc');
    this.vault = new SecureVault(baseDir, options.safeStorage);
    this.vaultState = this.vault.ensureMasterKey();
    this.cryptoService = new CryptoService(this.vaultState.key);
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.reauthService = new ReauthService();

    this.initializeSchema();
    this.deviceService = new TrustedDeviceService({
      db: this.db,
      vault: this.vault,
      onAudit: (action, payload) => this.logSecurityEvent(action, payload),
    });
    this.oauthService = new OAuthService({
      db: this.db,
      cryptoService: this.cryptoService,
      shell: options.shell,
      onAudit: (action, payload) => this.logSecurityEvent(action, payload),
    });
    this.hostedSyncService = new HostedSyncService({
      db: this.db,
      cryptoService: this.cryptoService,
      deviceService: this.deviceService,
      shell: options.shell,
      fetchImpl: options.fetchImpl,
      onAudit: (action, payload) => this.logSecurityEvent(action, payload),
      callbacks: {
        prepareHostedBootstrap: () => this.prepareHostedBootstrap(),
        listEnvelopesSince: (sequence) => this.listHostedSyncEnvelopesSince(sequence),
        applyEnvelope: (envelope) => this.applyHostedEnvelope(envelope),
      },
    });
    this.hostedSyncService.initializeSchema();

    this.bootstrap();
  }

  initializeSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS event_metadata (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        repeat_rule TEXT NOT NULL DEFAULT 'none',
        has_deadline INTEGER NOT NULL DEFAULT 0,
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        color TEXT NOT NULL,
        sync_policy TEXT NOT NULL DEFAULT 'internal_only',
        visibility TEXT NOT NULL DEFAULT 'private',
        deleted INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        updated_by TEXT NOT NULL,
        content_cipher_version INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS event_content (
        event_id TEXT PRIMARY KEY REFERENCES event_metadata(id) ON DELETE CASCADE,
        cipher_text TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tag_catalog (
        id TEXT PRIMARY KEY,
        cipher_text TEXT NOT NULL,
        color TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS change_log (
        change_id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL UNIQUE,
        device_id TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        cipher_text TEXT NOT NULL,
        content_cipher_version INTEGER NOT NULL DEFAULT 1,
        signature TEXT NOT NULL,
        signature_key_id TEXT NOT NULL,
        nonce TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS security_audit_log (
        audit_id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        actor_device_id TEXT,
        target_type TEXT,
        target_id TEXT,
        details_cipher_text TEXT,
        severity TEXT NOT NULL DEFAULT 'info',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS connected_accounts (
        account_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        subject TEXT,
        email TEXT,
        display_name TEXT,
        permission_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        can_write INTEGER NOT NULL DEFAULT 0,
        write_scope_granted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_sync_at TEXT
      );

      CREATE TABLE IF NOT EXISTS token_records (
        token_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES connected_accounts(account_id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        scope_set TEXT NOT NULL,
        access_token_cipher_text TEXT,
        refresh_token_cipher_text TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS oauth_flows (
        state TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        requested_access TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        code_verifier_cipher_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS trusted_devices (
        device_id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        public_key TEXT NOT NULL,
        status TEXT NOT NULL,
        is_local INTEGER NOT NULL DEFAULT 0,
        trust_level TEXT NOT NULL DEFAULT 'full',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_seen_at TEXT,
        revoked_at TEXT
      );

      CREATE TABLE IF NOT EXISTS pairing_approvals (
        approval_id TEXT PRIMARY KEY,
        candidate_device_id TEXT,
        code_hash TEXT NOT NULL,
        label TEXT,
        status TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        approved_by TEXT,
        public_key TEXT,
        created_at TEXT NOT NULL,
        approved_at TEXT,
        revoked_at TEXT
      );
    `);
  }

  bootstrap() {
    this.ensureMeta('schemaVersion', '4');
    this.ensureMeta('lastSequence', '0');
    this.ensureMeta('contentCipherVersion', String(CIPHER_VERSION));

    const preferredDeviceId = this.getMeta('deviceId');
    const localDevice = this.deviceService.ensureLocalDevice(preferredDeviceId);
    this.deviceId = localDevice.deviceId;
    this.setMeta('deviceId', this.deviceId);

    if (this.vaultState.created) {
      this.logSecurityEvent('vault_created', {
        targetType: 'vault',
        targetId: 'security-vault',
        details: {
          protectionMode: this.vaultState.protectionMode,
        },
      });
    }

    if (this.countEvents() === 0) {
      if (fs.existsSync(this.legacyJsonPath)) {
        this.migrateLegacyJsonStore();
      } else {
        for (const eventInput of buildDemoEvents()) {
          this.insertEventRecord(sanitizeEventCreateInput(eventInput), {
            deviceId: this.deviceId,
          });
        }
        this.setMeta('demoSeedState', 'seeded');
      }
    } else if (!this.getMeta('demoSeedState')) {
      this.setMeta('demoSeedState', 'disabled');
    }
  }

  withTransaction(work) {
    this.db.exec('BEGIN');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  getMeta(key) {
    const row = this.db
      .prepare('SELECT value FROM app_meta WHERE key = :key')
      .get({ key });

    return row?.value ?? null;
  }

  setMeta(key, value) {
    this.db
      .prepare(
        `INSERT INTO app_meta (key, value)
         VALUES (:key, :value)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run({
        key,
        value: String(value),
      });
  }

  ensureMeta(key, fallbackValue) {
    const existing = this.getMeta(key);
    if (existing === null) {
      this.setMeta(key, fallbackValue);
      return fallbackValue;
    }

    return existing;
  }

  nextSequence() {
    const nextSequence = Number(this.getMeta('lastSequence') || '0') + 1;
    this.setMeta('lastSequence', String(nextSequence));
    return nextSequence;
  }

  countEvents() {
    return Number(
      this.db.prepare('SELECT COUNT(*) AS count FROM event_metadata').get()?.count || 0
    );
  }

  countAuditEvents() {
    return Number(
      this.db.prepare('SELECT COUNT(*) AS count FROM security_audit_log').get()?.count || 0
    );
  }

  getTrustedDeviceCount() {
    return Number(
      this.db
        .prepare(`SELECT COUNT(*) AS count FROM trusted_devices WHERE status = 'active'`)
        .get()?.count || 0
    );
  }

  getPendingPairingCount() {
    return Number(
      this.db
        .prepare(`SELECT COUNT(*) AS count FROM pairing_approvals WHERE status = 'pending'`)
        .get()?.count || 0
    );
  }

  getDemoSeedState() {
    return this.getMeta('demoSeedState') || 'disabled';
  }

  maybeMarkDemoSeedModified() {
    if (this.getDemoSeedState() === 'seeded') {
      this.setMeta('demoSeedState', 'modified');
    }
  }

  clearCalendarDataForHostedBootstrap() {
    this.withTransaction(() => {
      this.db.prepare('DELETE FROM event_content').run();
      this.db.prepare('DELETE FROM event_metadata').run();
      this.db.prepare('DELETE FROM tag_catalog').run();
      this.db.prepare('DELETE FROM change_log').run();
      this.setMeta('lastSequence', '0');
      this.setMeta('demoSeedState', 'disabled');
    });
  }

  prepareHostedBootstrap() {
    if (this.getDemoSeedState() !== 'seeded') {
      return;
    }

    this.clearCalendarDataForHostedBootstrap();
    this.logSecurityEvent('hosted_demo_seed_cleared', {
      targetType: 'hosted_sync',
      targetId: 'default',
      details: {
        reason: 'first_hosted_sync',
      },
    });
  }

  getTagCatalogMap() {
    const rows = this.db
      .prepare(
        `SELECT id, cipher_text AS cipherText, color, updated_at AS updatedAt
         FROM tag_catalog`
      )
      .all();

    const lookup = new Map();
    for (const row of rows) {
      const payload = this.cryptoService.decryptJson(row.cipherText, `tag:${row.id}`);
      lookup.set(payload.label.toLowerCase(), {
        id: row.id,
        label: payload.label,
        color: row.color,
        updatedAt: row.updatedAt,
      });
    }

    return lookup;
  }

  normalizeTags(tags = []) {
    const catalog = this.getTagCatalogMap();

    return (tags || []).map((tag) => {
      const known = catalog.get(tag.label.toLowerCase());
      if (known) {
        return {
          id: known.id,
          label: known.label,
          color: tag.color || known.color,
        };
      }

      return {
        id: tag.id || createId('tag'),
        label: tag.label,
        color: tag.color || '#475569',
      };
    });
  }

  upsertTagCatalog(tags = []) {
    const timestamp = nowIso();
    for (const tag of tags) {
      this.db
        .prepare(
          `INSERT INTO tag_catalog (id, cipher_text, color, updated_at)
           VALUES (:id, :cipherText, :color, :updatedAt)
           ON CONFLICT(id) DO UPDATE SET
             cipher_text = excluded.cipher_text,
             color = excluded.color,
             updated_at = excluded.updated_at`
        )
        .run({
          id: tag.id,
          cipherText: this.cryptoService.encryptJson(
            { label: tag.label },
            `tag:${tag.id}`
          ),
          color: tag.color,
          updatedAt: timestamp,
        });
    }
  }

  getTagCatalogSnapshot() {
    return Array.from(this.getTagCatalogMap().values()).sort((left, right) =>
      left.label.localeCompare(right.label)
    );
  }

  buildEventContent(input) {
    return {
      title: input.title,
      description: input.description || '',
      groupName: input.groupName || '',
      tags: this.normalizeTags(input.tags || []),
      externalProviderLinks: input.externalProviderLinks || [],
    };
  }

  insertEventRecord(input, options = {}) {
    const timestamp = nowIso();
    const eventId = input.id || createId('event');
    const content = this.buildEventContent(input);
    const normalizedTags = content.tags;

    this.upsertTagCatalog(normalizedTags);

    this.db
      .prepare(
        `INSERT INTO event_metadata (
          id,
          type,
          completed,
          repeat_rule,
          has_deadline,
          starts_at,
          ends_at,
          color,
          sync_policy,
          visibility,
          deleted,
          updated_at,
          updated_by,
          content_cipher_version
        ) VALUES (
          :id,
          :type,
          :completed,
          :repeatRule,
          :hasDeadline,
          :startsAt,
          :endsAt,
          :color,
          :syncPolicy,
          :visibility,
          0,
          :updatedAt,
          :updatedBy,
          :contentCipherVersion
        )`
      )
      .run({
        id: eventId,
        type: input.type,
        completed: input.completed ? 1 : 0,
        repeatRule: input.repeat,
        hasDeadline: input.hasDeadline ? 1 : 0,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        color: input.color,
        syncPolicy: input.syncPolicy || 'internal_only',
        visibility: input.visibility || 'private',
        updatedAt: timestamp,
        updatedBy: options.deviceId || this.deviceId,
        contentCipherVersion: CIPHER_VERSION,
      });

    this.db
      .prepare(
        `INSERT INTO event_content (event_id, cipher_text)
         VALUES (:eventId, :cipherText)`
      )
      .run({
        eventId,
        cipherText: this.cryptoService.encryptJson(content, `event:${eventId}:content`),
      });

    const patch = {
      ...input,
      tags: normalizedTags,
      externalProviderLinks: input.externalProviderLinks || [],
    };

    this.recordChange({
      entity: 'event',
      entityId: eventId,
      operation: 'create',
      patch,
      deviceId: options.deviceId || this.deviceId,
      signatureKeyId: options.deviceId || this.deviceId,
    });

    return this.getEventById(eventId);
  }

  getEventRowById(eventId) {
    return this.db
      .prepare(
        `SELECT
          m.id,
          m.type,
          m.completed,
          m.repeat_rule AS repeatRule,
          m.has_deadline AS hasDeadline,
          m.starts_at AS startsAt,
          m.ends_at AS endsAt,
          m.color,
          m.sync_policy AS syncPolicy,
          m.visibility,
          m.deleted,
          m.updated_at AS updatedAt,
          m.updated_by AS updatedBy,
          m.content_cipher_version AS contentCipherVersion,
          c.cipher_text AS cipherText
         FROM event_metadata m
         JOIN event_content c ON c.event_id = m.id
         WHERE m.id = :eventId`
      )
      .get({ eventId });
  }

  rowToEvent(row) {
    const content = this.cryptoService.decryptJson(row.cipherText, `event:${row.id}:content`);
    return {
      id: row.id,
      title: content.title,
      description: content.description || '',
      type: row.type,
      completed: Boolean(row.completed),
      repeat: row.repeatRule,
      hasDeadline: Boolean(row.hasDeadline),
      groupName: content.groupName || '',
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      color: row.color,
      tags: content.tags || [],
      deleted: Boolean(row.deleted),
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
      syncPolicy: row.syncPolicy,
      visibility: row.visibility,
      contentCipherVersion: row.contentCipherVersion,
      externalProviderLinks: content.externalProviderLinks || [],
    };
  }

  getEventById(eventId) {
    const row = this.getEventRowById(eventId);
    return row ? this.rowToEvent(row) : null;
  }

  listEvents(includeDeleted = false) {
    const rows = this.db
      .prepare(
        `SELECT
          m.id,
          m.type,
          m.completed,
          m.repeat_rule AS repeatRule,
          m.has_deadline AS hasDeadline,
          m.starts_at AS startsAt,
          m.ends_at AS endsAt,
          m.color,
          m.sync_policy AS syncPolicy,
          m.visibility,
          m.deleted,
          m.updated_at AS updatedAt,
          m.updated_by AS updatedBy,
          m.content_cipher_version AS contentCipherVersion,
          c.cipher_text AS cipherText
         FROM event_metadata m
         JOIN event_content c ON c.event_id = m.id
         WHERE (:includeDeleted = 1 OR m.deleted = 0)
         ORDER BY m.starts_at ASC`
      )
      .all({ includeDeleted: includeDeleted ? 1 : 0 });

    return rows.map((row) => this.rowToEvent(row));
  }

  listChangeSummaries() {
    return this.db
      .prepare(
        `SELECT
          change_id AS changeId,
          sequence,
          device_id AS deviceId,
          entity,
          entity_id AS entityId,
          operation,
          signature,
          signature_key_id AS signatureKeyId,
          nonce,
          timestamp
         FROM change_log
         ORDER BY sequence ASC`
      )
      .all();
  }

  splitHostedPatch(patch = {}) {
    const metadataPatch = {};
    const contentPatch = {};

    for (const field of [
      'type',
      'completed',
      'repeat',
      'hasDeadline',
      'startsAt',
      'endsAt',
      'color',
      'syncPolicy',
      'visibility',
      'deleted',
    ]) {
      if (patch[field] !== undefined) {
        metadataPatch[field] = patch[field];
      }
    }

    for (const field of ['title', 'description', 'groupName', 'tags', 'externalProviderLinks']) {
      if (patch[field] !== undefined) {
        contentPatch[field] = patch[field];
      }
    }

    return {
      metadataPatch,
      contentPatch,
    };
  }

  listHostedSyncEnvelopesSince(sequence = 0) {
    const rows = this.db
      .prepare(
        `SELECT
          change_id AS changeId,
          sequence,
          device_id AS deviceId,
          entity,
          entity_id AS entityId,
          operation,
          cipher_text AS cipherText,
          nonce,
          timestamp
         FROM change_log
         WHERE sequence > :sequence
         ORDER BY sequence ASC`
      )
      .all({
        sequence: Number(sequence || 0),
      });

    return rows.map((row) => {
      const patch = this.cryptoService.decryptJson(
        row.cipherText,
        `change:${row.changeId}:patch`
      );
      const { metadataPatch, contentPatch } = this.splitHostedPatch(patch);

      return {
        deviceId: row.deviceId,
        deviceSequence: Number(row.sequence),
        entity: row.entity,
        entityId: row.entityId,
        operation: row.operation,
        contentPatch: Object.keys(contentPatch).length > 0 ? contentPatch : null,
        encryptedPatch: null,
        metadataPatch,
        nonce: row.nonce,
        clientTimestamp: row.timestamp,
      };
    });
  }

  applyHostedEnvelope(envelope) {
    if (!envelope || envelope.entity !== 'event') {
      return false;
    }

    const metadataPatch = envelope.metadataPatch || {};
    const contentPatch = envelope.contentPatch || {};
    const deleted = Boolean(metadataPatch.deleted || envelope.operation === 'delete');
    const existing = this.getEventById(envelope.entityId);

    if (deleted) {
      if (!existing) {
        return false;
      }

      this.withTransaction(() => {
        this.db
          .prepare(
            `UPDATE event_metadata
             SET deleted = 1,
                 updated_at = :updatedAt,
                 updated_by = :updatedBy
             WHERE id = :id`
          )
          .run({
            id: envelope.entityId,
            updatedAt: nowIso(),
            updatedBy: envelope.deviceId,
          });
      });

      this.setMeta('demoSeedState', 'disabled');
      return true;
    }

    const mergedEvent = existing
      ? {
          ...existing,
          ...metadataPatch,
          ...contentPatch,
        }
      : {
          id: envelope.entityId,
          title: contentPatch.title || '',
          description: contentPatch.description || '',
          type: metadataPatch.type || 'event',
          completed: metadataPatch.completed ?? false,
          repeat: metadataPatch.repeat || 'none',
          hasDeadline: metadataPatch.hasDeadline ?? false,
          groupName: contentPatch.groupName || '',
          startsAt: metadataPatch.startsAt,
          endsAt: metadataPatch.endsAt,
          color: metadataPatch.color || '#4f9d69',
          tags: contentPatch.tags || [],
          syncPolicy: metadataPatch.syncPolicy || 'internal_only',
          visibility: metadataPatch.visibility || 'private',
          externalProviderLinks: contentPatch.externalProviderLinks || [],
        };

    const sanitized = sanitizeEventCreateInput(mergedEvent);
    const content = this.buildEventContent({
      ...sanitized,
      id: envelope.entityId,
    });

    this.withTransaction(() => {
      this.upsertTagCatalog(content.tags);

      this.db
        .prepare(
          `INSERT INTO event_metadata (
            id,
            type,
            completed,
            repeat_rule,
            has_deadline,
            starts_at,
            ends_at,
            color,
            sync_policy,
            visibility,
            deleted,
            updated_at,
            updated_by,
            content_cipher_version
          ) VALUES (
            :id,
            :type,
            :completed,
            :repeatRule,
            :hasDeadline,
            :startsAt,
            :endsAt,
            :color,
            :syncPolicy,
            :visibility,
            0,
            :updatedAt,
            :updatedBy,
            :contentCipherVersion
          )
          ON CONFLICT(id) DO UPDATE SET
            type = excluded.type,
            completed = excluded.completed,
            repeat_rule = excluded.repeat_rule,
            has_deadline = excluded.has_deadline,
            starts_at = excluded.starts_at,
            ends_at = excluded.ends_at,
            color = excluded.color,
            sync_policy = excluded.sync_policy,
            visibility = excluded.visibility,
            deleted = 0,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by,
            content_cipher_version = excluded.content_cipher_version`
        )
        .run({
          id: envelope.entityId,
          type: sanitized.type,
          completed: sanitized.completed ? 1 : 0,
          repeatRule: sanitized.repeat,
          hasDeadline: sanitized.hasDeadline ? 1 : 0,
          startsAt: sanitized.startsAt,
          endsAt: sanitized.endsAt,
          color: sanitized.color,
          syncPolicy: sanitized.syncPolicy,
          visibility: sanitized.visibility,
          updatedAt: nowIso(),
          updatedBy: envelope.deviceId,
          contentCipherVersion: CIPHER_VERSION,
        });

      this.db
        .prepare(
          `INSERT INTO event_content (event_id, cipher_text)
           VALUES (:eventId, :cipherText)
           ON CONFLICT(event_id) DO UPDATE SET
             cipher_text = excluded.cipher_text`
        )
        .run({
          eventId: envelope.entityId,
          cipherText: this.cryptoService.encryptJson(
            {
              title: sanitized.title,
              description: sanitized.description,
              groupName: sanitized.groupName,
              tags: content.tags,
              externalProviderLinks: sanitized.externalProviderLinks || [],
            },
            `event:${envelope.entityId}:content`
          ),
        });
    });

    this.setMeta('demoSeedState', 'disabled');
    return true;
  }

  buildSignedChangePayload(change) {
    return JSON.stringify({
      changeId: change.changeId,
      sequence: change.sequence,
      deviceId: change.deviceId,
      entity: change.entity,
      entityId: change.entityId,
      operation: change.operation,
      cipherText: change.cipherText,
      nonce: change.nonce,
      timestamp: change.timestamp,
    });
  }

  recordChange({ entity, entityId, operation, patch, deviceId, signatureKeyId }) {
    const changeId = createId('change');
    const sequence = this.nextSequence();
    const nonce = crypto.randomBytes(16).toString('hex');
    const timestamp = nowIso();
    const cipherText = this.cryptoService.encryptJson(
      patch,
      `change:${changeId}:patch`
    );
    const signature = this.deviceService.signPayload(
      this.buildSignedChangePayload({
        changeId,
        sequence,
        deviceId,
        entity,
        entityId,
        operation,
        cipherText,
        nonce,
        timestamp,
      })
    );

    this.db
      .prepare(
        `INSERT INTO change_log (
          change_id,
          sequence,
          device_id,
          entity,
          entity_id,
          operation,
          cipher_text,
          content_cipher_version,
          signature,
          signature_key_id,
          nonce,
          timestamp
        ) VALUES (
          :changeId,
          :sequence,
          :deviceId,
          :entity,
          :entityId,
          :operation,
          :cipherText,
          :contentCipherVersion,
          :signature,
          :signatureKeyId,
          :nonce,
          :timestamp
        )`
      )
      .run({
        changeId,
        sequence,
        deviceId,
        entity,
        entityId,
        operation,
        cipherText,
        contentCipherVersion: CIPHER_VERSION,
        signature,
        signatureKeyId,
        nonce,
        timestamp,
      });
  }

  logSecurityEvent(action, payload = {}) {
    const auditId = createId('audit');
    const details = payload.details
      ? this.cryptoService.encryptJson(
          payload.details,
          `audit:${auditId}:details`
        )
      : null;

    this.db
      .prepare(
        `INSERT INTO security_audit_log (
          audit_id,
          action,
          actor_device_id,
          target_type,
          target_id,
          details_cipher_text,
          severity,
          created_at
        ) VALUES (
          :auditId,
          :action,
          :actorDeviceId,
          :targetType,
          :targetId,
          :detailsCipherText,
          :severity,
          :createdAt
        )`
      )
      .run({
        auditId,
        action,
        actorDeviceId: payload.actorDeviceId || this.deviceId || null,
        targetType: payload.targetType || null,
        targetId: payload.targetId || null,
        detailsCipherText: details,
        severity: payload.severity || 'info',
        createdAt: nowIso(),
      });
  }

  migrateLegacyJsonStore() {
    const raw = fs.readFileSync(this.legacyJsonPath, 'utf8');
    const legacyState = migrateLegacyState(JSON.parse(raw));

    this.withTransaction(() => {
      for (const event of legacyState.events) {
        const migratedInput = sanitizeEventCreateInput({
          title: event.title,
          description: event.description || '',
          type: event.type || 'event',
          completed: Boolean(event.completed),
          repeat: event.repeat || 'none',
          hasDeadline: Boolean(event.hasDeadline),
          groupName: event.groupName || '',
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          color: event.color || '#4f9d69',
          tags: normalizeLegacyTags(event.tags, legacyState.tags),
          syncPolicy: event.syncPolicy || 'internal_only',
          visibility: event.visibility || 'private',
          externalProviderLinks: event.externalProviderLinks || [],
        });

        this.insertEventRecord(
          {
            ...migratedInput,
            id: event.id || createId('event'),
          },
          {
            deviceId: event.updatedBy || legacyState.deviceId || this.deviceId,
          }
        );
      }
    });

    fs.writeFileSync(
      this.legacyBackupPath,
      this.cryptoService.encryptText(raw, 'legacy-json-backup')
    );
    fs.unlinkSync(this.legacyJsonPath);
    this.setMeta('demoSeedState', 'disabled');

    this.logSecurityEvent('legacy_json_migrated', {
      targetType: 'store',
      targetId: path.basename(this.databasePath),
      details: {
        source: path.basename(this.legacyJsonPath),
        backup: path.basename(this.legacyBackupPath),
        migratedEventCount: legacyState.events.length,
      },
    });
  }

  snapshot() {
    const events = this.listEvents(false);
    const changes = this.listChangeSummaries();

    return {
      deviceId: this.deviceId,
      lastSequence: Number(this.getMeta('lastSequence') || '0'),
      events,
      tags: this.getTagCatalogSnapshot(),
      changes,
      stats: {
        activeEventCount: events.length,
        changeCount: changes.length,
      },
      security: this.getSecuritySnapshot(),
    };
  }

  getSecuritySnapshot() {
    const connectedAccounts = this.oauthService.listConnectedAccounts();
    const providers = this.oauthService.getProviders();
    const trustedDevices = this.deviceService.listTrustedDevices();
    const latestAudit = this.db
      .prepare(
        `SELECT action, created_at AS createdAt
         FROM security_audit_log
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get();

    return {
      storage: {
        databasePath: this.databasePath,
        schemaVersion: Number(this.getMeta('schemaVersion') || '4'),
        cipherVersion: Number(this.getMeta('contentCipherVersion') || CIPHER_VERSION),
        vault: this.vault.getStatus(),
        encryptedContentAtRest: true,
      },
      auth: {
        providers,
        connectedAccounts,
      },
      devices: {
        hostname: os.hostname(),
        trustedDeviceCount: trustedDevices.length,
        trustedDevices,
        pendingPairingCount: this.getPendingPairingCount(),
      },
      audit: {
        eventCount: this.countAuditEvents(),
        latestEvent: latestAudit || null,
      },
      hosted: this.hostedSyncService.getState(),
      reauth: {
        protectedActions: ['secureExport', 'rotateMasterKey', 'approvePairing'],
      },
    };
  }

  createEvent(input) {
    const sanitized = sanitizeEventCreateInput(input);
    this.maybeMarkDemoSeedModified();
    this.withTransaction(() => {
      this.insertEventRecord(sanitized, { deviceId: this.deviceId });
    });
    return this.snapshot();
  }

  updateEvent(input) {
    const event = this.getEventById(input.id);
    if (!event || event.deleted) {
      throw new Error('Event not found');
    }

    const sanitizedPatch = sanitizeEventUpdateInput(input);
    const nextEvent = {
      ...event,
      ...sanitizedPatch,
    };

    if (nextEvent.endsAt <= nextEvent.startsAt) {
      throw new Error('Event end time must be after the start time.');
    }

    const nextContent = this.buildEventContent(nextEvent);
    const currentContent = {
      title: event.title,
      description: event.description,
      groupName: event.groupName,
      tags: event.tags,
      externalProviderLinks: event.externalProviderLinks || [],
    };

    const metadataPatch = {};
    for (const field of [
      'type',
      'completed',
      'repeat',
      'hasDeadline',
      'startsAt',
      'endsAt',
      'color',
      'syncPolicy',
      'visibility',
    ]) {
      if (nextEvent[field] !== event[field]) {
        metadataPatch[field] = nextEvent[field];
      }
    }

    const contentChanged =
      JSON.stringify(nextContent) !== JSON.stringify(currentContent);

    if (Object.keys(metadataPatch).length === 0 && !contentChanged) {
      return this.snapshot();
    }

    this.maybeMarkDemoSeedModified();
    this.withTransaction(() => {
      this.upsertTagCatalog(nextContent.tags);

      this.db
        .prepare(
          `UPDATE event_metadata
           SET type = :type,
               completed = :completed,
               repeat_rule = :repeatRule,
               has_deadline = :hasDeadline,
               starts_at = :startsAt,
               ends_at = :endsAt,
               color = :color,
               sync_policy = :syncPolicy,
               visibility = :visibility,
               updated_at = :updatedAt,
               updated_by = :updatedBy
           WHERE id = :id`
        )
        .run({
          id: event.id,
          type: nextEvent.type,
          completed: nextEvent.completed ? 1 : 0,
          repeatRule: nextEvent.repeat,
          hasDeadline: nextEvent.hasDeadline ? 1 : 0,
          startsAt: nextEvent.startsAt,
          endsAt: nextEvent.endsAt,
          color: nextEvent.color,
          syncPolicy: nextEvent.syncPolicy,
          visibility: nextEvent.visibility,
          updatedAt: nowIso(),
          updatedBy: this.deviceId,
        });

      if (contentChanged) {
        this.db
          .prepare(
            `UPDATE event_content
             SET cipher_text = :cipherText
             WHERE event_id = :eventId`
          )
          .run({
            eventId: event.id,
            cipherText: this.cryptoService.encryptJson(
              nextContent,
              `event:${event.id}:content`
            ),
          });
      }

      const changePatch = {
        ...metadataPatch,
      };

      if (contentChanged) {
        if (nextContent.title !== currentContent.title) {
          changePatch.title = nextContent.title;
        }

        if (nextContent.description !== currentContent.description) {
          changePatch.description = nextContent.description;
        }

        if (nextContent.groupName !== currentContent.groupName) {
          changePatch.groupName = nextContent.groupName;
        }

        if (JSON.stringify(nextContent.tags) !== JSON.stringify(currentContent.tags)) {
          changePatch.tags = nextContent.tags;
        }

        if (
          JSON.stringify(nextContent.externalProviderLinks) !==
          JSON.stringify(currentContent.externalProviderLinks)
        ) {
          changePatch.externalProviderLinks = nextContent.externalProviderLinks;
        }
      }

      this.recordChange({
        entity: 'event',
        entityId: event.id,
        operation: 'update',
        patch: changePatch,
        deviceId: this.deviceId,
        signatureKeyId: this.deviceId,
      });
    });

    return this.snapshot();
  }

  deleteEvent(eventId) {
    const event = this.getEventById(eventId);
    if (!event || event.deleted) {
      throw new Error('Event not found');
    }

    this.maybeMarkDemoSeedModified();
    this.withTransaction(() => {
      this.db
        .prepare(
          `UPDATE event_metadata
           SET deleted = 1,
               updated_at = :updatedAt,
               updated_by = :updatedBy
           WHERE id = :id`
        )
        .run({
          id: eventId,
          updatedAt: nowIso(),
          updatedBy: this.deviceId,
        });

      this.recordChange({
        entity: 'event',
        entityId: eventId,
        operation: 'delete',
        patch: { deleted: true },
        deviceId: this.deviceId,
        signatureKeyId: this.deviceId,
      });
    });

    return this.snapshot();
  }

  listConnectedAccounts() {
    return this.oauthService.listConnectedAccounts();
  }

  getAvailableProviders() {
    return this.oauthService.getProviders();
  }

  startOAuthConnect(provider, accessLevel = 'read') {
    return this.oauthService.startConnect(provider, accessLevel);
  }

  async finishOAuthConnect(input) {
    const account = await this.oauthService.finishConnect(input);
    return {
      account,
      security: this.getSecuritySnapshot(),
    };
  }

  disconnectAccount(accountId) {
    const result = this.oauthService.disconnectAccount(accountId);
    return {
      result,
      security: this.getSecuritySnapshot(),
    };
  }

  async revokeAccount(accountId) {
    const result = await this.oauthService.revokeAccount(accountId);
    return {
      result,
      security: this.getSecuritySnapshot(),
    };
  }

  listTrustedDevices() {
    return this.deviceService.listTrustedDevices();
  }

  createPairingApproval(label) {
    return this.deviceService.createPairingApproval(label);
  }

  approvePairing(input) {
    this.reauthService.consumeApproval('approvePairing', input.approvalToken);
    const result = this.deviceService.approvePairing(input);
    return {
      result,
      security: this.getSecuritySnapshot(),
    };
  }

  revokeTrustedDevice(deviceId) {
    const result = this.deviceService.revokeDevice(deviceId);
    return {
      result,
      security: this.getSecuritySnapshot(),
    };
  }

  getHostedSyncState() {
    return this.hostedSyncService.getState();
  }

  async runHostedAction(action) {
    try {
      await action();
      return this.snapshot();
    } catch (error) {
      const hostedState = this.hostedSyncService.getState();
      this.hostedSyncService.updateState({
        connectionStatus:
          hostedState.connectionStatus === 'pending_auth' && hostedState.baseUrl
            ? 'configured'
            : hostedState.connectionStatus,
        lastError: error.message,
      });
      throw error;
    }
  }

  startHostedSyncConnect(baseUrl, provider) {
    return this.runHostedAction(() => this.hostedSyncService.startAuth(provider, baseUrl));
  }

  pollHostedSyncAuth() {
    return this.runHostedAction(() => this.hostedSyncService.pollAuthFlow());
  }

  syncHostedNow() {
    return this.runHostedAction(() => this.hostedSyncService.syncNow());
  }

  disconnectHostedSync() {
    return this.runHostedAction(() => this.hostedSyncService.disconnect());
  }

  beginReauth(action) {
    return this.reauthService.begin(action);
  }

  completeReauth(challengeId, response) {
    return this.reauthService.complete(challengeId, response);
  }

  exportSecureData(approvalId) {
    this.reauthService.consumeApproval('secureExport', approvalId);
    this.logSecurityEvent('secure_export_completed', {
      targetType: 'export',
      targetId: 'calendar-export',
    });

    return {
      exportedAt: nowIso(),
      snapshot: this.snapshot(),
      security: this.getSecuritySnapshot(),
    };
  }

  rotateMasterKey(approvalId) {
    this.reauthService.consumeApproval('rotateMasterKey', approvalId);

    const oldCrypto = this.cryptoService;
    const nextKey = crypto.randomBytes(32);
    const nextCrypto = new CryptoService(nextKey);

    this.withTransaction(() => {
      const eventRows = this.db
        .prepare(`SELECT event_id AS eventId, cipher_text AS cipherText FROM event_content`)
        .all();
      for (const row of eventRows) {
        const decrypted = oldCrypto.decryptJson(row.cipherText, `event:${row.eventId}:content`);
        this.db
          .prepare(
            `UPDATE event_content
             SET cipher_text = :cipherText
             WHERE event_id = :eventId`
          )
          .run({
            eventId: row.eventId,
            cipherText: nextCrypto.encryptJson(decrypted, `event:${row.eventId}:content`),
          });
      }

      const tagRows = this.db
        .prepare(`SELECT id, cipher_text AS cipherText FROM tag_catalog`)
        .all();
      for (const row of tagRows) {
        const decrypted = oldCrypto.decryptJson(row.cipherText, `tag:${row.id}`);
        this.db
          .prepare(
            `UPDATE tag_catalog
             SET cipher_text = :cipherText
             WHERE id = :id`
          )
          .run({
            id: row.id,
            cipherText: nextCrypto.encryptJson(decrypted, `tag:${row.id}`),
          });
      }

      const changeRows = this.db
        .prepare(`SELECT change_id AS changeId, cipher_text AS cipherText FROM change_log`)
        .all();
      for (const row of changeRows) {
        const decrypted = oldCrypto.decryptJson(row.cipherText, `change:${row.changeId}:patch`);
        this.db
          .prepare(
            `UPDATE change_log
             SET cipher_text = :cipherText
             WHERE change_id = :changeId`
          )
          .run({
            changeId: row.changeId,
            cipherText: nextCrypto.encryptJson(decrypted, `change:${row.changeId}:patch`),
          });
      }

      const tokenRows = this.db
        .prepare(
          `SELECT
            token_id AS tokenId,
            access_token_cipher_text AS accessTokenCipherText,
            refresh_token_cipher_text AS refreshTokenCipherText
           FROM token_records`
        )
        .all();
      for (const row of tokenRows) {
        const accessToken = row.accessTokenCipherText
          ? oldCrypto.decryptText(row.accessTokenCipherText, `oauth-token:${row.tokenId}:access`)
          : null;
        const refreshToken = row.refreshTokenCipherText
          ? oldCrypto.decryptText(row.refreshTokenCipherText, `oauth-token:${row.tokenId}:refresh`)
          : null;

        this.db
          .prepare(
            `UPDATE token_records
             SET access_token_cipher_text = :accessTokenCipherText,
                 refresh_token_cipher_text = :refreshTokenCipherText,
                 updated_at = :updatedAt
             WHERE token_id = :tokenId`
          )
          .run({
            tokenId: row.tokenId,
            accessTokenCipherText: accessToken
              ? nextCrypto.encryptText(accessToken, `oauth-token:${row.tokenId}:access`)
              : null,
            refreshTokenCipherText: refreshToken
              ? nextCrypto.encryptText(refreshToken, `oauth-token:${row.tokenId}:refresh`)
              : null,
            updatedAt: nowIso(),
          });
      }

      const flowRows = this.db
        .prepare(
          `SELECT state, code_verifier_cipher_text AS codeVerifierCipherText FROM oauth_flows`
        )
        .all();
      for (const row of flowRows) {
        const verifier = oldCrypto.decryptText(row.codeVerifierCipherText, `oauth-flow:${row.state}`);
        this.db
          .prepare(
            `UPDATE oauth_flows
             SET code_verifier_cipher_text = :codeVerifierCipherText
             WHERE state = :state`
          )
          .run({
            state: row.state,
            codeVerifierCipherText: nextCrypto.encryptText(
              verifier,
              `oauth-flow:${row.state}`
            ),
          });
      }

      const hostedRows = this.db
        .prepare(
          `SELECT
            state_id AS stateId,
            access_token_cipher_text AS accessTokenCipherText,
            refresh_token_cipher_text AS refreshTokenCipherText
           FROM hosted_sync_state`
        )
        .all();
      for (const row of hostedRows) {
        const accessToken = row.accessTokenCipherText
          ? oldCrypto.decryptText(row.accessTokenCipherText, 'hosted-sync:access-token')
          : null;
        const refreshToken = row.refreshTokenCipherText
          ? oldCrypto.decryptText(row.refreshTokenCipherText, 'hosted-sync:refresh-token')
          : null;

        this.db
          .prepare(
            `UPDATE hosted_sync_state
             SET access_token_cipher_text = :accessTokenCipherText,
                 refresh_token_cipher_text = :refreshTokenCipherText,
                 updated_at = :updatedAt
             WHERE state_id = :stateId`
          )
          .run({
            stateId: row.stateId,
            accessTokenCipherText: accessToken
              ? nextCrypto.encryptText(accessToken, 'hosted-sync:access-token')
              : null,
            refreshTokenCipherText: refreshToken
              ? nextCrypto.encryptText(refreshToken, 'hosted-sync:refresh-token')
              : null,
            updatedAt: nowIso(),
          });
      }

      const auditRows = this.db
        .prepare(
          `SELECT audit_id AS auditId, details_cipher_text AS detailsCipherText
           FROM security_audit_log
           WHERE details_cipher_text IS NOT NULL`
        )
        .all();
      for (const row of auditRows) {
        const decrypted = oldCrypto.decryptJson(
          row.detailsCipherText,
          `audit:${row.auditId}:details`
        );
        this.db
          .prepare(
            `UPDATE security_audit_log
             SET details_cipher_text = :detailsCipherText
             WHERE audit_id = :auditId`
          )
          .run({
            auditId: row.auditId,
            detailsCipherText: nextCrypto.encryptJson(
              decrypted,
              `audit:${row.auditId}:details`
            ),
          });
      }
    });

    this.vault.rotateMasterKey(nextKey);
    this.cryptoService = nextCrypto;
    this.oauthService.cryptoService = nextCrypto;
    this.hostedSyncService.cryptoService = nextCrypto;

    this.logSecurityEvent('master_key_rotated', {
      targetType: 'vault',
      targetId: 'security-vault',
    });

    return this.getSecuritySnapshot();
  }

  close() {
    this.db.close();
  }

  validateImportPath(candidatePath) {
    return validateImportPath(candidatePath, this.baseDir);
  }
}

module.exports = { CalendarStore };
