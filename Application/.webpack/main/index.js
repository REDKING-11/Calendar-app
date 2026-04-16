/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ "./src/data/calendar-store.js"
/*!************************************!*\
  !*** ./src/data/calendar-store.js ***!
  \************************************/
(module, __unused_webpack_exports, __webpack_require__) {

const crypto = __webpack_require__(/*! node:crypto */ "node:crypto");
const fs = __webpack_require__(/*! node:fs */ "node:fs");
const os = __webpack_require__(/*! node:os */ "node:os");
const path = __webpack_require__(/*! node:path */ "node:path");
const {
  DatabaseSync
} = __webpack_require__(/*! node:sqlite */ "node:sqlite");
const {
  CryptoService,
  CIPHER_VERSION
} = __webpack_require__(/*! ../security/crypto-service */ "./src/security/crypto-service.js");
const {
  HostedSyncService
} = __webpack_require__(/*! ../security/hosted-sync-service */ "./src/security/hosted-sync-service.js");
const {
  OAuthService
} = __webpack_require__(/*! ../security/oauth-service */ "./src/security/oauth-service.js");
const {
  ReauthService
} = __webpack_require__(/*! ../security/reauth-service */ "./src/security/reauth-service.js");
const {
  SecureVault
} = __webpack_require__(/*! ../security/secure-vault */ "./src/security/secure-vault.js");
const {
  TrustedDeviceService
} = __webpack_require__(/*! ../security/trusted-device-service */ "./src/security/trusted-device-service.js");
const {
  sanitizeEventCreateInput,
  sanitizeEventUpdateInput,
  validateImportPath
} = __webpack_require__(/*! ../security/validation */ "./src/security/validation.js");
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
  return [{
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
    tags: [{
      id: createId('tag'),
      label: 'Architecture',
      color: '#1d4ed8'
    }, {
      id: createId('tag'),
      label: 'Review',
      color: '#9a3412'
    }]
  }, {
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
    tags: [{
      id: createId('tag'),
      label: 'UX',
      color: '#7c3aed'
    }]
  }, {
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
    tags: [{
      id: createId('tag'),
      label: 'Testing',
      color: '#be123c'
    }]
  }];
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
      color: tag.color || '#475569'
    });
  }
  return lookup;
}
function normalizeLegacyTags(tags = [], catalog = []) {
  const knownTags = buildLegacyTagLookup(catalog);
  return (tags || []).filter(tag => parseLegacyTagLabel(tag?.label)).map(tag => {
    const label = parseLegacyTagLabel(tag.label);
    const knownTag = knownTags.get(label.toLowerCase());
    if (knownTag) {
      return {
        id: knownTag.id,
        label: knownTag.label,
        color: tag.color || knownTag.color
      };
    }
    return {
      id: tag.id || createId('tag'),
      label,
      color: tag.color || '#475569'
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
      color: tag.color || merged.get(label.toLowerCase())?.color || '#475569'
    });
  }
  return Array.from(merged.values()).sort((left, right) => left.label.localeCompare(right.label));
}
function migrateLegacyState(state = {}) {
  const nextState = {
    schemaVersion: 2,
    deviceId: state.deviceId || createId('device'),
    lastSequence: Number(state.lastSequence || 0),
    events: Array.isArray(state.events) ? state.events : [],
    changes: Array.isArray(state.changes) ? state.changes : [],
    tags: Array.isArray(state.tags) ? state.tags : []
  };
  nextState.tags = mergeLegacyTagCatalog(nextState.tags, nextState.events.flatMap(event => event.tags || []));
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
      onAudit: (action, payload) => this.logSecurityEvent(action, payload)
    });
    this.oauthService = new OAuthService({
      db: this.db,
      cryptoService: this.cryptoService,
      shell: options.shell,
      onAudit: (action, payload) => this.logSecurityEvent(action, payload)
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
        listEnvelopesSince: sequence => this.listHostedSyncEnvelopesSince(sequence),
        applyEnvelope: envelope => this.applyHostedEnvelope(envelope)
      }
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
          protectionMode: this.vaultState.protectionMode
        }
      });
    }
    if (this.countEvents() === 0) {
      if (fs.existsSync(this.legacyJsonPath)) {
        this.migrateLegacyJsonStore();
      } else {
        for (const eventInput of buildDemoEvents()) {
          this.insertEventRecord(sanitizeEventCreateInput(eventInput), {
            deviceId: this.deviceId
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
    const row = this.db.prepare('SELECT value FROM app_meta WHERE key = :key').get({
      key
    });
    return row?.value ?? null;
  }
  setMeta(key, value) {
    this.db.prepare(`INSERT INTO app_meta (key, value)
         VALUES (:key, :value)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run({
      key,
      value: String(value)
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
    return Number(this.db.prepare('SELECT COUNT(*) AS count FROM event_metadata').get()?.count || 0);
  }
  countAuditEvents() {
    return Number(this.db.prepare('SELECT COUNT(*) AS count FROM security_audit_log').get()?.count || 0);
  }
  getTrustedDeviceCount() {
    return Number(this.db.prepare(`SELECT COUNT(*) AS count FROM trusted_devices WHERE status = 'active'`).get()?.count || 0);
  }
  getPendingPairingCount() {
    return Number(this.db.prepare(`SELECT COUNT(*) AS count FROM pairing_approvals WHERE status = 'pending'`).get()?.count || 0);
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
        reason: 'first_hosted_sync'
      }
    });
  }
  getTagCatalogMap() {
    const rows = this.db.prepare(`SELECT id, cipher_text AS cipherText, color, updated_at AS updatedAt
         FROM tag_catalog`).all();
    const lookup = new Map();
    for (const row of rows) {
      const payload = this.cryptoService.decryptJson(row.cipherText, `tag:${row.id}`);
      lookup.set(payload.label.toLowerCase(), {
        id: row.id,
        label: payload.label,
        color: row.color,
        updatedAt: row.updatedAt
      });
    }
    return lookup;
  }
  normalizeTags(tags = []) {
    const catalog = this.getTagCatalogMap();
    return (tags || []).map(tag => {
      const known = catalog.get(tag.label.toLowerCase());
      if (known) {
        return {
          id: known.id,
          label: known.label,
          color: tag.color || known.color
        };
      }
      return {
        id: tag.id || createId('tag'),
        label: tag.label,
        color: tag.color || '#475569'
      };
    });
  }
  upsertTagCatalog(tags = []) {
    const timestamp = nowIso();
    for (const tag of tags) {
      this.db.prepare(`INSERT INTO tag_catalog (id, cipher_text, color, updated_at)
           VALUES (:id, :cipherText, :color, :updatedAt)
           ON CONFLICT(id) DO UPDATE SET
             cipher_text = excluded.cipher_text,
             color = excluded.color,
             updated_at = excluded.updated_at`).run({
        id: tag.id,
        cipherText: this.cryptoService.encryptJson({
          label: tag.label
        }, `tag:${tag.id}`),
        color: tag.color,
        updatedAt: timestamp
      });
    }
  }
  getTagCatalogSnapshot() {
    return Array.from(this.getTagCatalogMap().values()).sort((left, right) => left.label.localeCompare(right.label));
  }
  buildEventContent(input) {
    return {
      title: input.title,
      description: input.description || '',
      groupName: input.groupName || '',
      tags: this.normalizeTags(input.tags || []),
      externalProviderLinks: input.externalProviderLinks || []
    };
  }
  insertEventRecord(input, options = {}) {
    const timestamp = nowIso();
    const eventId = input.id || createId('event');
    const content = this.buildEventContent(input);
    const normalizedTags = content.tags;
    this.upsertTagCatalog(normalizedTags);
    this.db.prepare(`INSERT INTO event_metadata (
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
        )`).run({
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
      contentCipherVersion: CIPHER_VERSION
    });
    this.db.prepare(`INSERT INTO event_content (event_id, cipher_text)
         VALUES (:eventId, :cipherText)`).run({
      eventId,
      cipherText: this.cryptoService.encryptJson(content, `event:${eventId}:content`)
    });
    const patch = {
      ...input,
      tags: normalizedTags,
      externalProviderLinks: input.externalProviderLinks || []
    };
    this.recordChange({
      entity: 'event',
      entityId: eventId,
      operation: 'create',
      patch,
      deviceId: options.deviceId || this.deviceId,
      signatureKeyId: options.deviceId || this.deviceId
    });
    return this.getEventById(eventId);
  }
  getEventRowById(eventId) {
    return this.db.prepare(`SELECT
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
         WHERE m.id = :eventId`).get({
      eventId
    });
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
      externalProviderLinks: content.externalProviderLinks || []
    };
  }
  getEventById(eventId) {
    const row = this.getEventRowById(eventId);
    return row ? this.rowToEvent(row) : null;
  }
  listEvents(includeDeleted = false) {
    const rows = this.db.prepare(`SELECT
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
         ORDER BY m.starts_at ASC`).all({
      includeDeleted: includeDeleted ? 1 : 0
    });
    return rows.map(row => this.rowToEvent(row));
  }
  listChangeSummaries() {
    return this.db.prepare(`SELECT
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
         ORDER BY sequence ASC`).all();
  }
  splitHostedPatch(patch = {}) {
    const metadataPatch = {};
    const contentPatch = {};
    for (const field of ['type', 'completed', 'repeat', 'hasDeadline', 'startsAt', 'endsAt', 'color', 'syncPolicy', 'visibility', 'deleted']) {
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
      contentPatch
    };
  }
  listHostedSyncEnvelopesSince(sequence = 0) {
    const rows = this.db.prepare(`SELECT
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
         ORDER BY sequence ASC`).all({
      sequence: Number(sequence || 0)
    });
    return rows.map(row => {
      const patch = this.cryptoService.decryptJson(row.cipherText, `change:${row.changeId}:patch`);
      const {
        metadataPatch,
        contentPatch
      } = this.splitHostedPatch(patch);
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
        clientTimestamp: row.timestamp
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
        this.db.prepare(`UPDATE event_metadata
             SET deleted = 1,
                 updated_at = :updatedAt,
                 updated_by = :updatedBy
             WHERE id = :id`).run({
          id: envelope.entityId,
          updatedAt: nowIso(),
          updatedBy: envelope.deviceId
        });
      });
      this.setMeta('demoSeedState', 'disabled');
      return true;
    }
    const mergedEvent = existing ? {
      ...existing,
      ...metadataPatch,
      ...contentPatch
    } : {
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
      externalProviderLinks: contentPatch.externalProviderLinks || []
    };
    const sanitized = sanitizeEventCreateInput(mergedEvent);
    const content = this.buildEventContent({
      ...sanitized,
      id: envelope.entityId
    });
    this.withTransaction(() => {
      this.upsertTagCatalog(content.tags);
      this.db.prepare(`INSERT INTO event_metadata (
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
            content_cipher_version = excluded.content_cipher_version`).run({
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
        contentCipherVersion: CIPHER_VERSION
      });
      this.db.prepare(`INSERT INTO event_content (event_id, cipher_text)
           VALUES (:eventId, :cipherText)
           ON CONFLICT(event_id) DO UPDATE SET
             cipher_text = excluded.cipher_text`).run({
        eventId: envelope.entityId,
        cipherText: this.cryptoService.encryptJson({
          title: sanitized.title,
          description: sanitized.description,
          groupName: sanitized.groupName,
          tags: content.tags,
          externalProviderLinks: sanitized.externalProviderLinks || []
        }, `event:${envelope.entityId}:content`)
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
      timestamp: change.timestamp
    });
  }
  recordChange({
    entity,
    entityId,
    operation,
    patch,
    deviceId,
    signatureKeyId
  }) {
    const changeId = createId('change');
    const sequence = this.nextSequence();
    const nonce = crypto.randomBytes(16).toString('hex');
    const timestamp = nowIso();
    const cipherText = this.cryptoService.encryptJson(patch, `change:${changeId}:patch`);
    const signature = this.deviceService.signPayload(this.buildSignedChangePayload({
      changeId,
      sequence,
      deviceId,
      entity,
      entityId,
      operation,
      cipherText,
      nonce,
      timestamp
    }));
    this.db.prepare(`INSERT INTO change_log (
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
        )`).run({
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
      timestamp
    });
  }
  logSecurityEvent(action, payload = {}) {
    const auditId = createId('audit');
    const details = payload.details ? this.cryptoService.encryptJson(payload.details, `audit:${auditId}:details`) : null;
    this.db.prepare(`INSERT INTO security_audit_log (
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
        )`).run({
      auditId,
      action,
      actorDeviceId: payload.actorDeviceId || this.deviceId || null,
      targetType: payload.targetType || null,
      targetId: payload.targetId || null,
      detailsCipherText: details,
      severity: payload.severity || 'info',
      createdAt: nowIso()
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
          externalProviderLinks: event.externalProviderLinks || []
        });
        this.insertEventRecord({
          ...migratedInput,
          id: event.id || createId('event')
        }, {
          deviceId: event.updatedBy || legacyState.deviceId || this.deviceId
        });
      }
    });
    fs.writeFileSync(this.legacyBackupPath, this.cryptoService.encryptText(raw, 'legacy-json-backup'));
    fs.unlinkSync(this.legacyJsonPath);
    this.setMeta('demoSeedState', 'disabled');
    this.logSecurityEvent('legacy_json_migrated', {
      targetType: 'store',
      targetId: path.basename(this.databasePath),
      details: {
        source: path.basename(this.legacyJsonPath),
        backup: path.basename(this.legacyBackupPath),
        migratedEventCount: legacyState.events.length
      }
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
        changeCount: changes.length
      },
      security: this.getSecuritySnapshot()
    };
  }
  getSecuritySnapshot() {
    const connectedAccounts = this.oauthService.listConnectedAccounts();
    const providers = this.oauthService.getProviders();
    const trustedDevices = this.deviceService.listTrustedDevices();
    const latestAudit = this.db.prepare(`SELECT action, created_at AS createdAt
         FROM security_audit_log
         ORDER BY created_at DESC
         LIMIT 1`).get();
    return {
      storage: {
        databasePath: this.databasePath,
        schemaVersion: Number(this.getMeta('schemaVersion') || '4'),
        cipherVersion: Number(this.getMeta('contentCipherVersion') || CIPHER_VERSION),
        vault: this.vault.getStatus(),
        encryptedContentAtRest: true
      },
      auth: {
        providers,
        connectedAccounts
      },
      devices: {
        hostname: os.hostname(),
        trustedDeviceCount: trustedDevices.length,
        trustedDevices,
        pendingPairingCount: this.getPendingPairingCount()
      },
      audit: {
        eventCount: this.countAuditEvents(),
        latestEvent: latestAudit || null
      },
      hosted: this.hostedSyncService.getState(),
      reauth: {
        protectedActions: ['secureExport', 'rotateMasterKey', 'approvePairing']
      }
    };
  }
  createEvent(input) {
    const sanitized = sanitizeEventCreateInput(input);
    this.maybeMarkDemoSeedModified();
    this.withTransaction(() => {
      this.insertEventRecord(sanitized, {
        deviceId: this.deviceId
      });
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
      ...sanitizedPatch
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
      externalProviderLinks: event.externalProviderLinks || []
    };
    const metadataPatch = {};
    for (const field of ['type', 'completed', 'repeat', 'hasDeadline', 'startsAt', 'endsAt', 'color', 'syncPolicy', 'visibility']) {
      if (nextEvent[field] !== event[field]) {
        metadataPatch[field] = nextEvent[field];
      }
    }
    const contentChanged = JSON.stringify(nextContent) !== JSON.stringify(currentContent);
    if (Object.keys(metadataPatch).length === 0 && !contentChanged) {
      return this.snapshot();
    }
    this.maybeMarkDemoSeedModified();
    this.withTransaction(() => {
      this.upsertTagCatalog(nextContent.tags);
      this.db.prepare(`UPDATE event_metadata
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
           WHERE id = :id`).run({
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
        updatedBy: this.deviceId
      });
      if (contentChanged) {
        this.db.prepare(`UPDATE event_content
             SET cipher_text = :cipherText
             WHERE event_id = :eventId`).run({
          eventId: event.id,
          cipherText: this.cryptoService.encryptJson(nextContent, `event:${event.id}:content`)
        });
      }
      const changePatch = {
        ...metadataPatch
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
        if (JSON.stringify(nextContent.externalProviderLinks) !== JSON.stringify(currentContent.externalProviderLinks)) {
          changePatch.externalProviderLinks = nextContent.externalProviderLinks;
        }
      }
      this.recordChange({
        entity: 'event',
        entityId: event.id,
        operation: 'update',
        patch: changePatch,
        deviceId: this.deviceId,
        signatureKeyId: this.deviceId
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
      this.db.prepare(`UPDATE event_metadata
           SET deleted = 1,
               updated_at = :updatedAt,
               updated_by = :updatedBy
           WHERE id = :id`).run({
        id: eventId,
        updatedAt: nowIso(),
        updatedBy: this.deviceId
      });
      this.recordChange({
        entity: 'event',
        entityId: eventId,
        operation: 'delete',
        patch: {
          deleted: true
        },
        deviceId: this.deviceId,
        signatureKeyId: this.deviceId
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
      security: this.getSecuritySnapshot()
    };
  }
  disconnectAccount(accountId) {
    const result = this.oauthService.disconnectAccount(accountId);
    return {
      result,
      security: this.getSecuritySnapshot()
    };
  }
  async revokeAccount(accountId) {
    const result = await this.oauthService.revokeAccount(accountId);
    return {
      result,
      security: this.getSecuritySnapshot()
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
      security: this.getSecuritySnapshot()
    };
  }
  revokeTrustedDevice(deviceId) {
    const result = this.deviceService.revokeDevice(deviceId);
    return {
      result,
      security: this.getSecuritySnapshot()
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
        connectionStatus: hostedState.connectionStatus === 'pending_auth' && hostedState.baseUrl ? 'configured' : hostedState.connectionStatus,
        lastError: error.message
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
      targetId: 'calendar-export'
    });
    return {
      exportedAt: nowIso(),
      snapshot: this.snapshot(),
      security: this.getSecuritySnapshot()
    };
  }
  rotateMasterKey(approvalId) {
    this.reauthService.consumeApproval('rotateMasterKey', approvalId);
    const oldCrypto = this.cryptoService;
    const nextKey = crypto.randomBytes(32);
    const nextCrypto = new CryptoService(nextKey);
    this.withTransaction(() => {
      const eventRows = this.db.prepare(`SELECT event_id AS eventId, cipher_text AS cipherText FROM event_content`).all();
      for (const row of eventRows) {
        const decrypted = oldCrypto.decryptJson(row.cipherText, `event:${row.eventId}:content`);
        this.db.prepare(`UPDATE event_content
             SET cipher_text = :cipherText
             WHERE event_id = :eventId`).run({
          eventId: row.eventId,
          cipherText: nextCrypto.encryptJson(decrypted, `event:${row.eventId}:content`)
        });
      }
      const tagRows = this.db.prepare(`SELECT id, cipher_text AS cipherText FROM tag_catalog`).all();
      for (const row of tagRows) {
        const decrypted = oldCrypto.decryptJson(row.cipherText, `tag:${row.id}`);
        this.db.prepare(`UPDATE tag_catalog
             SET cipher_text = :cipherText
             WHERE id = :id`).run({
          id: row.id,
          cipherText: nextCrypto.encryptJson(decrypted, `tag:${row.id}`)
        });
      }
      const changeRows = this.db.prepare(`SELECT change_id AS changeId, cipher_text AS cipherText FROM change_log`).all();
      for (const row of changeRows) {
        const decrypted = oldCrypto.decryptJson(row.cipherText, `change:${row.changeId}:patch`);
        this.db.prepare(`UPDATE change_log
             SET cipher_text = :cipherText
             WHERE change_id = :changeId`).run({
          changeId: row.changeId,
          cipherText: nextCrypto.encryptJson(decrypted, `change:${row.changeId}:patch`)
        });
      }
      const tokenRows = this.db.prepare(`SELECT
            token_id AS tokenId,
            access_token_cipher_text AS accessTokenCipherText,
            refresh_token_cipher_text AS refreshTokenCipherText
           FROM token_records`).all();
      for (const row of tokenRows) {
        const accessToken = row.accessTokenCipherText ? oldCrypto.decryptText(row.accessTokenCipherText, `oauth-token:${row.tokenId}:access`) : null;
        const refreshToken = row.refreshTokenCipherText ? oldCrypto.decryptText(row.refreshTokenCipherText, `oauth-token:${row.tokenId}:refresh`) : null;
        this.db.prepare(`UPDATE token_records
             SET access_token_cipher_text = :accessTokenCipherText,
                 refresh_token_cipher_text = :refreshTokenCipherText,
                 updated_at = :updatedAt
             WHERE token_id = :tokenId`).run({
          tokenId: row.tokenId,
          accessTokenCipherText: accessToken ? nextCrypto.encryptText(accessToken, `oauth-token:${row.tokenId}:access`) : null,
          refreshTokenCipherText: refreshToken ? nextCrypto.encryptText(refreshToken, `oauth-token:${row.tokenId}:refresh`) : null,
          updatedAt: nowIso()
        });
      }
      const flowRows = this.db.prepare(`SELECT state, code_verifier_cipher_text AS codeVerifierCipherText FROM oauth_flows`).all();
      for (const row of flowRows) {
        const verifier = oldCrypto.decryptText(row.codeVerifierCipherText, `oauth-flow:${row.state}`);
        this.db.prepare(`UPDATE oauth_flows
             SET code_verifier_cipher_text = :codeVerifierCipherText
             WHERE state = :state`).run({
          state: row.state,
          codeVerifierCipherText: nextCrypto.encryptText(verifier, `oauth-flow:${row.state}`)
        });
      }
      const hostedRows = this.db.prepare(`SELECT
            state_id AS stateId,
            access_token_cipher_text AS accessTokenCipherText,
            refresh_token_cipher_text AS refreshTokenCipherText
           FROM hosted_sync_state`).all();
      for (const row of hostedRows) {
        const accessToken = row.accessTokenCipherText ? oldCrypto.decryptText(row.accessTokenCipherText, 'hosted-sync:access-token') : null;
        const refreshToken = row.refreshTokenCipherText ? oldCrypto.decryptText(row.refreshTokenCipherText, 'hosted-sync:refresh-token') : null;
        this.db.prepare(`UPDATE hosted_sync_state
             SET access_token_cipher_text = :accessTokenCipherText,
                 refresh_token_cipher_text = :refreshTokenCipherText,
                 updated_at = :updatedAt
             WHERE state_id = :stateId`).run({
          stateId: row.stateId,
          accessTokenCipherText: accessToken ? nextCrypto.encryptText(accessToken, 'hosted-sync:access-token') : null,
          refreshTokenCipherText: refreshToken ? nextCrypto.encryptText(refreshToken, 'hosted-sync:refresh-token') : null,
          updatedAt: nowIso()
        });
      }
      const auditRows = this.db.prepare(`SELECT audit_id AS auditId, details_cipher_text AS detailsCipherText
           FROM security_audit_log
           WHERE details_cipher_text IS NOT NULL`).all();
      for (const row of auditRows) {
        const decrypted = oldCrypto.decryptJson(row.detailsCipherText, `audit:${row.auditId}:details`);
        this.db.prepare(`UPDATE security_audit_log
             SET details_cipher_text = :detailsCipherText
             WHERE audit_id = :auditId`).run({
          auditId: row.auditId,
          detailsCipherText: nextCrypto.encryptJson(decrypted, `audit:${row.auditId}:details`)
        });
      }
    });
    this.vault.rotateMasterKey(nextKey);
    this.cryptoService = nextCrypto;
    this.oauthService.cryptoService = nextCrypto;
    this.hostedSyncService.cryptoService = nextCrypto;
    this.logSecurityEvent('master_key_rotated', {
      targetType: 'vault',
      targetId: 'security-vault'
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
module.exports = {
  CalendarStore
};

/***/ },

/***/ "./src/ipc/calendar-ipc.js"
/*!*********************************!*\
  !*** ./src/ipc/calendar-ipc.js ***!
  \*********************************/
(module, __unused_webpack_exports, __webpack_require__) {

const {
  ipcMain
} = __webpack_require__(/*! electron */ "electron");
function registerCalendarHandlers(store) {
  for (const channel of ['calendar:getSnapshot', 'calendar:createEvent', 'calendar:updateEvent', 'calendar:deleteEvent', 'security:getSnapshot', 'security:getProviders', 'security:listAccounts', 'security:startOAuthConnect', 'security:finishOAuthConnect', 'security:disconnectAccount', 'security:revokeAccount', 'security:listTrustedDevices', 'security:createPairingApproval', 'security:approvePairing', 'security:revokeTrustedDevice', 'hosted:getState', 'hosted:startConnect', 'hosted:pollAuth', 'hosted:syncNow', 'hosted:disconnect', 'security:beginReauth', 'security:completeReauth', 'security:exportSecureData', 'security:rotateMasterKey']) {
    ipcMain.removeHandler(channel);
  }
  ipcMain.handle('calendar:getSnapshot', () => store.snapshot());
  ipcMain.handle('calendar:createEvent', (_event, input) => store.createEvent(input));
  ipcMain.handle('calendar:updateEvent', (_event, input) => store.updateEvent(input));
  ipcMain.handle('calendar:deleteEvent', (_event, eventId) => store.deleteEvent(eventId));
  ipcMain.handle('security:getSnapshot', () => store.getSecuritySnapshot());
  ipcMain.handle('security:getProviders', () => store.getAvailableProviders());
  ipcMain.handle('security:listAccounts', () => store.listConnectedAccounts());
  ipcMain.handle('security:startOAuthConnect', (_event, provider, accessLevel) => store.startOAuthConnect(provider, accessLevel));
  ipcMain.handle('security:finishOAuthConnect', (_event, input) => store.finishOAuthConnect(input));
  ipcMain.handle('security:disconnectAccount', (_event, accountId) => store.disconnectAccount(accountId));
  ipcMain.handle('security:revokeAccount', (_event, accountId) => store.revokeAccount(accountId));
  ipcMain.handle('security:listTrustedDevices', () => store.listTrustedDevices());
  ipcMain.handle('security:createPairingApproval', (_event, label) => store.createPairingApproval(label));
  ipcMain.handle('security:approvePairing', (_event, input) => store.approvePairing(input));
  ipcMain.handle('security:revokeTrustedDevice', (_event, deviceId) => store.revokeTrustedDevice(deviceId));
  ipcMain.handle('hosted:getState', () => store.getHostedSyncState());
  ipcMain.handle('hosted:startConnect', (_event, baseUrl, provider) => store.startHostedSyncConnect(baseUrl, provider));
  ipcMain.handle('hosted:pollAuth', () => store.pollHostedSyncAuth());
  ipcMain.handle('hosted:syncNow', () => store.syncHostedNow());
  ipcMain.handle('hosted:disconnect', () => store.disconnectHostedSync());
  ipcMain.handle('security:beginReauth', (_event, action) => store.beginReauth(action));
  ipcMain.handle('security:completeReauth', (_event, challengeId, response) => store.completeReauth(challengeId, response));
  ipcMain.handle('security:exportSecureData', (_event, approvalId) => store.exportSecureData(approvalId));
  ipcMain.handle('security:rotateMasterKey', (_event, approvalId) => store.rotateMasterKey(approvalId));
}
module.exports = {
  registerCalendarHandlers
};

/***/ },

/***/ "./src/security/crypto-service.js"
/*!****************************************!*\
  !*** ./src/security/crypto-service.js ***!
  \****************************************/
(module, __unused_webpack_exports, __webpack_require__) {

const crypto = __webpack_require__(/*! node:crypto */ "node:crypto");
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
    const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return JSON.stringify({
      v: CIPHER_VERSION,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: encrypted.toString('base64')
    });
  }
  decryptText(payload, context = 'calendar-app') {
    const envelope = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (envelope?.v !== CIPHER_VERSION) {
      throw new Error(`Unsupported cipher payload version: ${envelope?.v}`);
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]).toString('utf8');
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
  CryptoService
};

/***/ },

/***/ "./src/security/hosted-sync-service.js"
/*!*********************************************!*\
  !*** ./src/security/hosted-sync-service.js ***!
  \*********************************************/
(module, __unused_webpack_exports, __webpack_require__) {

const crypto = __webpack_require__(/*! node:crypto */ "node:crypto");
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
function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`;
  }
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}
function buildSignedRequestPayload({
  method,
  urlPath,
  timestamp,
  nonce,
  body
}) {
  return [String(method || 'GET').toUpperCase(), urlPath || '/', String(timestamp || ''), String(nonce || ''), sha256(stableStringify(body || {}))].join('\n');
}
function buildEnvelopePayload(envelope) {
  return JSON.stringify({
    deviceId: envelope.deviceId,
    deviceSequence: envelope.deviceSequence,
    entity: envelope.entity,
    entityId: envelope.entityId,
    operation: envelope.operation,
    contentPatch: envelope.contentPatch || null,
    encryptedPatch: envelope.encryptedPatch || null,
    metadataPatch: envelope.metadataPatch || {},
    nonce: envelope.nonce,
    clientTimestamp: envelope.clientTimestamp
  });
}
function parseJson(value, fallback) {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}
function isLoopbackHost(hostname) {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(hostname || '').toLowerCase());
}
function normalizeBaseUrl(candidate) {
  let parsedUrl;
  try {
    parsedUrl = new URL(String(candidate || '').trim());
  } catch (_error) {
    throw new Error('Hosted backend URL must be a valid URL.');
  }
  if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
    throw new Error('Hosted backend URL must use HTTP or HTTPS.');
  }
  if (parsedUrl.protocol === 'http:' && !isLoopbackHost(parsedUrl.hostname)) {
    throw new Error('Hosted backend must use HTTPS unless it is running on localhost.');
  }
  parsedUrl.hash = '';
  parsedUrl.search = '';
  return parsedUrl.toString().replace(/\/$/, '');
}
class HostedSyncService {
  constructor({
    db,
    cryptoService,
    deviceService,
    shell,
    fetchImpl = fetch,
    onAudit,
    callbacks
  }) {
    this.db = db;
    this.cryptoService = cryptoService;
    this.deviceService = deviceService;
    this.shell = shell;
    this.fetchImpl = fetchImpl;
    this.onAudit = onAudit;
    this.callbacks = callbacks || {};
    this.stateId = 'default';
  }
  initializeSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hosted_sync_state (
        state_id TEXT PRIMARY KEY,
        base_url TEXT,
        provider TEXT,
        connection_status TEXT NOT NULL DEFAULT 'disconnected',
        backend_claimed INTEGER NOT NULL DEFAULT 0,
        enabled_providers_json TEXT NOT NULL DEFAULT '[]',
        pending_auth_state TEXT,
        pending_flow_type TEXT,
        pending_auth_expires_at TEXT,
        account_email TEXT,
        display_name TEXT,
        session_id TEXT,
        access_token_cipher_text TEXT,
        refresh_token_cipher_text TEXT,
        access_token_expires_at TEXT,
        refresh_token_expires_at TEXT,
        server_cursor INTEGER NOT NULL DEFAULT 0,
        last_pushed_sequence INTEGER NOT NULL DEFAULT 0,
        last_synced_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const existing = this.db.prepare(`SELECT state_id AS stateId
         FROM hosted_sync_state
         WHERE state_id = :stateId`).get({
      stateId: this.stateId
    });
    if (!existing) {
      const timestamp = nowIso();
      this.db.prepare(`INSERT INTO hosted_sync_state (
            state_id,
            connection_status,
            backend_claimed,
            enabled_providers_json,
            server_cursor,
            last_pushed_sequence,
            created_at,
            updated_at
          ) VALUES (
            :stateId,
            'disconnected',
            0,
            '[]',
            0,
            0,
            :createdAt,
            :updatedAt
          )`).run({
        stateId: this.stateId,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }
  }
  getStateRow() {
    return this.db.prepare(`SELECT
          state_id AS stateId,
          base_url AS baseUrl,
          provider,
          connection_status AS connectionStatus,
          backend_claimed AS backendClaimed,
          enabled_providers_json AS enabledProvidersJson,
          pending_auth_state AS pendingAuthState,
          pending_flow_type AS pendingFlowType,
          pending_auth_expires_at AS pendingAuthExpiresAt,
          account_email AS accountEmail,
          display_name AS displayName,
          session_id AS sessionId,
          access_token_cipher_text AS accessTokenCipherText,
          refresh_token_cipher_text AS refreshTokenCipherText,
          access_token_expires_at AS accessTokenExpiresAt,
          refresh_token_expires_at AS refreshTokenExpiresAt,
          server_cursor AS serverCursor,
          last_pushed_sequence AS lastPushedSequence,
          last_synced_at AS lastSyncedAt,
          last_error AS lastError,
          created_at AS createdAt,
          updated_at AS updatedAt
         FROM hosted_sync_state
         WHERE state_id = :stateId`).get({
      stateId: this.stateId
    });
  }
  updateState(patch = {}) {
    const current = this.getStateRow();
    const nextState = {
      ...current,
      ...patch,
      updatedAt: nowIso()
    };
    this.db.prepare(`UPDATE hosted_sync_state
         SET
           base_url = :baseUrl,
           provider = :provider,
           connection_status = :connectionStatus,
           backend_claimed = :backendClaimed,
           enabled_providers_json = :enabledProvidersJson,
           pending_auth_state = :pendingAuthState,
           pending_flow_type = :pendingFlowType,
           pending_auth_expires_at = :pendingAuthExpiresAt,
           account_email = :accountEmail,
           display_name = :displayName,
           session_id = :sessionId,
           access_token_cipher_text = :accessTokenCipherText,
           refresh_token_cipher_text = :refreshTokenCipherText,
           access_token_expires_at = :accessTokenExpiresAt,
           refresh_token_expires_at = :refreshTokenExpiresAt,
           server_cursor = :serverCursor,
           last_pushed_sequence = :lastPushedSequence,
           last_synced_at = :lastSyncedAt,
           last_error = :lastError,
           updated_at = :updatedAt
         WHERE state_id = :stateId`).run(nextState);
    return this.getState();
  }
  getState() {
    const row = this.getStateRow();
    return {
      enabled: Boolean(row?.baseUrl),
      baseUrl: row?.baseUrl || '',
      provider: row?.provider || null,
      connectionStatus: row?.connectionStatus || 'disconnected',
      backendClaimed: Boolean(row?.backendClaimed),
      enabledProviders: parseJson(row?.enabledProvidersJson, []),
      pendingAuthState: row?.pendingAuthState || null,
      pendingFlowType: row?.pendingFlowType || null,
      pendingAuthExpiresAt: row?.pendingAuthExpiresAt || null,
      accountEmail: row?.accountEmail || null,
      displayName: row?.displayName || null,
      sessionId: row?.sessionId || null,
      accessTokenExpiresAt: row?.accessTokenExpiresAt || null,
      refreshTokenExpiresAt: row?.refreshTokenExpiresAt || null,
      serverCursor: Number(row?.serverCursor || 0),
      lastPushedSequence: Number(row?.lastPushedSequence || 0),
      lastSyncedAt: row?.lastSyncedAt || null,
      lastError: row?.lastError || null,
      createdAt: row?.createdAt || null,
      updatedAt: row?.updatedAt || null
    };
  }
  getStoredTokens() {
    const row = this.getStateRow();
    return {
      accessToken: row?.accessTokenCipherText ? this.cryptoService.decryptText(row.accessTokenCipherText, 'hosted-sync:access-token') : null,
      refreshToken: row?.refreshTokenCipherText ? this.cryptoService.decryptText(row.refreshTokenCipherText, 'hosted-sync:refresh-token') : null,
      accessTokenExpiresAt: row?.accessTokenExpiresAt || null,
      refreshTokenExpiresAt: row?.refreshTokenExpiresAt || null,
      sessionId: row?.sessionId || null,
      baseUrl: row?.baseUrl || null
    };
  }
  async parseResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return response.json();
    }
    const text = await response.text();
    return text ? {
      message: text
    } : {};
  }
  async requestJson({
    method = 'GET',
    baseUrl,
    path,
    body,
    accessToken,
    signed
  }) {
    const headers = {
      Accept: 'application/json'
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    if (signed) {
      const timestamp = nowIso();
      const nonce = randomToken(16);
      const payload = buildSignedRequestPayload({
        method,
        urlPath: path,
        timestamp,
        nonce,
        body: body || {}
      });
      headers['X-Device-Id'] = signed.deviceId;
      headers['X-Request-Timestamp'] = timestamp;
      headers['X-Request-Nonce'] = nonce;
      headers['X-Request-Signature'] = this.deviceService.signPayload(payload);
    }
    const response = await this.fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await this.parseResponse(response);
    if (!response.ok) {
      const error = new Error(payload?.message || `Hosted backend request failed with status ${response.status}.`);
      error.statusCode = response.status;
      error.code = payload?.error || 'hosted_backend_request_failed';
      error.details = payload?.details;
      throw error;
    }
    return payload;
  }
  async startAuth(provider, baseUrl) {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const bootstrap = await this.requestJson({
      method: 'GET',
      baseUrl: normalizedBaseUrl,
      path: '/v1/bootstrap/status'
    });
    if (!Array.isArray(bootstrap.enabledProviders) || !bootstrap.enabledProviders.includes(provider)) {
      throw new Error(`${provider} is not enabled on this backend.`);
    }
    const localDevice = this.deviceService.getLocalDeviceProfile();
    const currentState = this.getState();
    const resetSyncCursors = currentState.baseUrl && currentState.baseUrl !== normalizedBaseUrl;
    const flow = await this.requestJson({
      method: 'POST',
      baseUrl: normalizedBaseUrl,
      path: `/v1/auth/${provider}/start`,
      body: {
        deviceId: localDevice.deviceId,
        deviceLabel: localDevice.label,
        devicePublicKey: localDevice.publicKey
      }
    });
    this.updateState({
      baseUrl: normalizedBaseUrl,
      provider,
      connectionStatus: 'pending_auth',
      backendClaimed: bootstrap.claimed ? 1 : 0,
      enabledProvidersJson: JSON.stringify(bootstrap.enabledProviders || []),
      pendingAuthState: flow.state,
      pendingFlowType: flow.flowType,
      pendingAuthExpiresAt: flow.expiresAt,
      accessTokenCipherText: null,
      refreshTokenCipherText: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      sessionId: null,
      lastError: null,
      accountEmail: null,
      displayName: null,
      ...(resetSyncCursors ? {
        serverCursor: 0,
        lastPushedSequence: 0,
        lastSyncedAt: null
      } : {})
    });
    this.onAudit?.('hosted_auth_started', {
      targetType: 'hosted_backend',
      targetId: normalizedBaseUrl,
      details: {
        provider,
        flowType: flow.flowType
      }
    });
    if (this.shell?.openExternal) {
      await this.shell.openExternal(flow.authorizationUrl);
    }
    return {
      hosted: this.getState(),
      flow
    };
  }
  async pollAuthFlow() {
    const state = this.getState();
    if (!state.baseUrl || !state.pendingAuthState) {
      throw new Error('There is no pending hosted sign-in flow.');
    }
    const result = await this.requestJson({
      method: 'GET',
      baseUrl: state.baseUrl,
      path: `/v1/auth/flows/${encodeURIComponent(state.pendingAuthState)}`
    });
    if (result.status === 'completed' && result.result?.session) {
      this.updateState({
        connectionStatus: 'connected',
        pendingAuthState: null,
        pendingFlowType: null,
        pendingAuthExpiresAt: null,
        accountEmail: result.result.user?.email || null,
        displayName: result.result.user?.displayName || null,
        sessionId: result.result.session.sessionId,
        accessTokenCipherText: this.cryptoService.encryptText(result.result.session.accessToken, 'hosted-sync:access-token'),
        refreshTokenCipherText: this.cryptoService.encryptText(result.result.session.refreshToken, 'hosted-sync:refresh-token'),
        accessTokenExpiresAt: result.result.session.accessTokenExpiresAt,
        refreshTokenExpiresAt: result.result.session.refreshExpiresAt,
        lastError: null
      });
      this.onAudit?.('hosted_auth_completed', {
        targetType: 'hosted_backend',
        targetId: state.baseUrl,
        details: {
          provider: state.provider,
          accountEmail: result.result.user?.email || null
        }
      });
    } else if (result.status === 'failed') {
      this.updateState({
        connectionStatus: state.baseUrl ? 'configured' : 'disconnected',
        pendingAuthState: null,
        pendingFlowType: null,
        pendingAuthExpiresAt: null,
        lastError: result.errorCode || 'Hosted sign-in failed.'
      });
    }
    return {
      hosted: this.getState(),
      flow: result
    };
  }
  async refreshSession() {
    const currentState = this.getState();
    const tokens = this.getStoredTokens();
    if (!tokens.baseUrl || !tokens.refreshToken) {
      throw new Error('Hosted backend refresh token is missing.');
    }
    const session = await this.requestJson({
      method: 'POST',
      baseUrl: tokens.baseUrl,
      path: '/v1/auth/refresh',
      body: {
        refreshToken: tokens.refreshToken
      }
    });
    this.updateState({
      connectionStatus: 'connected',
      sessionId: session.sessionId,
      accessTokenCipherText: this.cryptoService.encryptText(session.accessToken, 'hosted-sync:access-token'),
      refreshTokenCipherText: this.cryptoService.encryptText(session.refreshToken, 'hosted-sync:refresh-token'),
      accessTokenExpiresAt: session.accessTokenExpiresAt,
      refreshTokenExpiresAt: session.refreshExpiresAt,
      lastError: null,
      provider: currentState.provider,
      baseUrl: currentState.baseUrl
    });
    return session.accessToken;
  }
  async ensureAccessToken() {
    const state = this.getState();
    const tokens = this.getStoredTokens();
    if (!state.baseUrl || !tokens.refreshToken) {
      throw new Error('Hosted backend is not signed in yet.');
    }
    if (tokens.accessToken && tokens.accessTokenExpiresAt) {
      const accessExpiry = new Date(tokens.accessTokenExpiresAt).getTime();
      if (accessExpiry - Date.now() > 30 * 1000) {
        return tokens.accessToken;
      }
    }
    const refreshExpiry = tokens.refreshTokenExpiresAt ? new Date(tokens.refreshTokenExpiresAt).getTime() : 0;
    if (refreshExpiry && refreshExpiry <= Date.now()) {
      this.updateState({
        connectionStatus: state.baseUrl ? 'configured' : 'disconnected',
        accessTokenCipherText: null,
        refreshTokenCipherText: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        sessionId: null,
        lastError: 'Hosted backend session expired. Sign in again.'
      });
      throw new Error('Hosted backend session expired. Sign in again.');
    }
    return this.refreshSession();
  }
  async authorizedRequest(input, allowRetry = true) {
    const accessToken = await this.ensureAccessToken();
    const state = this.getState();
    try {
      return await this.requestJson({
        ...input,
        baseUrl: state.baseUrl,
        accessToken
      });
    } catch (error) {
      if (allowRetry && error.statusCode === 401) {
        await this.refreshSession();
        return this.authorizedRequest(input, false);
      }
      throw error;
    }
  }
  async disconnect() {
    const state = this.getState();
    const baseUrl = state.baseUrl;
    try {
      if (state.connectionStatus === 'connected') {
        await this.authorizedRequest({
          method: 'POST',
          path: '/v1/auth/logout',
          body: {}
        });
      }
    } catch (_error) {
      // The local disconnect path should still succeed even if the remote session is already gone.
    }
    this.updateState({
      connectionStatus: baseUrl ? 'configured' : 'disconnected',
      pendingAuthState: null,
      pendingFlowType: null,
      pendingAuthExpiresAt: null,
      accountEmail: null,
      displayName: null,
      sessionId: null,
      accessTokenCipherText: null,
      refreshTokenCipherText: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      lastError: null
    });
    this.onAudit?.('hosted_auth_disconnected', {
      targetType: 'hosted_backend',
      targetId: baseUrl || 'unconfigured'
    });
    return this.getState();
  }
  async syncNow() {
    const state = this.getState();
    if (!state.baseUrl) {
      throw new Error('Configure a hosted backend URL first.');
    }
    if (state.connectionStatus !== 'connected') {
      throw new Error('Sign in to the hosted backend before syncing.');
    }
    const localDevice = this.deviceService.getLocalDeviceProfile();
    const firstSync = state.serverCursor === 0 && state.lastPushedSequence === 0;
    if (firstSync) {
      this.callbacks.prepareHostedBootstrap?.();
    }
    const initialPull = await this.authorizedRequest({
      method: 'GET',
      path: `/v1/sync/pull?since=${encodeURIComponent(state.serverCursor)}`
    });
    let appliedRemote = 0;
    for (const envelope of initialPull.envelopes || []) {
      if (envelope.deviceId === localDevice.deviceId) {
        continue;
      }
      this.callbacks.applyEnvelope?.(envelope);
      appliedRemote += 1;
    }
    let nextCursor = Number(initialPull.nextCursor || state.serverCursor || 0);
    const localEnvelopes = this.callbacks.listEnvelopesSince?.(state.lastPushedSequence) || [];
    let pushedCount = 0;
    let duplicateCount = 0;
    let lastPushedSequence = state.lastPushedSequence;
    if (localEnvelopes.length > 0) {
      const signedEnvelopes = localEnvelopes.map(envelope => ({
        ...envelope,
        signature: this.deviceService.signPayload(buildEnvelopePayload(envelope)),
        signatureKeyId: localDevice.deviceId
      }));
      const pushResult = await this.authorizedRequest({
        method: 'POST',
        path: '/v1/sync/push',
        body: {
          envelopes: signedEnvelopes
        },
        signed: {
          deviceId: localDevice.deviceId
        }
      });
      pushedCount = pushResult.accepted?.length || 0;
      duplicateCount = pushResult.duplicates?.length || 0;
      lastPushedSequence = Math.max(state.lastPushedSequence, ...signedEnvelopes.map(envelope => Number(envelope.deviceSequence || 0)));
      const secondPull = await this.authorizedRequest({
        method: 'GET',
        path: `/v1/sync/pull?since=${encodeURIComponent(nextCursor)}`
      });
      for (const envelope of secondPull.envelopes || []) {
        if (envelope.deviceId === localDevice.deviceId) {
          continue;
        }
        this.callbacks.applyEnvelope?.(envelope);
        appliedRemote += 1;
      }
      nextCursor = Number(secondPull.nextCursor || nextCursor || 0);
    }
    this.updateState({
      connectionStatus: 'connected',
      serverCursor: nextCursor,
      lastPushedSequence,
      lastSyncedAt: nowIso(),
      lastError: null
    });
    this.onAudit?.('hosted_sync_completed', {
      targetType: 'hosted_backend',
      targetId: state.baseUrl,
      details: {
        pushedCount,
        duplicateCount,
        pulledCount: appliedRemote,
        serverCursor: nextCursor
      }
    });
    return {
      hosted: this.getState(),
      sync: {
        pushedCount,
        duplicateCount,
        pulledCount: appliedRemote,
        serverCursor: nextCursor
      }
    };
  }
}
module.exports = {
  HostedSyncService,
  buildSignedRequestPayload,
  buildEnvelopePayload,
  normalizeBaseUrl,
  stableStringify
};

/***/ },

/***/ "./src/security/oauth-service.js"
/*!***************************************!*\
  !*** ./src/security/oauth-service.js ***!
  \***************************************/
(module, __unused_webpack_exports, __webpack_require__) {

const crypto = __webpack_require__(/*! node:crypto */ "node:crypto");
function nowIso() {
  return new Date().toISOString();
}
function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') {
    return null;
  }
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (_error) {
    return null;
  }
}
class OAuthService {
  constructor({
    db,
    cryptoService,
    shell,
    onAudit
  }) {
    this.db = db;
    this.cryptoService = cryptoService;
    this.shell = shell;
    this.onAudit = onAudit;
  }
  getProviders() {
    return [{
      id: 'google',
      label: 'Google',
      configured: Boolean(process.env.CALENDAR_GOOGLE_CLIENT_ID),
      delegatedOnly: true,
      readScopes: ['openid', 'profile', 'email', 'https://www.googleapis.com/auth/calendar.readonly'],
      writeScopes: ['https://www.googleapis.com/auth/calendar.events']
    }, {
      id: 'microsoft',
      label: 'Microsoft',
      configured: Boolean(process.env.CALENDAR_MICROSOFT_CLIENT_ID),
      delegatedOnly: true,
      readScopes: ['openid', 'profile', 'email', 'offline_access', 'Calendars.Read'],
      writeScopes: ['Calendars.ReadWrite']
    }];
  }
  getProviderConfig(provider) {
    if (provider === 'google') {
      const clientId = process.env.CALENDAR_GOOGLE_CLIENT_ID;
      return {
        provider,
        clientId,
        authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        revokeUrl: 'https://oauth2.googleapis.com/revoke',
        redirectUri: process.env.CALENDAR_GOOGLE_REDIRECT_URI || 'http://127.0.0.1:45781/oauth/google/callback',
        readScopes: ['openid', 'profile', 'email', 'https://www.googleapis.com/auth/calendar.readonly'],
        writeScopes: ['https://www.googleapis.com/auth/calendar.events'],
        extraParams: {
          access_type: 'offline',
          prompt: 'consent'
        }
      };
    }
    if (provider === 'microsoft') {
      const clientId = process.env.CALENDAR_MICROSOFT_CLIENT_ID;
      return {
        provider,
        clientId,
        authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
        tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
        revokeUrl: null,
        redirectUri: process.env.CALENDAR_MICROSOFT_REDIRECT_URI || 'http://127.0.0.1:45782/oauth/microsoft/callback',
        readScopes: ['openid', 'profile', 'email', 'offline_access', 'Calendars.Read'],
        writeScopes: ['Calendars.ReadWrite'],
        extraParams: {}
      };
    }
    throw new Error(`Unsupported OAuth provider: ${provider}`);
  }
  listConnectedAccounts() {
    return this.db.prepare(`SELECT
          account_id AS accountId,
          provider,
          subject,
          email,
          display_name AS displayName,
          permission_mode AS permissionMode,
          status,
          can_write AS canWrite,
          write_scope_granted AS writeScopeGranted,
          created_at AS createdAt,
          updated_at AS updatedAt,
          last_sync_at AS lastSyncAt
         FROM connected_accounts
         ORDER BY created_at ASC`).all().map(row => ({
      ...row,
      canWrite: Boolean(row.canWrite),
      writeScopeGranted: Boolean(row.writeScopeGranted)
    }));
  }
  buildScopes(config, accessLevel = 'read') {
    const scopes = [...config.readScopes];
    if (accessLevel === 'write') {
      scopes.push(...config.writeScopes);
    }
    return Array.from(new Set(scopes));
  }
  startConnect(provider, accessLevel = 'read') {
    const config = this.getProviderConfig(provider);
    if (!config.clientId) {
      throw new Error(`${provider} OAuth is not configured yet. Add the client ID first.`);
    }
    const state = crypto.randomUUID();
    const codeVerifier = this.cryptoService.randomToken(48);
    const codeChallenge = this.cryptoService.pkceChallenge(codeVerifier);
    const scopes = this.buildScopes(config, accessLevel);
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    this.db.prepare(`INSERT INTO oauth_flows (
          state,
          provider,
          requested_access,
          redirect_uri,
          code_verifier_cipher_text,
          created_at,
          expires_at
        ) VALUES (
          :state,
          :provider,
          :requestedAccess,
          :redirectUri,
          :codeVerifierCipherText,
          :createdAt,
          :expiresAt
        )`).run({
      state,
      provider,
      requestedAccess: accessLevel,
      redirectUri: config.redirectUri,
      codeVerifierCipherText: this.cryptoService.encryptText(codeVerifier, `oauth-flow:${state}`),
      createdAt,
      expiresAt
    });
    const authorizationUrl = new URL(config.authUrl);
    authorizationUrl.searchParams.set('client_id', config.clientId);
    authorizationUrl.searchParams.set('response_type', 'code');
    authorizationUrl.searchParams.set('redirect_uri', config.redirectUri);
    authorizationUrl.searchParams.set('scope', scopes.join(' '));
    authorizationUrl.searchParams.set('state', state);
    authorizationUrl.searchParams.set('code_challenge', codeChallenge);
    authorizationUrl.searchParams.set('code_challenge_method', 'S256');
    for (const [key, value] of Object.entries(config.extraParams || {})) {
      authorizationUrl.searchParams.set(key, value);
    }
    this.onAudit?.('oauth_connect_started', {
      targetType: 'provider',
      targetId: provider,
      details: {
        accessLevel,
        state
      }
    });
    if (this.shell?.openExternal) {
      this.shell.openExternal(authorizationUrl.toString());
    }
    return {
      provider,
      accessLevel,
      state,
      redirectUri: config.redirectUri,
      authorizationUrl: authorizationUrl.toString(),
      expiresAt
    };
  }
  async finishConnect({
    provider,
    state,
    code
  }) {
    const config = this.getProviderConfig(provider);
    const flow = this.db.prepare(`SELECT
          state,
          provider,
          requested_access AS requestedAccess,
          redirect_uri AS redirectUri,
          code_verifier_cipher_text AS codeVerifierCipherText,
          expires_at AS expiresAt
         FROM oauth_flows
         WHERE state = :state`).get({
      state
    });
    if (!flow || flow.provider !== provider) {
      throw new Error('OAuth flow was not found.');
    }
    if (new Date(flow.expiresAt).getTime() < Date.now()) {
      throw new Error('OAuth flow has expired.');
    }
    const codeVerifier = this.cryptoService.decryptText(flow.codeVerifierCipherText, `oauth-flow:${state}`);
    const tokenResponse = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: config.clientId,
        grant_type: 'authorization_code',
        code,
        redirect_uri: flow.redirectUri,
        code_verifier: codeVerifier
      })
    });
    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new Error(`OAuth token exchange failed: ${errorText}`);
    }
    const tokenPayload = await tokenResponse.json();
    const identity = decodeJwtPayload(tokenPayload.id_token) || {};
    const accountId = `acct_${crypto.randomUUID()}`;
    const tokenId = `token_${crypto.randomUUID()}`;
    const timestamp = nowIso();
    const canWrite = flow.requestedAccess === 'write';
    const scopeSet = String(tokenPayload.scope || this.buildScopes(config, flow.requestedAccess).join(' '));
    this.db.exec('BEGIN');
    try {
      this.db.prepare(`INSERT INTO connected_accounts (
            account_id,
            provider,
            subject,
            email,
            display_name,
            permission_mode,
            status,
            can_write,
            write_scope_granted,
            created_at,
            updated_at
          ) VALUES (
            :accountId,
            :provider,
            :subject,
            :email,
            :displayName,
            :permissionMode,
            'connected',
            :canWrite,
            :writeScopeGranted,
            :createdAt,
            :updatedAt
          )`).run({
        accountId,
        provider,
        subject: identity.sub || identity.oid || null,
        email: identity.email || identity.preferred_username || null,
        displayName: identity.name || identity.given_name || provider,
        permissionMode: flow.requestedAccess,
        canWrite: canWrite ? 1 : 0,
        writeScopeGranted: canWrite ? 1 : 0,
        createdAt: timestamp,
        updatedAt: timestamp
      });
      this.db.prepare(`INSERT INTO token_records (
            token_id,
            account_id,
            provider,
            scope_set,
            access_token_cipher_text,
            refresh_token_cipher_text,
            expires_at,
            created_at,
            updated_at
          ) VALUES (
            :tokenId,
            :accountId,
            :provider,
            :scopeSet,
            :accessTokenCipherText,
            :refreshTokenCipherText,
            :expiresAt,
            :createdAt,
            :updatedAt
          )`).run({
        tokenId,
        accountId,
        provider,
        scopeSet,
        accessTokenCipherText: tokenPayload.access_token ? this.cryptoService.encryptText(tokenPayload.access_token, `oauth-token:${tokenId}:access`) : null,
        refreshTokenCipherText: tokenPayload.refresh_token ? this.cryptoService.encryptText(tokenPayload.refresh_token, `oauth-token:${tokenId}:refresh`) : null,
        expiresAt: tokenPayload.expires_in ? new Date(Date.now() + Number(tokenPayload.expires_in) * 1000).toISOString() : null,
        createdAt: timestamp,
        updatedAt: timestamp
      });
      this.db.prepare('DELETE FROM oauth_flows WHERE state = :state').run({
        state
      });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    this.onAudit?.('oauth_connect_completed', {
      targetType: 'account',
      targetId: accountId,
      details: {
        provider,
        permissionMode: flow.requestedAccess
      }
    });
    return this.listConnectedAccounts().find(account => account.accountId === accountId);
  }
  disconnectAccount(accountId) {
    const timestamp = nowIso();
    const account = this.db.prepare(`SELECT account_id AS accountId, provider
         FROM connected_accounts
         WHERE account_id = :accountId`).get({
      accountId
    });
    if (!account) {
      throw new Error('Connected account not found.');
    }
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM token_records WHERE account_id = :accountId').run({
        accountId
      });
      this.db.prepare(`UPDATE connected_accounts
           SET status = 'disconnected', updated_at = :updatedAt
           WHERE account_id = :accountId`).run({
        accountId,
        updatedAt: timestamp
      });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    this.onAudit?.('oauth_account_disconnected', {
      targetType: 'account',
      targetId: accountId,
      details: {
        provider: account.provider
      }
    });
    return {
      accountId,
      status: 'disconnected'
    };
  }
  async revokeAccount(accountId) {
    const account = this.db.prepare(`SELECT
          a.account_id AS accountId,
          a.provider,
          t.token_id AS tokenId,
          t.refresh_token_cipher_text AS refreshTokenCipherText,
          t.access_token_cipher_text AS accessTokenCipherText
         FROM connected_accounts a
         LEFT JOIN token_records t ON t.account_id = a.account_id
         WHERE a.account_id = :accountId
         LIMIT 1`).get({
      accountId
    });
    if (!account) {
      throw new Error('Connected account not found.');
    }
    const config = this.getProviderConfig(account.provider);
    const refreshToken = account.refreshTokenCipherText ? this.cryptoService.decryptText(account.refreshTokenCipherText, `oauth-token:${account.tokenId}:refresh`) : null;
    const accessToken = account.accessTokenCipherText ? this.cryptoService.decryptText(account.accessTokenCipherText, `oauth-token:${account.tokenId}:access`) : null;
    if (config.revokeUrl && (refreshToken || accessToken)) {
      await fetch(config.revokeUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          token: refreshToken || accessToken
        })
      });
    }
    const disconnected = this.disconnectAccount(accountId);
    this.onAudit?.('oauth_account_revoked', {
      targetType: 'account',
      targetId: accountId,
      details: {
        provider: account.provider,
        remoteRevocationAttempted: Boolean(config.revokeUrl)
      }
    });
    return disconnected;
  }
}
module.exports = {
  OAuthService
};

/***/ },

/***/ "./src/security/reauth-service.js"
/*!****************************************!*\
  !*** ./src/security/reauth-service.js ***!
  \****************************************/
(module, __unused_webpack_exports, __webpack_require__) {

const crypto = __webpack_require__(/*! node:crypto */ "node:crypto");
function nowMs() {
  return Date.now();
}
class ReauthService {
  constructor() {
    this.pendingChallenges = new Map();
    this.approvedActions = new Map();
    this.challengeLifetimeMs = 5 * 60 * 1000;
    this.approvalLifetimeMs = 10 * 60 * 1000;
  }
  pruneExpiredEntries() {
    const now = nowMs();
    for (const [challengeId, challenge] of this.pendingChallenges.entries()) {
      if (challenge.expiresAt <= now) {
        this.pendingChallenges.delete(challengeId);
      }
    }
    for (const [approvalId, approval] of this.approvedActions.entries()) {
      if (approval.expiresAt <= now) {
        this.approvedActions.delete(approvalId);
      }
    }
  }
  begin(action) {
    this.pruneExpiredEntries();
    const challengeId = crypto.randomUUID();
    const confirmationPhrase = `APPROVE-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const expiresAt = nowMs() + this.challengeLifetimeMs;
    this.pendingChallenges.set(challengeId, {
      action,
      confirmationPhrase,
      expiresAt
    });
    return {
      challengeId,
      action,
      confirmationPhrase,
      expiresAt: new Date(expiresAt).toISOString()
    };
  }
  complete(challengeId, response) {
    this.pruneExpiredEntries();
    const challenge = this.pendingChallenges.get(challengeId);
    if (!challenge) {
      throw new Error('Reauthentication challenge not found or expired.');
    }
    if (String(response || '').trim() !== challenge.confirmationPhrase) {
      throw new Error('Reauthentication response did not match the approval phrase.');
    }
    this.pendingChallenges.delete(challengeId);
    const approvalId = crypto.randomUUID();
    const expiresAt = nowMs() + this.approvalLifetimeMs;
    this.approvedActions.set(approvalId, {
      action: challenge.action,
      expiresAt
    });
    return {
      approvalId,
      action: challenge.action,
      expiresAt: new Date(expiresAt).toISOString()
    };
  }
  consumeApproval(action, approvalId) {
    this.pruneExpiredEntries();
    const approval = this.approvedActions.get(approvalId);
    if (!approval || approval.action !== action) {
      throw new Error(`A fresh reauthentication approval is required for ${action}.`);
    }
    this.approvedActions.delete(approvalId);
    return true;
  }
}
module.exports = {
  ReauthService
};

/***/ },

/***/ "./src/security/secure-vault.js"
/*!**************************************!*\
  !*** ./src/security/secure-vault.js ***!
  \**************************************/
(module, __unused_webpack_exports, __webpack_require__) {

const crypto = __webpack_require__(/*! node:crypto */ "node:crypto");
const fs = __webpack_require__(/*! node:fs */ "node:fs");
const path = __webpack_require__(/*! node:path */ "node:path");
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
    fs.mkdirSync(path.dirname(this.vaultPath), {
      recursive: true
    });
    fs.writeFileSync(this.vaultPath, JSON.stringify(record, null, 2));
    this.cachedRecord = record;
  }
  protectString(value) {
    if (this.isPlatformProtectionAvailable()) {
      return {
        mode: 'safeStorage',
        value: this.safeStorage.encryptString(value).toString('base64')
      };
    }
    return {
      mode: 'plaintext_fallback',
      value: Buffer.from(value, 'utf8').toString('base64')
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
        protectionMode: this.loadRecord()?.masterKey?.mode || 'unknown'
      };
    }
    const existingRecord = this.loadRecord();
    if (existingRecord?.masterKey?.value) {
      this.cachedMasterKey = Buffer.from(this.unprotectString(existingRecord.masterKey), 'base64');
      return {
        key: this.cachedMasterKey,
        created: false,
        rotatedAt: existingRecord.rotatedAt || null,
        protectionMode: existingRecord.masterKey.mode
      };
    }
    const nextKey = crypto.randomBytes(32);
    const createdAt = nowIso();
    const record = {
      version: VAULT_VERSION,
      createdAt,
      rotatedAt: createdAt,
      masterKey: this.protectString(nextKey.toString('base64')),
      secrets: {}
    };
    this.saveRecord(record);
    this.cachedMasterKey = nextKey;
    return {
      key: nextKey,
      created: true,
      rotatedAt: createdAt,
      protectionMode: record.masterKey.mode
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
      secrets: {}
    };
    record.secrets = {
      ...(record.secrets || {}),
      [name]: this.protectString(value)
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
    const nextSecrets = {
      ...(record.secrets || {})
    };
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
      protectionMode: record.masterKey.mode
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
      degradedProtection: protectionMode !== 'safeStorage'
    };
  }
}
module.exports = {
  SecureVault
};

/***/ },

/***/ "./src/security/trusted-device-service.js"
/*!************************************************!*\
  !*** ./src/security/trusted-device-service.js ***!
  \************************************************/
(module, __unused_webpack_exports, __webpack_require__) {

const crypto = __webpack_require__(/*! node:crypto */ "node:crypto");
const os = __webpack_require__(/*! node:os */ "node:os");
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
  constructor({
    db,
    vault,
    onAudit
  }) {
    this.db = db;
    this.vault = vault;
    this.onAudit = onAudit;
    this.privateKeySecretName = 'local-device-private-key';
  }
  ensureLocalDevice(preferredDeviceId) {
    const existingLocal = this.db.prepare(`SELECT device_id AS deviceId, label, public_key AS publicKey, status, trust_level AS trustLevel
         FROM trusted_devices
         WHERE is_local = 1
         LIMIT 1`).get();
    if (existingLocal) {
      if (!this.vault.getSecret(this.privateKeySecretName)) {
        const pair = crypto.generateKeyPairSync('ed25519');
        this.vault.setSecret(this.privateKeySecretName, pair.privateKey.export({
          type: 'pkcs8',
          format: 'pem'
        }));
        this.db.prepare(`UPDATE trusted_devices
             SET public_key = :publicKey, updated_at = :updatedAt
             WHERE device_id = :deviceId`).run({
          publicKey: pair.publicKey.export({
            type: 'spki',
            format: 'pem'
          }),
          updatedAt: nowIso(),
          deviceId: existingLocal.deviceId
        });
      }
      this.touch(existingLocal.deviceId);
      return existingLocal;
    }
    const pair = crypto.generateKeyPairSync('ed25519');
    const deviceId = preferredDeviceId || createId('device');
    const timestamp = nowIso();
    this.vault.setSecret(this.privateKeySecretName, pair.privateKey.export({
      type: 'pkcs8',
      format: 'pem'
    }));
    this.db.prepare(`INSERT INTO trusted_devices (
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
        )`).run({
      deviceId,
      label: `${os.hostname()} (${process.platform})`,
      publicKey: pair.publicKey.export({
        type: 'spki',
        format: 'pem'
      }),
      createdAt: timestamp,
      updatedAt: timestamp,
      lastSeenAt: timestamp
    });
    this.onAudit?.('device_registered', {
      targetType: 'device',
      targetId: deviceId,
      details: {
        isLocal: true
      }
    });
    return {
      deviceId,
      label: `${os.hostname()} (${process.platform})`,
      publicKey: pair.publicKey.export({
        type: 'spki',
        format: 'pem'
      }),
      status: 'active',
      trustLevel: 'full'
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
    this.db.prepare(`UPDATE trusted_devices
         SET last_seen_at = :lastSeenAt, updated_at = :updatedAt
         WHERE device_id = :deviceId`).run({
      deviceId,
      lastSeenAt: nowIso(),
      updatedAt: nowIso()
    });
  }
  listTrustedDevices() {
    return this.db.prepare(`SELECT
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
         ORDER BY is_local DESC, created_at ASC`).all().map(row => ({
      ...row,
      isLocal: Boolean(row.isLocal)
    }));
  }
  getLocalDeviceProfile() {
    const device = this.db.prepare(`SELECT
          device_id AS deviceId,
          label,
          public_key AS publicKey,
          status,
          trust_level AS trustLevel
         FROM trusted_devices
         WHERE is_local = 1
         LIMIT 1`).get();
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
    this.db.prepare(`INSERT INTO pairing_approvals (
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
        )`).run({
      approvalId,
      codeHash: hashApprovalCode(code),
      label: label || 'New device',
      expiresAt,
      createdAt: timestamp
    });
    this.onAudit?.('pairing_requested', {
      targetType: 'pairing',
      targetId: approvalId,
      details: {
        label: label || 'New device',
        expiresAt
      }
    });
    return {
      approvalId,
      code,
      expiresAt
    };
  }
  approvePairing({
    approvalId,
    code,
    candidateDeviceId,
    label,
    publicKey
  }) {
    const approval = this.db.prepare(`SELECT
          approval_id AS approvalId,
          code_hash AS codeHash,
          status,
          expires_at AS expiresAt
         FROM pairing_approvals
         WHERE approval_id = :approvalId`).get({
      approvalId
    });
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
    this.db.prepare(`INSERT OR REPLACE INTO trusted_devices (
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
        )`).run({
      deviceId,
      label: label || 'Trusted device',
      publicKey,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastSeenAt: timestamp
    });
    this.db.prepare(`UPDATE pairing_approvals
         SET candidate_device_id = :candidateDeviceId,
             public_key = :publicKey,
             approved_by = :approvedBy,
             status = 'approved',
             approved_at = :approvedAt
         WHERE approval_id = :approvalId`).run({
      approvalId,
      candidateDeviceId: deviceId,
      publicKey,
      approvedBy: this.listTrustedDevices().find(device => device.isLocal)?.deviceId || null,
      approvedAt: timestamp
    });
    this.onAudit?.('pairing_approved', {
      targetType: 'device',
      targetId: deviceId,
      details: {
        approvalId
      }
    });
    return {
      approvalId,
      deviceId,
      label: label || 'Trusted device',
      status: 'active'
    };
  }
  revokeDevice(deviceId) {
    const device = this.db.prepare(`SELECT device_id AS deviceId, is_local AS isLocal, status
         FROM trusted_devices
         WHERE device_id = :deviceId`).get({
      deviceId
    });
    if (!device) {
      throw new Error('Trusted device not found.');
    }
    if (device.isLocal) {
      throw new Error('The local device cannot revoke itself.');
    }
    this.db.prepare(`UPDATE trusted_devices
         SET status = 'revoked', revoked_at = :revokedAt, updated_at = :updatedAt
         WHERE device_id = :deviceId`).run({
      deviceId,
      revokedAt: nowIso(),
      updatedAt: nowIso()
    });
    this.onAudit?.('device_revoked', {
      targetType: 'device',
      targetId: deviceId
    });
    return {
      deviceId,
      status: 'revoked'
    };
  }
}
module.exports = {
  TrustedDeviceService
};

/***/ },

/***/ "./src/security/validation.js"
/*!************************************!*\
  !*** ./src/security/validation.js ***!
  \************************************/
(module, __unused_webpack_exports, __webpack_require__) {

const path = __webpack_require__(/*! node:path */ "node:path");
const EVENT_TYPES = new Set(['event', 'task', 'appointment']);
const REPEAT_OPTIONS = new Set(['none', 'daily', 'weekly', 'monthly']);
const SYNC_POLICIES = new Set(['internal_only', 'google_sync', 'microsoft_sync', 'shared', 'relay_sync']);
const VISIBILITY_OPTIONS = new Set(['private', 'busy_only', 'shared_read', 'shared_edit']);
function sanitizeInlineText(value, maxLength = 160) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}
function sanitizeMultilineText(value, maxLength = 5000) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, maxLength);
}
function sanitizeColor(value, fallback = '#4f9d69') {
  const candidate = String(value ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(candidate) ? candidate.toLowerCase() : fallback;
}
function sanitizeIsoDate(value, fieldName) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid ISO timestamp.`);
  }
  return date.toISOString();
}
function sanitizeBoolean(value) {
  return Boolean(value);
}
function sanitizeUrl(value) {
  const candidate = sanitizeInlineText(value, 2048);
  if (!candidate) {
    return '';
  }
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Unsupported protocol');
    }
    return parsed.toString();
  } catch (_error) {
    throw new Error('Only HTTP and HTTPS URLs are allowed.');
  }
}
function normalizeExternalProviderLinks(links = []) {
  if (!Array.isArray(links)) {
    return [];
  }
  return links.slice(0, 8).flatMap(link => {
    const provider = sanitizeInlineText(link?.provider, 32).toLowerCase();
    const externalEventId = sanitizeInlineText(link?.externalEventId, 160);
    const url = link?.url ? sanitizeUrl(link.url) : '';
    if (!provider || !externalEventId) {
      return [];
    }
    return [{
      provider,
      externalEventId,
      url
    }];
  });
}
function normalizeTags(tags = []) {
  if (!Array.isArray(tags)) {
    return [];
  }
  const seen = new Set();
  return tags.slice(0, 20).flatMap(tag => {
    const label = sanitizeInlineText(tag?.label, 40);
    if (!label) {
      return [];
    }
    const key = label.toLowerCase();
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [{
      id: sanitizeInlineText(tag?.id, 80) || null,
      label,
      color: sanitizeColor(tag?.color, '#475569')
    }];
  });
}
function sanitizeSyncPolicy(value, fallback = 'internal_only') {
  const candidate = sanitizeInlineText(value, 40).toLowerCase();
  return SYNC_POLICIES.has(candidate) ? candidate : fallback;
}
function sanitizeVisibility(value, fallback = 'private') {
  const candidate = sanitizeInlineText(value, 40).toLowerCase();
  return VISIBILITY_OPTIONS.has(candidate) ? candidate : fallback;
}
function sanitizeEventCreateInput(input = {}) {
  const title = sanitizeInlineText(input.title, 160);
  if (!title) {
    throw new Error('Event title is required.');
  }
  const startsAt = sanitizeIsoDate(input.startsAt, 'startsAt');
  const endsAt = sanitizeIsoDate(input.endsAt, 'endsAt');
  if (new Date(endsAt) <= new Date(startsAt)) {
    throw new Error('Event end time must be after the start time.');
  }
  const type = sanitizeInlineText(input.type || 'event', 32).toLowerCase();
  if (!EVENT_TYPES.has(type)) {
    throw new Error('Unsupported event type.');
  }
  const repeat = sanitizeInlineText(input.repeat || 'none', 32).toLowerCase();
  if (!REPEAT_OPTIONS.has(repeat)) {
    throw new Error('Unsupported repeat value.');
  }
  return {
    title,
    description: sanitizeMultilineText(input.description, 5000),
    type,
    completed: sanitizeBoolean(input.completed),
    repeat,
    hasDeadline: sanitizeBoolean(input.hasDeadline),
    groupName: sanitizeInlineText(input.groupName, 120),
    startsAt,
    endsAt,
    color: sanitizeColor(input.color),
    tags: normalizeTags(input.tags),
    syncPolicy: sanitizeSyncPolicy(input.syncPolicy),
    visibility: sanitizeVisibility(input.visibility),
    externalProviderLinks: normalizeExternalProviderLinks(input.externalProviderLinks)
  };
}
function sanitizeEventUpdateInput(input = {}) {
  const sanitized = {};
  if (input.title !== undefined) {
    const title = sanitizeInlineText(input.title, 160);
    if (!title) {
      throw new Error('Event title cannot be empty.');
    }
    sanitized.title = title;
  }
  if (input.description !== undefined) {
    sanitized.description = sanitizeMultilineText(input.description, 5000);
  }
  if (input.type !== undefined) {
    const type = sanitizeInlineText(input.type, 32).toLowerCase();
    if (!EVENT_TYPES.has(type)) {
      throw new Error('Unsupported event type.');
    }
    sanitized.type = type;
  }
  if (input.repeat !== undefined) {
    const repeat = sanitizeInlineText(input.repeat, 32).toLowerCase();
    if (!REPEAT_OPTIONS.has(repeat)) {
      throw new Error('Unsupported repeat value.');
    }
    sanitized.repeat = repeat;
  }
  if (input.completed !== undefined) {
    sanitized.completed = sanitizeBoolean(input.completed);
  }
  if (input.hasDeadline !== undefined) {
    sanitized.hasDeadline = sanitizeBoolean(input.hasDeadline);
  }
  if (input.groupName !== undefined) {
    sanitized.groupName = sanitizeInlineText(input.groupName, 120);
  }
  if (input.startsAt !== undefined) {
    sanitized.startsAt = sanitizeIsoDate(input.startsAt, 'startsAt');
  }
  if (input.endsAt !== undefined) {
    sanitized.endsAt = sanitizeIsoDate(input.endsAt, 'endsAt');
  }
  if (sanitized.startsAt && sanitized.endsAt) {
    if (new Date(sanitized.endsAt) <= new Date(sanitized.startsAt)) {
      throw new Error('Event end time must be after the start time.');
    }
  }
  if (input.color !== undefined) {
    sanitized.color = sanitizeColor(input.color);
  }
  if (input.tags !== undefined) {
    sanitized.tags = normalizeTags(input.tags);
  }
  if (input.syncPolicy !== undefined) {
    sanitized.syncPolicy = sanitizeSyncPolicy(input.syncPolicy);
  }
  if (input.visibility !== undefined) {
    sanitized.visibility = sanitizeVisibility(input.visibility);
  }
  if (input.externalProviderLinks !== undefined) {
    sanitized.externalProviderLinks = normalizeExternalProviderLinks(input.externalProviderLinks);
  }
  return sanitized;
}
function validateImportPath(candidatePath, allowedBaseDir) {
  const resolvedPath = path.resolve(candidatePath);
  const resolvedBaseDir = path.resolve(allowedBaseDir);
  if (!resolvedPath.startsWith(resolvedBaseDir)) {
    throw new Error('Import path must stay within the allowed workspace.');
  }
  const extension = path.extname(resolvedPath).toLowerCase();
  if (!['.ics', '.json'].includes(extension)) {
    throw new Error('Only .ics and .json imports are allowed.');
  }
  return resolvedPath;
}
module.exports = {
  sanitizeEventCreateInput,
  sanitizeEventUpdateInput,
  validateImportPath
};

/***/ },

/***/ "electron"
/*!***************************!*\
  !*** external "electron" ***!
  \***************************/
(module) {

"use strict";
module.exports = require("electron");

/***/ },

/***/ "node:crypto"
/*!******************************!*\
  !*** external "node:crypto" ***!
  \******************************/
(module) {

"use strict";
module.exports = require("node:crypto");

/***/ },

/***/ "node:fs"
/*!**************************!*\
  !*** external "node:fs" ***!
  \**************************/
(module) {

"use strict";
module.exports = require("node:fs");

/***/ },

/***/ "node:os"
/*!**************************!*\
  !*** external "node:os" ***!
  \**************************/
(module) {

"use strict";
module.exports = require("node:os");

/***/ },

/***/ "node:path"
/*!****************************!*\
  !*** external "node:path" ***!
  \****************************/
(module) {

"use strict";
module.exports = require("node:path");

/***/ },

/***/ "node:sqlite"
/*!******************************!*\
  !*** external "node:sqlite" ***!
  \******************************/
(module) {

"use strict";
module.exports = require("node:sqlite");

/***/ },

/***/ "path"
/*!***********************!*\
  !*** external "path" ***!
  \***********************/
(module) {

"use strict";
module.exports = require("path");

/***/ }

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		if (!(moduleId in __webpack_modules__)) {
/******/ 			delete __webpack_module_cache__[moduleId];
/******/ 			var e = new Error("Cannot find module '" + moduleId + "'");
/******/ 			e.code = 'MODULE_NOT_FOUND';
/******/ 			throw e;
/******/ 		}
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be isolated against other modules in the chunk.
(() => {
/*!*********************!*\
  !*** ./src/main.js ***!
  \*********************/
const path = __webpack_require__(/*! path */ "path");
const {
  app,
  BrowserWindow,
  safeStorage,
  shell
} = __webpack_require__(/*! electron */ "electron");
const {
  CalendarStore
} = __webpack_require__(/*! ./data/calendar-store */ "./src/data/calendar-store.js");
const {
  registerCalendarHandlers
} = __webpack_require__(/*! ./ipc/calendar-ipc */ "./src/ipc/calendar-ipc.js");
const createWindow = () => {
  const preloadPath = path.join(__dirname, '..', 'renderer', 'main_window', 'preload.js');
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 780,
    minWidth: 1278,
    minHeight: 638,
    backgroundColor: '#f4efe7',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadURL('http://localhost:3001/main_window/index.html');
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({
      mode: 'detach'
    });
  }
};
app.whenReady().then(() => {
  const store = new CalendarStore(app.getPath('userData'), {
    safeStorage,
    shell
  });
  registerCalendarHandlers(store);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
})();

module.exports = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=index.js.map