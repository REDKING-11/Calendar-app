const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');

const { HolidayService } = require('./holiday-service');
const {
  CALENDAR_BUNDLE_VERSION,
  buildCalendarBundle,
  serializeCalendarBundle,
  parseCalendarBundleText,
  parseIcsText,
  serializeEventsToIcs,
} = require('./calendar-interchange');
const { CryptoService, CIPHER_VERSION } = require('../security/crypto-service');
const { HostedSyncService } = require('../security/hosted-sync-service');
const { OAuthService } = require('../security/oauth-service');
const { ReauthService } = require('../security/reauth-service');
const { SecureVault } = require('../security/secure-vault');
const { TrustedDeviceService } = require('../security/trusted-device-service');
const {
  EVENT_TITLE_MAX_LENGTH,
  normalizeEventType,
  sanitizeEventCreateInput,
  sanitizeEventUpdateInput,
  validateImportPath,
} = require('../security/validation');

function nowIso() {
  return new Date().toISOString();
}

const ALL_DAY_MINIMUM_DURATION_MS = 24 * 60 * 60 * 1000;
const HOLIDAY_SEED_STATE_META_KEY = 'holidaySeedState';
const HOLIDAY_TAG_COLOR = '#b91c1c';
const COUNTRY_TAG_COLOR = '#2563eb';
const HOLIDAY_EVENT_COLOR = '#dc2626';
const HOLIDAY_DESCRIPTION_MARKER = '[default-public-holiday]';
const LEGACY_DEMO_EVENT_TITLES = new Set([
  'Local-first architecture review',
  'Phone sync UX sketch',
  'Pairing flow test',
]);
const CURRENT_SCHEMA_VERSION = 7;
const LOCAL_TRANSPORT_SESSION_TTL_MS = 10 * 60 * 1000;
const MAX_STORED_REMINDER_MINUTES = 365 * 24 * 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

function normalizeSourceLinkStatus(value = 'active') {
  const normalized = String(value || 'active').trim().toLowerCase();
  return ['active', 'detached', 'removed'].includes(normalized) ? normalized : 'active';
}

function normalizeExternalLinkMode(value = 'imported') {
  const normalized = String(value || 'imported').trim().toLowerCase();
  return ['imported', 'outbound'].includes(normalized) ? normalized : 'imported';
}

function normalizeInviteDeliveryMode(value = 'local_only') {
  const normalized = String(value || 'local_only').trim().toLowerCase();
  return ['local_only', 'provider_invite'].includes(normalized) ? normalized : 'local_only';
}

function normalizeInviteProvider(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return ['google', 'microsoft'].includes(normalized) ? normalized : '';
}

function resolveInviteProviderFromEvent(event = {}) {
  const explicitProvider = normalizeInviteProvider(event.inviteTargetProvider);
  if (explicitProvider) {
    return explicitProvider;
  }

  if (event.syncPolicy === 'google_sync') {
    return 'google';
  }

  if (event.syncPolicy === 'microsoft_sync') {
    return 'microsoft';
  }

  return '';
}

function extractInviteeEmails(people = []) {
  const rawPeople = Array.isArray(people)
    ? people
    : String(people || '')
        .split(/[\n,;]+/g)
        .map((item) => item.trim());
  const seen = new Set();

  return rawPeople.flatMap((person) => {
    const normalized = String(person || '').trim().toLowerCase();
    if (!normalized || !EMAIL_PATTERN.test(normalized) || seen.has(normalized)) {
      return [];
    }

    seen.add(normalized);
    return [normalized];
  });
}

function normalizeTransportMode(value = 'snapshot') {
  const normalized = String(value || 'snapshot').trim().toLowerCase();
  return ['snapshot', 'delta'].includes(normalized) ? normalized : 'snapshot';
}

function cloneScopeValue(scope = 'all') {
  if (scope && typeof scope === 'object' && !Array.isArray(scope)) {
    return JSON.parse(JSON.stringify(scope));
  }

  return scope ?? 'all';
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function normalizeAllDayEventDuration(event = {}) {
  if (!event.isAllDay) {
    return event;
  }

  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return event;
  }

  if (endsAt.getTime() - startsAt.getTime() >= ALL_DAY_MINIMUM_DURATION_MS) {
    return event;
  }

  return {
    ...event,
    endsAt: new Date(startsAt.getTime() + ALL_DAY_MINIMUM_DURATION_MS).toISOString(),
  };
}

function getHolidaySeedYears() {
  const currentYear = new Date().getFullYear();
  return [currentYear, currentYear + 1];
}

function normalizeCountryCode(countryCode) {
  return String(countryCode || '').trim().toUpperCase();
}

function normalizeSeedYears(years = []) {
  return Array.from(
    new Set(
      (Array.isArray(years) ? years : [years])
        .map((year) => Number(year))
        .filter((year) => Number.isInteger(year))
    )
  ).sort((left, right) => left - right);
}

function readHolidaySeedState(rawValue) {
  if (!rawValue) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).map(([countryCode, years]) => [
        normalizeCountryCode(countryCode),
        normalizeSeedYears(years),
      ])
    );
  } catch {
    return {};
  }
}

function dedupeTagsByLabel(tags = []) {
  const seen = new Set();

  return (tags || []).filter((tag) => {
    const key = String(tag?.label || '').trim().toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
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

function normalizeStoredNotificationRecipients(recipients = []) {
  const rawRecipients = Array.isArray(recipients) ? recipients : [recipients];
  const seen = new Set();

  return rawRecipients.slice(0, 20).flatMap((recipient) => {
    const normalized = String(recipient || '').trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      return [];
    }

    seen.add(normalized);
    return [normalized];
  });
}

function isStoredNotificationConfigured(notification = {}) {
  return Boolean(
    notification?.reminderMinutesBeforeStart !== null &&
      notification?.reminderMinutesBeforeStart !== undefined &&
      (Boolean(notification?.desktopNotificationEnabled) ||
        (Boolean(notification?.emailNotificationEnabled) &&
          normalizeStoredNotificationRecipients(notification?.emailNotificationRecipients).length >
            0))
  );
}

function normalizeStoredNotifications(input = {}) {
  const notifications = Array.isArray(input?.notifications) ? input.notifications : [];
  const seenIds = new Set();
  const normalizedNotifications = notifications.flatMap((notification) => {
    const normalized = {
      id: String(notification?.id || createId('notification')),
      reminderMinutesBeforeStart:
        notification?.reminderMinutesBeforeStart ?? null,
      desktopNotificationEnabled: Boolean(notification?.desktopNotificationEnabled),
      emailNotificationEnabled: Boolean(notification?.emailNotificationEnabled),
      emailNotificationRecipients: normalizeStoredNotificationRecipients(
        notification?.emailNotificationRecipients
      ),
    };

    if (seenIds.has(normalized.id)) {
      return [];
    }

    seenIds.add(normalized.id);
    return [normalized];
  });

  if (normalizedNotifications.length > 0) {
    return normalizedNotifications;
  }

  const legacyNotification = {
    id: createId('notification'),
    reminderMinutesBeforeStart: input?.reminderMinutesBeforeStart ?? null,
    desktopNotificationEnabled: Boolean(input?.desktopNotificationEnabled),
    emailNotificationEnabled: Boolean(input?.emailNotificationEnabled),
    emailNotificationRecipients: normalizeStoredNotificationRecipients(
      input?.emailNotificationRecipients
    ),
  };

  return isStoredNotificationConfigured(legacyNotification) ? [legacyNotification] : [];
}

function getPrimaryStoredNotification(input = {}) {
  const notifications = normalizeStoredNotifications(input);
  return notifications.find((notification) => isStoredNotificationConfigured(notification)) || null;
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
    this.dialog = options.dialog;
    this.vaultState = this.vault.ensureMasterKey();
    this.cryptoService = new CryptoService(this.vaultState.key);
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.reauthService = new ReauthService();
    this.holidayService = new HolidayService({ fetchImpl: options.fetchImpl });
    this.holidayPreloadCache = new Map();
    this.holidayImportPromises = new Map();

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
        is_all_day INTEGER NOT NULL DEFAULT 0,
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

      CREATE TABLE IF NOT EXISTS reminder_dispatch_log (
        dispatch_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        recipient TEXT NOT NULL DEFAULT '',
        reminder_at TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(event_id, channel, recipient, reminder_at)
      );

      CREATE TABLE IF NOT EXISTS external_calendar_sources (
        source_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        remote_calendar_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        selected INTEGER NOT NULL DEFAULT 1,
        sync_cursor_cipher_text TEXT,
        last_synced_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(account_id, provider, remote_calendar_id)
      );

      CREATE TABLE IF NOT EXISTS external_event_links (
        event_id TEXT NOT NULL REFERENCES event_metadata(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES external_calendar_sources(source_id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        remote_calendar_id TEXT NOT NULL,
        remote_event_id TEXT NOT NULL,
        remote_version TEXT,
        sync_status TEXT NOT NULL DEFAULT 'active',
        link_mode TEXT NOT NULL DEFAULT 'imported',
        last_seen_remote_at TEXT,
        last_push_error TEXT,
        last_pushed_at TEXT,
        imported_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (event_id, source_id),
        UNIQUE(source_id, remote_event_id)
      );

      CREATE TABLE IF NOT EXISTS local_transport_sessions (
        session_id TEXT PRIMARY KEY,
        approval_id TEXT,
        session_token_hash TEXT NOT NULL,
        mode TEXT NOT NULL,
        scope_json TEXT NOT NULL DEFAULT '"all"',
        base_sequence INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        closed_at TEXT
      );
    `);
  }

  bootstrap() {
    this.runSchemaMigrations();
    const schemaVersion = Number(this.ensureMeta('schemaVersion', String(CURRENT_SCHEMA_VERSION)));
    if (!Number.isFinite(schemaVersion) || schemaVersion < CURRENT_SCHEMA_VERSION) {
      this.setMeta('schemaVersion', String(CURRENT_SCHEMA_VERSION));
    }
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

    if (this.getDemoSeedState() === 'seeded') {
      this.removeLegacyDemoSeedEvents();
    }

    if (this.countEvents() === 0) {
      if (fs.existsSync(this.legacyJsonPath)) {
        this.migrateLegacyJsonStore();
      } else {
        this.setMeta('demoSeedState', 'disabled');
      }
    } else if (!this.getMeta('demoSeedState')) {
      this.setMeta('demoSeedState', 'disabled');
    }
  }

  hasColumn(tableName, columnName) {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all();
    return columns.some((column) => String(column?.name || '').toLowerCase() === columnName.toLowerCase());
  }

  rebuildExternalProviderTablesForInviteLinks() {
    const hasLinkMode = this.hasColumn('external_event_links', 'link_mode');
    const hasLastPushError = this.hasColumn('external_event_links', 'last_push_error');
    const hasLastPushedAt = this.hasColumn('external_event_links', 'last_pushed_at');
    const linkModeSelect = hasLinkMode
      ? `CASE
          WHEN link_mode IS NULL OR link_mode = '' THEN 'imported'
          ELSE link_mode
        END`
      : `'imported'`;
    const lastPushErrorSelect = hasLastPushError ? 'last_push_error' : 'NULL';
    const lastPushedAtSelect = hasLastPushedAt ? 'last_pushed_at' : 'NULL';

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS external_calendar_sources_next (
        source_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        remote_calendar_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        selected INTEGER NOT NULL DEFAULT 1,
        sync_cursor_cipher_text TEXT,
        last_synced_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(account_id, provider, remote_calendar_id)
      );

      INSERT OR IGNORE INTO external_calendar_sources_next (
        source_id,
        account_id,
        provider,
        remote_calendar_id,
        display_name,
        selected,
        sync_cursor_cipher_text,
        last_synced_at,
        last_error,
        created_at,
        updated_at
      )
      SELECT
        source_id,
        account_id,
        provider,
        remote_calendar_id,
        display_name,
        selected,
        sync_cursor_cipher_text,
        last_synced_at,
        last_error,
        created_at,
        updated_at
      FROM external_calendar_sources;

      CREATE TABLE IF NOT EXISTS external_event_links_next (
        event_id TEXT NOT NULL REFERENCES event_metadata(id) ON DELETE CASCADE,
        source_id TEXT NOT NULL REFERENCES external_calendar_sources(source_id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        remote_calendar_id TEXT NOT NULL,
        remote_event_id TEXT NOT NULL,
        remote_version TEXT,
        sync_status TEXT NOT NULL DEFAULT 'active',
        link_mode TEXT NOT NULL DEFAULT 'imported',
        last_seen_remote_at TEXT,
        last_push_error TEXT,
        last_pushed_at TEXT,
        imported_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (event_id, source_id),
        UNIQUE(source_id, remote_event_id)
      );

      INSERT OR IGNORE INTO external_event_links_next (
        event_id,
        source_id,
        provider,
        remote_calendar_id,
        remote_event_id,
        remote_version,
        sync_status,
        link_mode,
        last_seen_remote_at,
        last_push_error,
        last_pushed_at,
        imported_at,
        updated_at
      )
      SELECT
        event_id,
        source_id,
        provider,
        remote_calendar_id,
        remote_event_id,
        remote_version,
        sync_status,
        ${linkModeSelect},
        last_seen_remote_at,
        ${lastPushErrorSelect},
        ${lastPushedAtSelect},
        imported_at,
        updated_at
      FROM external_event_links;

      DROP TABLE external_event_links;
      DROP TABLE external_calendar_sources;
      ALTER TABLE external_calendar_sources_next RENAME TO external_calendar_sources;
      ALTER TABLE external_event_links_next RENAME TO external_event_links;
    `);
  }

  runSchemaMigrations() {
    if (!this.hasColumn('event_metadata', 'is_all_day')) {
      this.db.exec(`ALTER TABLE event_metadata ADD COLUMN is_all_day INTEGER NOT NULL DEFAULT 0;`);
    }

    if (!this.hasColumn('local_transport_sessions', 'scope_json')) {
      this.db.exec(
        `ALTER TABLE local_transport_sessions ADD COLUMN scope_json TEXT NOT NULL DEFAULT '"all"';`
      );
    }

    const currentSchemaVersion = Number(this.getMeta('schemaVersion') || '0');
    if (
      currentSchemaVersion < 7 ||
      !this.hasColumn('external_event_links', 'link_mode') ||
      !this.hasColumn('external_event_links', 'last_push_error') ||
      !this.hasColumn('external_event_links', 'last_pushed_at')
    ) {
      this.rebuildExternalProviderTablesForInviteLinks();
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

  getHolidaySeedState() {
    return readHolidaySeedState(this.getMeta(HOLIDAY_SEED_STATE_META_KEY));
  }

  setHolidaySeedState(nextState) {
    this.setMeta(HOLIDAY_SEED_STATE_META_KEY, JSON.stringify(nextState || {}));
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

  countChangeSummaries() {
    return Number(
      this.db.prepare('SELECT COUNT(*) AS count FROM change_log').get()?.count || 0
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

  isLegacyDemoSeedEvent(event) {
    return (
      LEGACY_DEMO_EVENT_TITLES.has(String(event?.title || '')) &&
      !String(event?.description || '').includes(HOLIDAY_DESCRIPTION_MARKER)
    );
  }

  removeLegacyDemoSeedEvents() {
    const demoEventIds = this.listEvents(true)
      .filter((event) => this.isLegacyDemoSeedEvent(event))
      .map((event) => event.id);

    if (demoEventIds.length === 0) {
      this.setMeta('demoSeedState', 'disabled');
      return 0;
    }

    const removingAllEvents = demoEventIds.length === this.countEvents();

    this.withTransaction(() => {
      for (const eventId of demoEventIds) {
        this.db.prepare('DELETE FROM reminder_dispatch_log WHERE event_id = :eventId').run({
          eventId,
        });
        this.db.prepare('DELETE FROM external_event_links WHERE event_id = :eventId').run({
          eventId,
        });
        this.db
          .prepare(`DELETE FROM change_log WHERE entity = 'event' AND entity_id = :eventId`)
          .run({ eventId });
        this.db.prepare('DELETE FROM event_metadata WHERE id = :eventId').run({
          eventId,
        });
      }

      if (removingAllEvents) {
        this.db.prepare('DELETE FROM tag_catalog').run();
        this.db.prepare('DELETE FROM change_log').run();
        this.setMeta('lastSequence', '0');
      }

      this.setMeta('demoSeedState', 'disabled');
    });

    return demoEventIds.length;
  }

  clearCalendarDataForHostedBootstrap() {
    this.withTransaction(() => {
      this.db.prepare('DELETE FROM external_event_links').run();
      this.db.prepare('DELETE FROM external_calendar_sources').run();
      this.db.prepare('DELETE FROM event_content').run();
      this.db.prepare('DELETE FROM event_metadata').run();
      this.db.prepare('DELETE FROM tag_catalog').run();
      this.db.prepare('DELETE FROM change_log').run();
      this.db.prepare('DELETE FROM local_transport_sessions').run();
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

  deleteTagCatalogEntry(tagId) {
    this.db.prepare('DELETE FROM tag_catalog WHERE id = :id').run({ id: tagId });
  }

  updateEventTags(event, nextTags) {
    const normalizedTags = dedupeTagsByLabel(this.normalizeTags(nextTags));
    const timestamp = nowIso();
    const currentContent = {
      title: event.title,
      description: event.description,
      groupName: event.groupName,
      location: event.location || '',
      people: event.people || [],
      inviteRecipients: event.inviteRecipients || [],
      sourceTimeZone: event.sourceTimeZone || '',
      reminderMinutesBeforeStart: event.reminderMinutesBeforeStart ?? null,
      desktopNotificationEnabled: Boolean(event.desktopNotificationEnabled),
      emailNotificationEnabled: Boolean(event.emailNotificationEnabled),
      emailNotificationRecipients: event.emailNotificationRecipients || [],
      notifications: normalizeStoredNotifications(event),
      tags: event.tags || [],
      inviteTargetAccountId: event.inviteTargetAccountId || '',
      inviteTargetProvider: normalizeInviteProvider(event.inviteTargetProvider),
      inviteTargetCalendarId: event.inviteTargetCalendarId || '',
      inviteDeliveryMode: normalizeInviteDeliveryMode(event.inviteDeliveryMode),
      lastInviteError: event.lastInviteError || '',
      externalProviderLinks: event.externalProviderLinks || [],
    };
    const nextContent = {
      ...currentContent,
      tags: normalizedTags,
    };

    if (JSON.stringify(nextContent.tags) === JSON.stringify(currentContent.tags)) {
      return event;
    }

    this.upsertTagCatalog(normalizedTags);
    this.db
      .prepare(
        `UPDATE event_metadata
         SET updated_at = :updatedAt,
             updated_by = :updatedBy
         WHERE id = :id`
      )
      .run({
        id: event.id,
        updatedAt: timestamp,
        updatedBy: this.deviceId,
      });
    this.db
      .prepare(
        `UPDATE event_content
         SET cipher_text = :cipherText
         WHERE event_id = :eventId`
      )
      .run({
        eventId: event.id,
        cipherText: this.cryptoService.encryptJson(nextContent, `event:${event.id}:content`),
      });

    this.recordChange({
      entity: 'event',
      entityId: event.id,
      operation: 'update',
      patch: { tags: nextContent.tags },
      deviceId: this.deviceId,
      signatureKeyId: this.deviceId,
    });

    return {
      ...event,
      reminderMinutesBeforeStart: nextContent.reminderMinutesBeforeStart,
      desktopNotificationEnabled: nextContent.desktopNotificationEnabled,
      emailNotificationEnabled: nextContent.emailNotificationEnabled,
      emailNotificationRecipients: nextContent.emailNotificationRecipients,
      notifications: nextContent.notifications,
      tags: nextContent.tags,
      updatedAt: timestamp,
      updatedBy: this.deviceId,
    };
  }

  renameTagSystemWide(tagId, nextLabel) {
    const currentTag = this.getTagCatalogSnapshot().find((tag) => tag.id === tagId);
    const sanitizedLabel = String(nextLabel || '').trim();

    if (!currentTag) {
      throw new Error('Tag not found.');
    }

    if (!sanitizedLabel) {
      throw new Error('Tag name cannot be empty.');
    }

    const matchingTag = this.getTagCatalogSnapshot().find(
      (tag) => tag.label.toLowerCase() === sanitizedLabel.toLowerCase()
    );
    const targetTag =
      matchingTag && matchingTag.id !== currentTag.id
        ? matchingTag
        : {
            ...currentTag,
            label: sanitizedLabel,
          };

    this.maybeMarkDemoSeedModified();
    this.withTransaction(() => {
      if (targetTag.id === currentTag.id) {
        this.upsertTagCatalog([targetTag]);
      }

      for (const event of this.listEvents(false)) {
        const nextTags = (event.tags || []).map((tag) =>
          tag.id === currentTag.id || tag.label.toLowerCase() === currentTag.label.toLowerCase()
            ? {
                id: targetTag.id,
                label: targetTag.label,
                color: targetTag.color,
              }
            : tag
        );

        this.updateEventTags(event, nextTags);
      }

      if (targetTag.id !== currentTag.id) {
        this.deleteTagCatalogEntry(currentTag.id);
      }
    });

    return this.snapshot();
  }

  deleteTagSystemWide(tagId) {
    const currentTag = this.getTagCatalogSnapshot().find((tag) => tag.id === tagId);

    if (!currentTag) {
      throw new Error('Tag not found.');
    }

    this.maybeMarkDemoSeedModified();
    this.withTransaction(() => {
      for (const event of this.listEvents(false)) {
        const nextTags = (event.tags || []).filter(
          (tag) => tag.id !== currentTag.id && tag.label.toLowerCase() !== currentTag.label.toLowerCase()
        );
        this.updateEventTags(event, nextTags);
      }

      this.deleteTagCatalogEntry(currentTag.id);
    });

    return this.snapshot();
  }

  buildEventContent(input) {
    const notifications = normalizeStoredNotifications(input);
    const primaryNotification = getPrimaryStoredNotification({
      ...input,
      notifications,
    });

    return {
      title: input.title,
      description: input.description || '',
      groupName: input.groupName || '',
      location: input.location || '',
      people: Array.isArray(input.people) ? input.people : [],
      inviteRecipients: extractInviteeEmails(input.inviteRecipients || []),
      sourceTimeZone: String(input.sourceTimeZone || '').trim(),
      reminderMinutesBeforeStart: primaryNotification?.reminderMinutesBeforeStart ?? null,
      desktopNotificationEnabled: Boolean(primaryNotification?.desktopNotificationEnabled),
      emailNotificationEnabled: Boolean(primaryNotification?.emailNotificationEnabled),
      emailNotificationRecipients: primaryNotification?.emailNotificationRecipients || [],
      notifications,
      tags: this.normalizeTags(input.tags || []),
      inviteTargetAccountId: String(input.inviteTargetAccountId || '').trim(),
      inviteTargetProvider: normalizeInviteProvider(input.inviteTargetProvider),
      inviteTargetCalendarId: String(input.inviteTargetCalendarId || '').trim(),
      inviteDeliveryMode: normalizeInviteDeliveryMode(input.inviteDeliveryMode),
      lastInviteError: String(input.lastInviteError || '').trim(),
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
        is_all_day,
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
          :isAllDay,
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
        isAllDay: input.isAllDay ? 1 : 0,
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

  upsertEventRecord(input, options = {}) {
    const existingEvent = input.id ? this.getEventById(input.id) : null;
    if (!existingEvent) {
      return this.insertEventRecord(input, options);
    }

    const timestamp = nowIso();
    const nextContent = this.buildEventContent(input);
    const currentContent = {
      title: existingEvent.title,
      description: existingEvent.description,
      groupName: existingEvent.groupName,
      location: existingEvent.location || '',
      people: existingEvent.people || [],
      inviteRecipients: existingEvent.inviteRecipients || [],
      sourceTimeZone: existingEvent.sourceTimeZone || '',
      reminderMinutesBeforeStart: existingEvent.reminderMinutesBeforeStart ?? null,
      desktopNotificationEnabled: Boolean(existingEvent.desktopNotificationEnabled),
      emailNotificationEnabled: Boolean(existingEvent.emailNotificationEnabled),
      emailNotificationRecipients: existingEvent.emailNotificationRecipients || [],
      notifications: normalizeStoredNotifications(existingEvent),
      tags: existingEvent.tags || [],
      inviteTargetAccountId: existingEvent.inviteTargetAccountId || '',
      inviteTargetProvider: normalizeInviteProvider(existingEvent.inviteTargetProvider),
      inviteTargetCalendarId: existingEvent.inviteTargetCalendarId || '',
      inviteDeliveryMode: normalizeInviteDeliveryMode(existingEvent.inviteDeliveryMode),
      lastInviteError: existingEvent.lastInviteError || '',
      externalProviderLinks: existingEvent.externalProviderLinks || [],
    };

    const metadataPatch = {};
    for (const field of [
      'type',
      'completed',
      'repeat',
      'hasDeadline',
      'startsAt',
      'endsAt',
      'isAllDay',
      'color',
      'syncPolicy',
      'visibility',
    ]) {
      if (input[field] !== existingEvent[field]) {
        metadataPatch[field] = input[field];
      }
    }

    const contentChanged = JSON.stringify(nextContent) !== JSON.stringify(currentContent);
    if (Object.keys(metadataPatch).length === 0 && !contentChanged) {
      return existingEvent;
    }

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
             is_all_day = :isAllDay,
             color = :color,
             sync_policy = :syncPolicy,
             visibility = :visibility,
             deleted = 0,
             updated_at = :updatedAt,
             updated_by = :updatedBy
         WHERE id = :id`
      )
      .run({
        id: existingEvent.id,
        type: input.type,
        completed: input.completed ? 1 : 0,
        repeatRule: input.repeat,
        hasDeadline: input.hasDeadline ? 1 : 0,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        isAllDay: input.isAllDay ? 1 : 0,
        color: input.color,
        syncPolicy: input.syncPolicy,
        visibility: input.visibility,
        updatedAt: timestamp,
        updatedBy: options.deviceId || this.deviceId,
      });

    if (contentChanged) {
      this.db
        .prepare(
          `UPDATE event_content
           SET cipher_text = :cipherText
           WHERE event_id = :eventId`
        )
        .run({
          eventId: existingEvent.id,
          cipherText: this.cryptoService.encryptJson(
            nextContent,
            `event:${existingEvent.id}:content`
          ),
        });
    }

    const changePatch = {
      ...metadataPatch,
    };

    if (contentChanged) {
      for (const field of [
        'title',
        'description',
        'groupName',
        'location',
        'people',
        'inviteRecipients',
        'sourceTimeZone',
        'reminderMinutesBeforeStart',
        'desktopNotificationEnabled',
        'emailNotificationEnabled',
        'emailNotificationRecipients',
        'notifications',
        'tags',
        'inviteTargetAccountId',
        'inviteTargetProvider',
        'inviteTargetCalendarId',
        'inviteDeliveryMode',
        'lastInviteError',
        'externalProviderLinks',
      ]) {
        if (JSON.stringify(nextContent[field]) !== JSON.stringify(currentContent[field])) {
          changePatch[field] = nextContent[field];
        }
      }
    }

    this.recordChange({
      entity: 'event',
      entityId: existingEvent.id,
      operation: 'update',
      patch: changePatch,
      deviceId: options.deviceId || this.deviceId,
      signatureKeyId: options.deviceId || this.deviceId,
    });

    return this.getEventById(existingEvent.id);
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
          m.is_all_day AS isAllDay,
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
      type: normalizeEventType(row.type),
      completed: Boolean(row.completed),
      repeat: row.repeatRule,
      hasDeadline: Boolean(row.hasDeadline),
      groupName: content.groupName || '',
      location: content.location || '',
      people: content.people || [],
      inviteRecipients: extractInviteeEmails(content.inviteRecipients || []),
      sourceTimeZone: content.sourceTimeZone || '',
      reminderMinutesBeforeStart: content.reminderMinutesBeforeStart ?? null,
      desktopNotificationEnabled: Boolean(content.desktopNotificationEnabled),
      emailNotificationEnabled: Boolean(content.emailNotificationEnabled),
      emailNotificationRecipients: content.emailNotificationRecipients || [],
      notifications: normalizeStoredNotifications(content),
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      isAllDay: Boolean(row.isAllDay),
      color: row.color,
      tags: content.tags || [],
      deleted: Boolean(row.deleted),
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
      syncPolicy: row.syncPolicy,
      visibility: row.visibility,
      contentCipherVersion: row.contentCipherVersion,
      externalProviderLinks: content.externalProviderLinks || [],
      inviteTargetAccountId: content.inviteTargetAccountId || '',
      inviteTargetProvider: normalizeInviteProvider(content.inviteTargetProvider),
      inviteTargetCalendarId: content.inviteTargetCalendarId || '',
      inviteDeliveryMode: normalizeInviteDeliveryMode(content.inviteDeliveryMode),
      lastInviteError: content.lastInviteError || '',
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
          m.is_all_day AS isAllDay,
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

  isHolidayAlreadyPresent(events, countryCode, holiday) {
    const holidayTitle = holiday.name || holiday.localName || 'Public holiday';

    return events.some((event) => {
      const eventDate = String(event.startsAt || '').slice(0, 10);
      const hasHolidayTag = (event.tags || []).some((tag) => tag.label === 'Holiday');
      const hasCountryTag = (event.tags || []).some(
        (tag) => tag.label === `${countryCode} Holiday`
      );

      return (
        eventDate === holiday.date &&
        event.title === holidayTitle &&
        (hasHolidayTag ||
          hasCountryTag ||
          String(event.description || '').includes(HOLIDAY_DESCRIPTION_MARKER))
      );
    });
  }

  createHolidayEventInput(countryCode, holiday, timeZone = '') {
    return sanitizeEventCreateInput({
      title: holiday.name || holiday.localName || 'Public holiday',
      description: `${HOLIDAY_DESCRIPTION_MARKER} Imported default public holiday for ${countryCode}.`,
      type: 'personal',
      completed: false,
      repeat: 'none',
      hasDeadline: false,
      groupName: '',
      location: '',
      people: [],
      startsAt: new Date(`${holiday.date}T00:00:00.000Z`).toISOString(),
      endsAt: new Date(new Date(`${holiday.date}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString(),
      isAllDay: true,
      sourceTimeZone: String(timeZone || ''),
      color: HOLIDAY_EVENT_COLOR,
      tags: [
        { label: 'Holiday', color: HOLIDAY_TAG_COLOR },
        { label: `${countryCode} Holiday`, color: COUNTRY_TAG_COLOR },
      ],
    });
  }

  getHolidayCountries() {
    return this.holidayService.getAvailableCountries();
  }

  async preloadHolidays({ countryCode, years = getHolidaySeedYears(), timeZone } = {}) {
    const normalizedCountryCode = normalizeCountryCode(countryCode);
    const normalizedYears = normalizeSeedYears(
      Array.isArray(years) && years.length > 0 ? years : getHolidaySeedYears()
    );

    if (!normalizedCountryCode) {
      return {
        countryCode: '',
        status: 'idle',
        years: [],
      };
    }

    const existingEntry = this.holidayPreloadCache.get(normalizedCountryCode);
    const cachedYears = existingEntry?.holidaysByYear || {};
    const missingYears = normalizedYears.filter((year) => !Array.isArray(cachedYears[year]));

    if (missingYears.length === 0 && existingEntry?.status === 'ready') {
      return {
        countryCode: normalizedCountryCode,
        status: 'ready',
        years: normalizedYears,
      };
    }

    if (
      existingEntry?.status === 'loading' &&
      existingEntry?.promise &&
      missingYears.every((year) => (existingEntry.pendingYears || []).includes(year))
    ) {
      return existingEntry.promise;
    }

    const preloadPromise = Promise.all(
      missingYears.map(async (year) => [
        year,
        await this.holidayService.getPublicHolidays({
          countryCode: normalizedCountryCode,
          year,
          timeZone,
        }),
      ])
    )
      .then((entries) => {
        const holidaysByYear = {
          ...cachedYears,
          ...Object.fromEntries(entries),
        };

        this.holidayPreloadCache.set(normalizedCountryCode, {
          status: 'ready',
          holidaysByYear,
          pendingYears: [],
        });

        return {
          countryCode: normalizedCountryCode,
          status: 'ready',
          years: normalizedYears,
        };
      })
      .catch((error) => {
        this.holidayPreloadCache.set(normalizedCountryCode, {
          status: 'error',
          holidaysByYear: cachedYears,
          pendingYears: [],
          error: error?.message || 'Holiday preload failed.',
        });

        return {
          countryCode: normalizedCountryCode,
          status: 'error',
          years: normalizedYears,
          error: error?.message || 'Holiday preload failed.',
        };
      });

    this.holidayPreloadCache.set(normalizedCountryCode, {
      status: 'loading',
      holidaysByYear: cachedYears,
      pendingYears: missingYears,
      promise: preloadPromise,
    });

    return preloadPromise;
  }

  async importHolidays({ countryCode, years = getHolidaySeedYears(), timeZone } = {}) {
    const normalizedCountryCode = normalizeCountryCode(countryCode);
    const normalizedYears = normalizeSeedYears(
      Array.isArray(years) && years.length > 0 ? years : getHolidaySeedYears()
    );

    if (!normalizedCountryCode) {
      return {
        snapshot: this.snapshot(),
        importedCount: 0,
        warning: '',
      };
    }

    if (this.holidayImportPromises.has(normalizedCountryCode)) {
      return this.holidayImportPromises.get(normalizedCountryCode);
    }

    const importPromise = (async () => {
      const preloadResult = await this.preloadHolidays({
        countryCode: normalizedCountryCode,
        years: normalizedYears,
        timeZone,
      });

      if (preloadResult.status === 'error') {
        return {
          snapshot: this.snapshot(),
          importedCount: 0,
          warning: 'Settings were saved, but holidays could not be imported right now.',
        };
      }

      const preloadEntry = this.holidayPreloadCache.get(normalizedCountryCode);
      const holidaysByYear = preloadEntry?.holidaysByYear || {};
      const holidaySeedState = this.getHolidaySeedState();
      const seededYears = new Set(holidaySeedState[normalizedCountryCode] || []);
      const yearsWithData = normalizedYears.filter((year) => Array.isArray(holidaysByYear[year]));

      if (yearsWithData.length === 0) {
        return {
          snapshot: this.snapshot(),
          importedCount: 0,
          warning: 'Settings were saved, but holidays could not be imported right now.',
        };
      }

      let importedCount = 0;
      const existingEvents = this.listEvents(false);
      const shouldMarkModified = yearsWithData.some(
        (year) => !seededYears.has(year) && (holidaysByYear[year] || []).length > 0
      );

      if (shouldMarkModified) {
        this.maybeMarkDemoSeedModified();
      }

      this.withTransaction(() => {
        const knownEvents = [...existingEvents];

        for (const year of yearsWithData) {
          if (seededYears.has(year)) {
            continue;
          }

          for (const holiday of holidaysByYear[year] || []) {
            if (this.isHolidayAlreadyPresent(knownEvents, normalizedCountryCode, holiday)) {
              continue;
            }

            const createdEvent = this.insertEventRecord(
              this.createHolidayEventInput(normalizedCountryCode, holiday, timeZone),
              { deviceId: this.deviceId }
            );

            knownEvents.push(createdEvent);
            importedCount += 1;
          }

          seededYears.add(year);
        }

        holidaySeedState[normalizedCountryCode] = Array.from(seededYears).sort(
          (left, right) => left - right
        );
        this.setHolidaySeedState(holidaySeedState);
      });

      return {
        snapshot: this.snapshot(),
        importedCount,
        warning: '',
      };
    })().finally(() => {
      this.holidayImportPromises.delete(normalizedCountryCode);
    });

    this.holidayImportPromises.set(normalizedCountryCode, importPromise);
    return importPromise;
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
      'isAllDay',
      'color',
      'syncPolicy',
      'visibility',
      'deleted',
    ]) {
      if (patch[field] !== undefined) {
        metadataPatch[field] = patch[field];
      }
    }

    for (const field of [
      'title',
      'description',
      'groupName',
      'location',
      'people',
      'inviteRecipients',
      'sourceTimeZone',
      'reminderMinutesBeforeStart',
      'desktopNotificationEnabled',
      'emailNotificationEnabled',
      'emailNotificationRecipients',
      'notifications',
      'tags',
      'inviteTargetAccountId',
      'inviteTargetProvider',
      'inviteTargetCalendarId',
      'inviteDeliveryMode',
      'lastInviteError',
      'externalProviderLinks',
    ]) {
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
      const currentEventRow =
        row.operation !== 'delete' && row.entity === 'event'
          ? this.db
              .prepare(
                `SELECT cipher_text AS cipherText
                 FROM event_content
                 WHERE event_id = :eventId`
              )
              .get({ eventId: row.entityId })
          : null;

      return {
        deviceId: row.deviceId,
        deviceSequence: Number(row.sequence),
        entity: row.entity,
        entityId: row.entityId,
        operation: row.operation,
        contentPatch: Object.keys(contentPatch).length > 0 ? contentPatch : null,
        encryptedContent: currentEventRow?.cipherText || null,
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
          type: metadataPatch.type || 'meeting',
          completed: metadataPatch.completed ?? false,
          repeat: metadataPatch.repeat || 'none',
          hasDeadline: metadataPatch.hasDeadline ?? false,
          groupName: contentPatch.groupName || '',
          location: contentPatch.location || '',
          people: contentPatch.people || [],
          inviteRecipients: contentPatch.inviteRecipients || [],
          sourceTimeZone: contentPatch.sourceTimeZone || '',
          reminderMinutesBeforeStart: contentPatch.reminderMinutesBeforeStart ?? null,
          desktopNotificationEnabled: Boolean(contentPatch.desktopNotificationEnabled),
          emailNotificationEnabled: Boolean(contentPatch.emailNotificationEnabled),
          emailNotificationRecipients: contentPatch.emailNotificationRecipients || [],
          notifications: contentPatch.notifications || [],
          inviteTargetAccountId: contentPatch.inviteTargetAccountId || '',
          inviteTargetProvider: contentPatch.inviteTargetProvider || '',
          inviteTargetCalendarId: contentPatch.inviteTargetCalendarId || '',
          inviteDeliveryMode: contentPatch.inviteDeliveryMode || 'local_only',
          lastInviteError: contentPatch.lastInviteError || '',
          startsAt: metadataPatch.startsAt,
          endsAt: metadataPatch.endsAt,
          isAllDay: Boolean(metadataPatch.isAllDay),
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
            is_all_day,
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
            :isAllDay,
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
          isAllDay: sanitized.isAllDay ? 1 : 0,
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
              location: sanitized.location,
              people: sanitized.people || [],
              inviteRecipients: sanitized.inviteRecipients || [],
              sourceTimeZone: sanitized.sourceTimeZone || '',
              reminderMinutesBeforeStart: sanitized.reminderMinutesBeforeStart ?? null,
              desktopNotificationEnabled: Boolean(sanitized.desktopNotificationEnabled),
              emailNotificationEnabled: Boolean(sanitized.emailNotificationEnabled),
              emailNotificationRecipients: sanitized.emailNotificationRecipients || [],
              notifications: sanitized.notifications || [],
              tags: content.tags,
              inviteTargetAccountId: sanitized.inviteTargetAccountId || '',
              inviteTargetProvider: sanitized.inviteTargetProvider || '',
              inviteTargetCalendarId: sanitized.inviteTargetCalendarId || '',
              inviteDeliveryMode: sanitized.inviteDeliveryMode || 'local_only',
              lastInviteError: sanitized.lastInviteError || '',
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
          type: event.type || 'meeting',
          completed: Boolean(event.completed),
          repeat: event.repeat || 'none',
          hasDeadline: Boolean(event.hasDeadline),
          groupName: event.groupName || '',
          location: event.location || '',
          people: event.people || [],
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          isAllDay: Boolean(event.isAllDay),
          sourceTimeZone: event.sourceTimeZone || '',
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

  snapshot({ includeChanges = false } = {}) {
    const events = this.listEvents(false);
    const changeCount = this.countChangeSummaries();

    const nextSnapshot = {
      deviceId: this.deviceId,
      lastSequence: Number(this.getMeta('lastSequence') || '0'),
      events,
      tags: this.getTagCatalogSnapshot(),
      externalCalendarSources: this.listExternalCalendarSources(),
      externalEventLinks: this.listExternalEventLinks(),
      stats: {
        activeEventCount: events.length,
        changeCount,
      },
      security: this.getSecuritySnapshot(),
    };

    if (includeChanges) {
      nextSnapshot.changes = this.listChangeSummaries();
    }

    return nextSnapshot;
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
        clientConfig: this.oauthService.getClientConfigSnapshot(),
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

  parseStoredCursor(sourceId, cipherText) {
    if (!cipherText) {
      return null;
    }

    const decrypted = this.cryptoService.decryptText(
      cipherText,
      `external-source:${sourceId}:cursor`
    );
    try {
      return JSON.parse(decrypted);
    } catch {
      return decrypted;
    }
  }

  encodeStoredCursor(sourceId, value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const serialized =
      typeof value === 'string' ? value : JSON.stringify(value);
    return this.cryptoService.encryptText(
      serialized,
      `external-source:${sourceId}:cursor`
    );
  }

  rowToExternalCalendarSource(row) {
    return {
      sourceId: row.sourceId,
      accountId: row.accountId,
      provider: row.provider,
      remoteCalendarId: row.remoteCalendarId,
      displayName: row.displayName,
      selected: Boolean(row.selected),
      syncCursor: this.parseStoredCursor(row.sourceId, row.syncCursorCipherText),
      lastSyncedAt: row.lastSyncedAt || null,
      lastError: row.lastError || null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  listExternalCalendarSources() {
    return this.db
      .prepare(
        `SELECT
          source_id AS sourceId,
          account_id AS accountId,
          provider,
          remote_calendar_id AS remoteCalendarId,
          display_name AS displayName,
          selected,
          sync_cursor_cipher_text AS syncCursorCipherText,
          last_synced_at AS lastSyncedAt,
          last_error AS lastError,
          created_at AS createdAt,
          updated_at AS updatedAt
         FROM external_calendar_sources
         ORDER BY created_at ASC`
      )
      .all()
      .map((row) => this.rowToExternalCalendarSource(row));
  }

  getExternalCalendarSourceById(sourceId) {
    const row = this.db
      .prepare(
        `SELECT
          source_id AS sourceId,
          account_id AS accountId,
          provider,
          remote_calendar_id AS remoteCalendarId,
          display_name AS displayName,
          selected,
          sync_cursor_cipher_text AS syncCursorCipherText,
          last_synced_at AS lastSyncedAt,
          last_error AS lastError,
          created_at AS createdAt,
          updated_at AS updatedAt
         FROM external_calendar_sources
         WHERE source_id = :sourceId
         LIMIT 1`
      )
      .get({ sourceId });

    return row ? this.rowToExternalCalendarSource(row) : null;
  }

  upsertExternalCalendarSource(input = {}) {
    const existing = this.db
      .prepare(
        `SELECT source_id AS sourceId
         FROM external_calendar_sources
         WHERE account_id = :accountId
           AND provider = :provider
           AND remote_calendar_id = :remoteCalendarId
         LIMIT 1`
      )
      .get({
        accountId: input.accountId,
        provider: input.provider,
        remoteCalendarId: input.remoteCalendarId,
      });
    const sourceId = existing?.sourceId || input.sourceId || createId('source');
    const timestamp = nowIso();

    this.db
      .prepare(
        `INSERT INTO external_calendar_sources (
          source_id,
          account_id,
          provider,
          remote_calendar_id,
          display_name,
          selected,
          sync_cursor_cipher_text,
          last_synced_at,
          last_error,
          created_at,
          updated_at
        ) VALUES (
          :sourceId,
          :accountId,
          :provider,
          :remoteCalendarId,
          :displayName,
          :selected,
          :syncCursorCipherText,
          :lastSyncedAt,
          :lastError,
          :createdAt,
          :updatedAt
        )
        ON CONFLICT(source_id) DO UPDATE SET
          account_id = excluded.account_id,
          provider = excluded.provider,
          remote_calendar_id = excluded.remote_calendar_id,
          display_name = excluded.display_name,
          selected = excluded.selected,
          sync_cursor_cipher_text = excluded.sync_cursor_cipher_text,
          last_synced_at = excluded.last_synced_at,
          last_error = excluded.last_error,
          updated_at = excluded.updated_at`
      )
      .run({
        sourceId,
        accountId: input.accountId,
        provider: input.provider,
        remoteCalendarId: input.remoteCalendarId,
        displayName: input.displayName || input.remoteCalendarId,
        selected: input.selected === false ? 0 : 1,
        syncCursorCipherText: this.encodeStoredCursor(sourceId, input.syncCursor),
        lastSyncedAt: input.lastSyncedAt || null,
        lastError: input.lastError || null,
        createdAt: input.createdAt || timestamp,
        updatedAt: timestamp,
      });

    return this.getExternalCalendarSourceById(sourceId);
  }

  listExternalEventLinks(filters = {}) {
    const clauses = [];
    const params = {};

    if (filters.sourceId) {
      clauses.push('source_id = :sourceId');
      params.sourceId = filters.sourceId;
    }

    if (filters.eventId) {
      clauses.push('event_id = :eventId');
      params.eventId = filters.eventId;
    }

    if (filters.syncStatus) {
      clauses.push('sync_status = :syncStatus');
      params.syncStatus = normalizeSourceLinkStatus(filters.syncStatus);
    }

    if (filters.linkMode) {
      clauses.push('link_mode = :linkMode');
      params.linkMode = normalizeExternalLinkMode(filters.linkMode);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return this.db
      .prepare(
        `SELECT
          event_id AS eventId,
          source_id AS sourceId,
          provider,
          remote_calendar_id AS remoteCalendarId,
          remote_event_id AS remoteEventId,
          remote_version AS remoteVersion,
          sync_status AS syncStatus,
          link_mode AS linkMode,
          last_seen_remote_at AS lastSeenRemoteAt,
          last_push_error AS lastPushError,
          last_pushed_at AS lastPushedAt,
          imported_at AS importedAt,
          updated_at AS updatedAt
         FROM external_event_links
         ${whereClause}
         ORDER BY imported_at ASC`
      )
      .all(params);
  }

  findExternalEventLink(provider, remoteCalendarId, remoteEventId, sourceId = '') {
    return (
      this.db
        .prepare(
          `SELECT
            event_id AS eventId,
            source_id AS sourceId,
            provider,
            remote_calendar_id AS remoteCalendarId,
            remote_event_id AS remoteEventId,
            remote_version AS remoteVersion,
            sync_status AS syncStatus,
            link_mode AS linkMode,
            last_seen_remote_at AS lastSeenRemoteAt,
            last_push_error AS lastPushError,
            last_pushed_at AS lastPushedAt,
            imported_at AS importedAt,
            updated_at AS updatedAt
           FROM external_event_links
           WHERE provider = :provider
             AND remote_calendar_id = :remoteCalendarId
             AND remote_event_id = :remoteEventId
             AND (:sourceId = '' OR source_id = :sourceId)
           LIMIT 1`
        )
        .get({
          provider,
          remoteCalendarId,
          remoteEventId,
          sourceId: sourceId || '',
        }) || null
    );
  }

  upsertExternalEventLink(input = {}) {
    const timestamp = nowIso();
    this.db
      .prepare(
        `INSERT INTO external_event_links (
          event_id,
          source_id,
          provider,
          remote_calendar_id,
          remote_event_id,
          remote_version,
          sync_status,
          link_mode,
          last_seen_remote_at,
          last_push_error,
          last_pushed_at,
          imported_at,
          updated_at
        ) VALUES (
          :eventId,
          :sourceId,
          :provider,
          :remoteCalendarId,
          :remoteEventId,
          :remoteVersion,
          :syncStatus,
          :linkMode,
          :lastSeenRemoteAt,
          :lastPushError,
          :lastPushedAt,
          :importedAt,
          :updatedAt
        )
        ON CONFLICT(event_id, source_id) DO UPDATE SET
          provider = excluded.provider,
          remote_calendar_id = excluded.remote_calendar_id,
          remote_event_id = excluded.remote_event_id,
          remote_version = excluded.remote_version,
          sync_status = excluded.sync_status,
          link_mode = excluded.link_mode,
          last_seen_remote_at = excluded.last_seen_remote_at,
          last_push_error = excluded.last_push_error,
          last_pushed_at = excluded.last_pushed_at,
          updated_at = excluded.updated_at`
      )
      .run({
        eventId: input.eventId,
        sourceId: input.sourceId,
        provider: input.provider,
        remoteCalendarId: input.remoteCalendarId,
        remoteEventId: input.remoteEventId,
        remoteVersion: input.remoteVersion || null,
        syncStatus: normalizeSourceLinkStatus(input.syncStatus),
        linkMode: normalizeExternalLinkMode(input.linkMode),
        lastSeenRemoteAt: input.lastSeenRemoteAt || null,
        lastPushError: input.lastPushError || null,
        lastPushedAt: input.lastPushedAt || null,
        importedAt: input.importedAt || timestamp,
        updatedAt: timestamp,
      });
  }

  updateExternalLinkStatus(eventId, syncStatus, filters = {}) {
    const clauses = [`event_id = :eventId`, `sync_status = 'active'`];
    const params = {
      eventId,
      syncStatus: normalizeSourceLinkStatus(syncStatus),
      updatedAt: nowIso(),
    };

    if (filters.linkMode) {
      clauses.push('link_mode = :linkMode');
      params.linkMode = normalizeExternalLinkMode(filters.linkMode);
    }

    this.db
      .prepare(
        `UPDATE external_event_links
         SET sync_status = :syncStatus,
             updated_at = :updatedAt
         WHERE ${clauses.join(' AND ')}`
      )
      .run(params);
  }

  filterEventsByScope(events = [], scope = 'all') {
    const normalizedScope = cloneScopeValue(scope);
    if (!normalizedScope || normalizedScope === 'all') {
      return events;
    }

    return events.filter((event) => {
      if (Array.isArray(normalizedScope?.eventIds) && normalizedScope.eventIds.length > 0) {
        if (!normalizedScope.eventIds.includes(event.id)) {
          return false;
        }
      }

      if (normalizedScope?.dateFrom) {
        const dateFrom = new Date(normalizedScope.dateFrom);
        if (!Number.isNaN(dateFrom.getTime()) && new Date(event.endsAt) < dateFrom) {
          return false;
        }
      }

      if (normalizedScope?.dateTo) {
        const dateTo = new Date(normalizedScope.dateTo);
        if (!Number.isNaN(dateTo.getTime()) && new Date(event.startsAt) > dateTo) {
          return false;
        }
      }

      return true;
    });
  }

  buildExportBundle(scope = 'all') {
    const filteredEvents = this.filterEventsByScope(this.listEvents(false), scope);
    const eventIds = new Set(filteredEvents.map((event) => event.id));
    const externalEventLinks = this.listExternalEventLinks().filter((link) =>
      eventIds.has(link.eventId)
    );
    const sourceIds = new Set(externalEventLinks.map((link) => link.sourceId));
    const externalCalendarSources = this.listExternalCalendarSources().filter((source) =>
      sourceIds.has(source.sourceId)
    );

    return buildCalendarBundle({
      deviceId: this.deviceId,
      lastSequence: Number(this.getMeta('lastSequence') || '0'),
      events: filteredEvents,
      tags: this.getTagCatalogSnapshot(),
      externalCalendarSources,
      externalEventLinks,
    });
  }

  resolveTransferFormat(format, filePath = '') {
    const normalizedFormat = String(format || '').trim().toLowerCase();
    if (normalizedFormat === 'json' || normalizedFormat === 'bundle') {
      return 'json';
    }

    if (normalizedFormat === 'ics') {
      return 'ics';
    }

    const extension = path.extname(String(filePath || '')).toLowerCase();
    if (extension === '.ics') {
      return 'ics';
    }

    return 'json';
  }

  resolveTransferPath(filePath, allowedExtensions = ['.json', '.ics']) {
    const resolvedPath = path.resolve(String(filePath || '').trim());
    if (!resolvedPath) {
      throw new Error('A file path is required.');
    }

    const extension = path.extname(resolvedPath).toLowerCase();
    if (!allowedExtensions.includes(extension)) {
      throw new Error(`Only ${allowedExtensions.join(', ')} files are supported.`);
    }

    return resolvedPath;
  }

  listExternalCalendars({ accountId }) {
    return this.oauthService.listExternalCalendars(accountId);
  }

  isProviderCalendarWritable(calendar = {}) {
    const accessRole = String(calendar.accessRole || '').trim().toLowerCase();
    if (calendar.provider === 'google') {
      return ['owner', 'writer'].includes(accessRole);
    }

    if (calendar.provider === 'microsoft') {
      return calendar.selected !== false && accessRole !== 'reader';
    }

    return false;
  }

  shouldSyncProviderInvite(event = {}) {
    return (
      normalizeInviteDeliveryMode(event.inviteDeliveryMode) === 'provider_invite' &&
      extractInviteeEmails(event.inviteRecipients).length > 0
    );
  }

  async resolveInviteTarget(event = {}) {
    const attendees = extractInviteeEmails(event.inviteRecipients);
    if (attendees.length === 0) {
      return null;
    }

    const expectedProvider = resolveInviteProviderFromEvent(event);
    if (!expectedProvider) {
      throw new Error('Internal events stay local. Switch the event scope to Work or Personal before sending invites.');
    }

    const targetProvider = normalizeInviteProvider(event.inviteTargetProvider) || expectedProvider;
    if (targetProvider !== expectedProvider) {
      throw new Error(
        expectedProvider === 'google'
          ? 'Work events must invite through a connected Google account.'
          : 'Personal events must invite through a connected Microsoft account.'
      );
    }

    if (!event.inviteTargetAccountId || !event.inviteTargetCalendarId) {
      throw new Error('Choose the connected account and calendar to send invites through.');
    }

    const account = this.listConnectedAccounts().find(
      (entry) => entry.accountId === event.inviteTargetAccountId
    );
    if (!account || account.status !== 'connected' || account.provider !== targetProvider) {
      throw new Error('The selected invite account is not connected for this event scope.');
    }

    if (!account.canWrite || !account.writeScopeGranted) {
      throw new Error('Reconnect the selected account with calendar write access before sending invites.');
    }

    const calendars = await this.oauthService.listExternalCalendars(account.accountId);
    const calendar = calendars.find(
      (entry) => entry.remoteCalendarId === event.inviteTargetCalendarId
    );
    if (!calendar || !this.isProviderCalendarWritable(calendar)) {
      throw new Error('The selected calendar is not writable. Choose a writable calendar for invites.');
    }

    return {
      account,
      calendar,
      attendees,
      provider: targetProvider,
    };
  }

  buildOutboundExternalProviderLinks(event = {}, remoteLink = {}) {
    const nextLink = {
      provider: remoteLink.provider,
      externalEventId: remoteLink.remoteEventId,
      url: remoteLink.url || '',
      mode: 'outbound',
      accountId: remoteLink.accountId || event.inviteTargetAccountId || '',
      remoteCalendarId: remoteLink.remoteCalendarId || event.inviteTargetCalendarId || '',
    };

    return [
      ...(event.externalProviderLinks || []).filter(
        (link) =>
          !(
            String(link?.mode || '').toLowerCase() === 'outbound' ||
            (link?.provider === nextLink.provider && link?.externalEventId === nextLink.externalEventId)
          )
      ),
      nextLink,
    ];
  }

  buildOutboundLinkInput(eventId, source, remoteLink, timestamp = nowIso()) {
    return {
      eventId,
      sourceId: source.sourceId,
      provider: remoteLink.provider,
      remoteCalendarId: remoteLink.remoteCalendarId,
      remoteEventId: remoteLink.remoteEventId,
      remoteVersion: remoteLink.remoteVersion || null,
      syncStatus: 'active',
      linkMode: 'outbound',
      lastSeenRemoteAt: null,
      lastPushError: null,
      lastPushedAt: timestamp,
      importedAt: timestamp,
    };
  }

  async pushOutboundInvite(event, existingEvent = null) {
    const target = await this.resolveInviteTarget(event);
    if (!target) {
      return null;
    }

    const activeOutboundLinks = existingEvent
      ? this.listExternalEventLinks({
          eventId: existingEvent.id,
          syncStatus: 'active',
          linkMode: 'outbound',
        })
      : [];
    const matchingLink = activeOutboundLinks.find((link) => {
      const source = this.getExternalCalendarSourceById(link.sourceId);
      return (
        source?.accountId === target.account.accountId &&
        source.provider === target.provider &&
        source.remoteCalendarId === target.calendar.remoteCalendarId
      );
    });

    const remoteLink = matchingLink
      ? await this.oauthService.updateOutboundCalendarEvent({
          accountId: target.account.accountId,
          remoteCalendarId: target.calendar.remoteCalendarId,
          remoteEventId: matchingLink.remoteEventId,
          event,
          attendees: target.attendees,
        })
      : await this.oauthService.createOutboundCalendarEvent({
          accountId: target.account.accountId,
          remoteCalendarId: target.calendar.remoteCalendarId,
          event,
          attendees: target.attendees,
        });

    if (!remoteLink?.remoteEventId) {
      throw new Error('The provider did not return an event id for the invite.');
    }

    const source = this.upsertExternalCalendarSource({
      accountId: target.account.accountId,
      provider: target.provider,
      remoteCalendarId: target.calendar.remoteCalendarId,
      displayName: target.calendar.displayName,
      selected: true,
      syncCursor: null,
      lastError: null,
    });

    return {
      eventPatch: {
        inviteTargetAccountId: target.account.accountId,
        inviteTargetProvider: target.provider,
        inviteTargetCalendarId: target.calendar.remoteCalendarId,
        inviteDeliveryMode: 'provider_invite',
        lastInviteError: '',
        externalProviderLinks: this.buildOutboundExternalProviderLinks(event, remoteLink),
      },
      source,
      linkInput: this.buildOutboundLinkInput(existingEvent?.id || '', source, remoteLink),
      detachPreviousOutbound: Boolean(existingEvent && !matchingLink),
    };
  }

  buildSanitizedExternalEventInput(remoteEvent = {}) {
    return sanitizeEventCreateInput({
      title: remoteEvent.title,
      description: remoteEvent.description || '',
      type: remoteEvent.type || 'meeting',
      completed: Boolean(remoteEvent.completed),
      repeat: remoteEvent.repeat || 'none',
      hasDeadline: Boolean(remoteEvent.hasDeadline),
      groupName: remoteEvent.groupName || '',
      location: remoteEvent.location || '',
      people: remoteEvent.people || [],
      inviteRecipients: remoteEvent.inviteRecipients || [],
      startsAt: remoteEvent.startsAt,
      endsAt: remoteEvent.endsAt,
      isAllDay: Boolean(remoteEvent.isAllDay),
      sourceTimeZone: remoteEvent.sourceTimeZone || '',
      reminderMinutesBeforeStart: remoteEvent.reminderMinutesBeforeStart ?? null,
      desktopNotificationEnabled: Boolean(remoteEvent.desktopNotificationEnabled),
      emailNotificationEnabled: Boolean(remoteEvent.emailNotificationEnabled),
      emailNotificationRecipients: remoteEvent.emailNotificationRecipients || [],
      notifications: remoteEvent.notifications || [],
      color: remoteEvent.color || '#4f9d69',
      tags: remoteEvent.tags || [],
      syncPolicy: remoteEvent.syncPolicy || 'internal_only',
      visibility: remoteEvent.visibility || 'private',
      externalProviderLinks: remoteEvent.externalProviderLinks || [],
    });
  }

  applyExternalSourceSnapshot(source, fetchedEvents = [], syncCursor = null) {
    const timestamp = nowIso();
    const seenRemoteIds = new Set();
    let createdCount = 0;
    let updatedCount = 0;
    let removedCount = 0;

    this.withTransaction(() => {
      for (const remoteEvent of fetchedEvents) {
        if (!remoteEvent?.remoteEventId) {
          continue;
        }

        seenRemoteIds.add(remoteEvent.remoteEventId);
        const existingLink = this.findExternalEventLink(
          source.provider,
          source.remoteCalendarId,
          remoteEvent.remoteEventId,
          source.sourceId
        );

        if (existingLink?.syncStatus === 'detached') {
          continue;
        }

        if (remoteEvent.remoteDeleted) {
          if (existingLink && existingLink.syncStatus === 'active') {
            this.db
              .prepare(
                `UPDATE event_metadata
                 SET deleted = 1,
                     updated_at = :updatedAt,
                     updated_by = :updatedBy
                 WHERE id = :eventId`
              )
              .run({
                eventId: existingLink.eventId,
                updatedAt: timestamp,
                updatedBy: this.deviceId,
              });
            this.upsertExternalEventLink({
              ...existingLink,
              syncStatus: 'removed',
              lastSeenRemoteAt: timestamp,
            });
            this.recordChange({
              entity: 'event',
              entityId: existingLink.eventId,
              operation: 'delete',
              patch: { deleted: true },
              deviceId: this.deviceId,
              signatureKeyId: this.deviceId,
            });
            removedCount += 1;
          }
          continue;
        }

        const sanitized = this.buildSanitizedExternalEventInput(remoteEvent);
        const targetEventId = existingLink?.eventId || createId('event');
        const existingEvent = this.getEventById(targetEventId);
        const upserted = this.upsertEventRecord(
          {
            ...sanitized,
            id: targetEventId,
          },
          { deviceId: this.deviceId }
        );

        this.upsertExternalEventLink({
          eventId: upserted.id,
          sourceId: source.sourceId,
          provider: source.provider,
          remoteCalendarId: source.remoteCalendarId,
          remoteEventId: remoteEvent.remoteEventId,
          remoteVersion: remoteEvent.remoteVersion || null,
          syncStatus: 'active',
          linkMode: 'imported',
          lastSeenRemoteAt: timestamp,
          importedAt: existingLink?.importedAt || timestamp,
        });

        if (!existingEvent) {
          createdCount += 1;
        } else if (
          existingLink?.syncStatus === 'active' ||
          existingLink?.syncStatus === 'removed'
        ) {
          updatedCount += 1;
        }
      }

      const activeLinks = this.listExternalEventLinks({
        sourceId: source.sourceId,
        syncStatus: 'active',
        linkMode: 'imported',
      });
      for (const link of activeLinks) {
        if (seenRemoteIds.has(link.remoteEventId)) {
          continue;
        }

        this.db
          .prepare(
            `UPDATE event_metadata
             SET deleted = 1,
                 updated_at = :updatedAt,
                 updated_by = :updatedBy
             WHERE id = :eventId`
          )
          .run({
            eventId: link.eventId,
            updatedAt: timestamp,
            updatedBy: this.deviceId,
          });
        this.upsertExternalEventLink({
          ...link,
          syncStatus: 'removed',
          lastSeenRemoteAt: timestamp,
        });
        this.recordChange({
          entity: 'event',
          entityId: link.eventId,
          operation: 'delete',
          patch: { deleted: true },
          deviceId: this.deviceId,
          signatureKeyId: this.deviceId,
        });
        removedCount += 1;
      }

      this.upsertExternalCalendarSource({
        ...source,
        syncCursor,
        lastSyncedAt: timestamp,
        lastError: null,
      });
    });

    return {
      source: this.getExternalCalendarSourceById(source.sourceId),
      createdCount,
      updatedCount,
      removedCount,
      snapshot: this.snapshot(),
    };
  }

  async importExternalCalendar({ accountId, remoteCalendarId }) {
    const calendars = await this.oauthService.listExternalCalendars(accountId);
    const calendar = calendars.find((entry) => entry.remoteCalendarId === remoteCalendarId);
    if (!calendar) {
      throw new Error('External calendar was not found.');
    }

    const source = this.upsertExternalCalendarSource({
      accountId,
      provider: calendar.provider,
      remoteCalendarId: calendar.remoteCalendarId,
      displayName: calendar.displayName,
      selected: true,
      syncCursor: null,
    });
    const remoteState = await this.oauthService.listExternalEvents(
      accountId,
      remoteCalendarId,
      calendar
    );

    return this.applyExternalSourceSnapshot(source, remoteState.events, remoteState.syncCursor);
  }

  async refreshExternalSource({ sourceId }) {
    const source = this.getExternalCalendarSourceById(sourceId);
    if (!source) {
      throw new Error('External calendar source was not found.');
    }

    try {
      const remoteState = await this.oauthService.listExternalEvents(
        source.accountId,
        source.remoteCalendarId,
        source
      );
      return this.applyExternalSourceSnapshot(source, remoteState.events, remoteState.syncCursor);
    } catch (error) {
      this.upsertExternalCalendarSource({
        ...source,
        lastError: error?.message || 'External refresh failed.',
      });
      throw error;
    }
  }

  importCalendarBundle(bundle) {
    const normalizedBundle = typeof bundle === 'string' ? parseCalendarBundleText(bundle) : buildCalendarBundle(bundle);
    let importedCount = 0;

    this.withTransaction(() => {
      if (normalizedBundle.tags.length > 0) {
        this.upsertTagCatalog(normalizedBundle.tags);
      }

      for (const source of normalizedBundle.externalCalendarSources || []) {
        this.upsertExternalCalendarSource(source);
      }

      for (const eventInput of normalizedBundle.events || []) {
        const sanitized = sanitizeEventCreateInput({
          ...eventInput,
          externalProviderLinks: eventInput.externalProviderLinks || [],
        });
        this.upsertEventRecord(
          {
            ...sanitized,
            id: eventInput.id || createId('event'),
          },
          { deviceId: this.deviceId }
        );
        importedCount += 1;
      }

      for (const link of normalizedBundle.externalEventLinks || []) {
        if (this.getEventById(link.eventId) && this.getExternalCalendarSourceById(link.sourceId)) {
          this.upsertExternalEventLink(link);
        }
      }
    });

    return {
      format: 'json',
      bundleVersion: CALENDAR_BUNDLE_VERSION,
      importedCount,
      snapshot: this.snapshot(),
    };
  }

  importIcsText(text) {
    const parsedEvents = parseIcsText(text);
    let importedCount = 0;

    this.withTransaction(() => {
      for (const parsedEvent of parsedEvents) {
        const sanitized = sanitizeEventCreateInput(parsedEvent);
        this.insertEventRecord(sanitized, { deviceId: this.deviceId });
        importedCount += 1;
      }
    });

    return {
      format: 'ics',
      importedCount,
      snapshot: this.snapshot(),
    };
  }

  importData({ format, path: filePath }) {
    const resolvedPath = this.resolveTransferPath(filePath);
    const detectedFormat = this.resolveTransferFormat(format, resolvedPath);
    const raw = fs.readFileSync(resolvedPath, 'utf8');

    const result =
      detectedFormat === 'ics' ? this.importIcsText(raw) : this.importCalendarBundle(raw);

    this.logSecurityEvent('calendar_data_imported', {
      targetType: 'import',
      targetId: resolvedPath,
      details: {
        format: detectedFormat,
        importedCount: result.importedCount,
      },
    });

    return {
      ...result,
      path: resolvedPath,
    };
  }

  async importDataFromFilePicker() {
    if (!this.dialog?.showOpenDialog) {
      throw new Error('File picker is not available.');
    }

    const openResult = await this.dialog.showOpenDialog({
      title: 'Import calendar file',
      buttonLabel: 'Import',
      properties: ['openFile'],
      filters: [
        { name: 'Calendar files', extensions: ['ics', 'json'] },
        { name: 'iCalendar', extensions: ['ics'] },
        { name: 'Calendar App bundle', extensions: ['json'] },
      ],
    });

    const [filePath] = openResult?.filePaths || [];
    if (!openResult || openResult.canceled || !filePath) {
      return {
        canceled: true,
      };
    }

    return {
      canceled: false,
      ...this.importData({ path: filePath }),
    };
  }

  exportData({ format, path: filePath, scope = 'all' }) {
    const detectedFormat = this.resolveTransferFormat(format, filePath);
    const resolvedPath = this.resolveTransferPath(
      filePath,
      detectedFormat === 'ics' ? ['.ics'] : ['.json']
    );

    if (detectedFormat === 'ics') {
      const icsText = serializeEventsToIcs(this.filterEventsByScope(this.listEvents(false), scope));
      fs.writeFileSync(resolvedPath, icsText, 'utf8');
    } else {
      const bundleText = serializeCalendarBundle(this.buildExportBundle(scope));
      fs.writeFileSync(resolvedPath, bundleText, 'utf8');
    }

    this.logSecurityEvent('calendar_data_exported', {
      targetType: 'export',
      targetId: resolvedPath,
      details: {
        format: detectedFormat,
      },
    });

    return {
      format: detectedFormat,
      path: resolvedPath,
    };
  }

  createLocalSession({ mode = 'snapshot', scope = 'all', label = 'Phone transport' } = {}) {
    const normalizedMode = normalizeTransportMode(mode);
    const sessionId = createId('transport');
    const sessionToken = crypto.randomBytes(24).toString('base64url');
    const approval = this.deviceService.createPairingApproval(label);
    const expiresAt = new Date(Date.now() + LOCAL_TRANSPORT_SESSION_TTL_MS).toISOString();
    const scopeValue = cloneScopeValue(scope);

    this.db
      .prepare(
        `INSERT INTO local_transport_sessions (
          session_id,
          approval_id,
          session_token_hash,
          mode,
          scope_json,
          base_sequence,
          expires_at,
          created_at,
          closed_at
        ) VALUES (
          :sessionId,
          :approvalId,
          :sessionTokenHash,
          :mode,
          :scopeJson,
          :baseSequence,
          :expiresAt,
          :createdAt,
          NULL
        )`
      )
      .run({
        sessionId,
        approvalId: approval.approvalId,
        sessionTokenHash: crypto.createHash('sha256').update(sessionToken, 'utf8').digest('hex'),
        mode: normalizedMode,
        scopeJson: JSON.stringify(scopeValue ?? 'all'),
        baseSequence: Number(this.getMeta('lastSequence') || '0'),
        expiresAt,
        createdAt: nowIso(),
      });

    return {
      sessionId,
      approvalId: approval.approvalId,
      code: approval.code,
      mode: normalizedMode,
      expiresAt,
      invite: {
        version: 'local-transport-invite-v1',
        sessionId,
        approvalId: approval.approvalId,
        token: sessionToken,
        deviceId: this.deviceId,
        expiresAt,
      },
    };
  }

  consumeLocalSession({ sessionId, token, device = null }) {
    const row = this.db
      .prepare(
        `SELECT
          session_id AS sessionId,
          approval_id AS approvalId,
          session_token_hash AS sessionTokenHash,
          mode,
          scope_json AS scopeJson,
          base_sequence AS baseSequence,
          expires_at AS expiresAt,
          created_at AS createdAt,
          closed_at AS closedAt
         FROM local_transport_sessions
         WHERE session_id = :sessionId
         LIMIT 1`
      )
      .get({ sessionId });

    if (!row) {
      throw new Error('Local transport session was not found.');
    }

    if (row.closedAt) {
      throw new Error('Local transport session is already closed.');
    }

    if (new Date(row.expiresAt).getTime() <= Date.now()) {
      throw new Error('Local transport session has expired.');
    }

    const tokenHash = crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
    if (tokenHash !== row.sessionTokenHash) {
      throw new Error('Local transport token did not match.');
    }

    const scope = JSON.parse(row.scopeJson || '"all"');
    const bundle = this.buildExportBundle(scope);
    const payload =
      normalizeTransportMode(row.mode) === 'delta'
        ? {
            mode: 'delta',
            baseSequence: Number(row.baseSequence || 0),
            envelopes: this.listHostedSyncEnvelopesSince(Number(row.baseSequence || 0)),
          }
        : {
            mode: 'snapshot',
            bundleVersion: CALENDAR_BUNDLE_VERSION,
            bundleGzipBase64: zlib
              .gzipSync(Buffer.from(serializeCalendarBundle(bundle), 'utf8'))
              .toString('base64'),
          };

    this.db
      .prepare(
        `UPDATE local_transport_sessions
         SET closed_at = :closedAt
         WHERE session_id = :sessionId`
      )
      .run({
        sessionId,
        closedAt: nowIso(),
      });

    this.logSecurityEvent('local_transport_session_consumed', {
      targetType: 'transport',
      targetId: sessionId,
      details: {
        mode: row.mode,
        device,
      },
    });

    return {
      sessionId,
      approvalId: row.approvalId,
      payload,
    };
  }

  createEvent(input) {
    const sanitized = normalizeAllDayEventDuration(
      sanitizeEventCreateInput(input, {
        titleMaxLength: EVENT_TITLE_MAX_LENGTH,
      })
    );

    if (this.shouldSyncProviderInvite(sanitized)) {
      return this.createEventWithOutboundInvite(sanitized);
    }

    this.maybeMarkDemoSeedModified();
    this.withTransaction(() => {
      this.insertEventRecord(sanitized, { deviceId: this.deviceId });
    });
    return this.snapshot();
  }

  async createEventWithOutboundInvite(sanitized) {
    const outboundSync = await this.pushOutboundInvite(sanitized, null);
    const eventInput = outboundSync
      ? {
          ...sanitized,
          ...outboundSync.eventPatch,
        }
      : sanitized;

    this.maybeMarkDemoSeedModified();
    this.withTransaction(() => {
      const createdEvent = this.insertEventRecord(eventInput, { deviceId: this.deviceId });
      if (outboundSync?.linkInput) {
        this.upsertExternalEventLink({
          ...outboundSync.linkInput,
          eventId: createdEvent.id,
        });
      }
    });

    return this.snapshot();
  }

  updateEvent(input) {
    const event = this.getEventById(input.id);
    if (!event || event.deleted) {
      throw new Error('Event not found');
    }

    const sanitizedPatch = sanitizeEventUpdateInput(input, {
      titleMaxLength: EVENT_TITLE_MAX_LENGTH,
    });
    const nextEvent = normalizeAllDayEventDuration({
      ...event,
      ...sanitizedPatch,
    });

    if (nextEvent.endsAt <= nextEvent.startsAt) {
      throw new Error('Event end time must be after the start time.');
    }

    if (this.shouldSyncProviderInvite(nextEvent)) {
      return this.updateEventWithOutboundInvite(event, nextEvent);
    }

    return this.applyLocalEventUpdate(event, nextEvent, {
      detachImported: true,
      detachOutbound: normalizeInviteDeliveryMode(nextEvent.inviteDeliveryMode) === 'local_only',
    });
  }

  applyLocalEventUpdate(event, nextEvent, options = {}) {
    const nextContent = this.buildEventContent(nextEvent);
    const currentContent = {
      title: event.title,
      description: event.description,
      groupName: event.groupName,
      location: event.location || '',
      people: event.people || [],
      inviteRecipients: event.inviteRecipients || [],
      sourceTimeZone: event.sourceTimeZone || '',
      reminderMinutesBeforeStart: event.reminderMinutesBeforeStart ?? null,
      desktopNotificationEnabled: Boolean(event.desktopNotificationEnabled),
      emailNotificationEnabled: Boolean(event.emailNotificationEnabled),
      emailNotificationRecipients: event.emailNotificationRecipients || [],
      notifications: normalizeStoredNotifications(event),
      tags: event.tags,
      inviteTargetAccountId: event.inviteTargetAccountId || '',
      inviteTargetProvider: normalizeInviteProvider(event.inviteTargetProvider),
      inviteTargetCalendarId: event.inviteTargetCalendarId || '',
      inviteDeliveryMode: normalizeInviteDeliveryMode(event.inviteDeliveryMode),
      lastInviteError: event.lastInviteError || '',
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
      'isAllDay',
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

    if (
      Object.keys(metadataPatch).length === 0 &&
      !contentChanged &&
      !options.outboundLinkInput &&
      !options.detachOutbound &&
      !options.detachPreviousOutbound
    ) {
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
               is_all_day = :isAllDay,
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
          isAllDay: nextEvent.isAllDay ? 1 : 0,
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

        if (nextContent.location !== currentContent.location) {
          changePatch.location = nextContent.location;
        }

        if (JSON.stringify(nextContent.people) !== JSON.stringify(currentContent.people)) {
          changePatch.people = nextContent.people;
        }

        if (
          JSON.stringify(nextContent.inviteRecipients) !==
          JSON.stringify(currentContent.inviteRecipients)
        ) {
          changePatch.inviteRecipients = nextContent.inviteRecipients;
        }

        if (nextContent.sourceTimeZone !== currentContent.sourceTimeZone) {
          changePatch.sourceTimeZone = nextContent.sourceTimeZone;
        }

        if (
          nextContent.reminderMinutesBeforeStart !== currentContent.reminderMinutesBeforeStart
        ) {
          changePatch.reminderMinutesBeforeStart = nextContent.reminderMinutesBeforeStart;
        }

        if (
          nextContent.desktopNotificationEnabled !== currentContent.desktopNotificationEnabled
        ) {
          changePatch.desktopNotificationEnabled = nextContent.desktopNotificationEnabled;
        }

        if (nextContent.emailNotificationEnabled !== currentContent.emailNotificationEnabled) {
          changePatch.emailNotificationEnabled = nextContent.emailNotificationEnabled;
        }

        if (
          JSON.stringify(nextContent.emailNotificationRecipients) !==
          JSON.stringify(currentContent.emailNotificationRecipients)
        ) {
          changePatch.emailNotificationRecipients = nextContent.emailNotificationRecipients;
        }

        if (
          JSON.stringify(nextContent.notifications) !==
          JSON.stringify(currentContent.notifications)
        ) {
          changePatch.notifications = nextContent.notifications;
        }

        if (JSON.stringify(nextContent.tags) !== JSON.stringify(currentContent.tags)) {
          changePatch.tags = nextContent.tags;
        }

        for (const field of [
          'inviteTargetAccountId',
          'inviteTargetProvider',
          'inviteTargetCalendarId',
          'inviteDeliveryMode',
          'lastInviteError',
        ]) {
          if (JSON.stringify(nextContent[field]) !== JSON.stringify(currentContent[field])) {
            changePatch[field] = nextContent[field];
          }
        }

        if (
          JSON.stringify(nextContent.externalProviderLinks) !==
          JSON.stringify(currentContent.externalProviderLinks)
        ) {
          changePatch.externalProviderLinks = nextContent.externalProviderLinks;
        }
      }

      if (options.detachImported !== false) {
        this.updateExternalLinkStatus(event.id, 'detached', { linkMode: 'imported' });
      }

      if (options.detachOutbound) {
        this.updateExternalLinkStatus(event.id, 'detached', { linkMode: 'outbound' });
      }

      if (options.detachPreviousOutbound) {
        this.updateExternalLinkStatus(event.id, 'detached', { linkMode: 'outbound' });
      }

      if (options.outboundLinkInput) {
        this.upsertExternalEventLink({
          ...options.outboundLinkInput,
          eventId: event.id,
        });
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

  async updateEventWithOutboundInvite(event, nextEvent) {
    const outboundSync = await this.pushOutboundInvite(nextEvent, event);
    const eventInput = outboundSync
      ? {
          ...nextEvent,
          ...outboundSync.eventPatch,
        }
      : nextEvent;

    return this.applyLocalEventUpdate(event, eventInput, {
      detachImported: true,
      detachPreviousOutbound: outboundSync?.detachPreviousOutbound,
      outboundLinkInput: outboundSync?.linkInput || null,
    });
  }

  deleteEvent(eventId) {
    const event = this.getEventById(eventId);
    if (!event || event.deleted) {
      throw new Error('Event not found');
    }

    const outboundLinks = this.listExternalEventLinks({
      eventId,
      syncStatus: 'active',
      linkMode: 'outbound',
    });
    if (outboundLinks.length > 0) {
      return this.deleteEventWithOutboundInvites(event, outboundLinks);
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

      this.updateExternalLinkStatus(eventId, 'detached', { linkMode: 'imported' });

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

  async deleteEventWithOutboundInvites(event, outboundLinks = []) {
    for (const link of outboundLinks) {
      const source = this.getExternalCalendarSourceById(link.sourceId);
      if (!source) {
        continue;
      }

      await this.oauthService.deleteOutboundCalendarEvent({
        accountId: source.accountId,
        remoteCalendarId: source.remoteCalendarId,
        remoteEventId: link.remoteEventId,
      });
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
          id: event.id,
          updatedAt: nowIso(),
          updatedBy: this.deviceId,
        });

      this.updateExternalLinkStatus(event.id, 'detached', { linkMode: 'imported' });
      this.updateExternalLinkStatus(event.id, 'removed', { linkMode: 'outbound' });

      this.recordChange({
        entity: 'event',
        entityId: event.id,
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

  getOAuthClientConfig() {
    return this.oauthService.getClientConfigSnapshot();
  }

  updateOAuthClientConfig(input = {}) {
    const clientConfig = this.oauthService.updateClientConfig(input);
    this.logSecurityEvent('oauth_client_config_updated', {
      targetType: 'oauth',
      targetId: 'client-config',
      details: {
        googleConfigured: Boolean(clientConfig.google?.clientIdConfigured),
        microsoftConfigured: Boolean(clientConfig.microsoft?.clientIdConfigured),
      },
    });

    return {
      clientConfig,
      security: this.getSecuritySnapshot(),
    };
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

  testHostedBackend(baseUrl) {
    return this.runHostedAction(() => this.hostedSyncService.testConnection(baseUrl));
  }

  registerHostedAccount(input) {
    return this.runHostedAction(() => this.hostedSyncService.register(input || {}));
  }

  loginHostedAccount(input) {
    return this.runHostedAction(() => this.hostedSyncService.login(input || {}));
  }

  syncHostedNow() {
    return this.runHostedAction(() => this.hostedSyncService.syncNow());
  }

  disconnectHostedSync() {
    return this.runHostedAction(() => this.hostedSyncService.disconnect());
  }

  async exportHostedEnvFile(values) {
    const envContent = this.hostedSyncService.buildEnvFile(values || {});
    const saveResult = await this.dialog?.showSaveDialog({
      title: 'Export SelfHdb .env',
      defaultPath: path.join(os.homedir(), '.env'),
      buttonLabel: 'Save .env',
    });

    if (!saveResult || saveResult.canceled || !saveResult.filePath) {
      return {
        canceled: true,
      };
    }

    fs.writeFileSync(saveResult.filePath, `${envContent}\n`, 'utf8');

    this.logSecurityEvent('hosted_env_exported', {
      targetType: 'hosted_backend',
      targetId: saveResult.filePath,
    });

    return {
      canceled: false,
      filePath: saveResult.filePath,
    };
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

  listDueReminderEntries({ now = new Date(), gracePeriodMinutes = 5 } = {}) {
    const nowDate = now instanceof Date ? now : new Date(now);
    const lowerBound = new Date(nowDate.getTime() - Number(gracePeriodMinutes || 5) * 60 * 1000);
    const candidateStartsAfter = new Date(
      lowerBound.getTime() + 1 * 60 * 1000
    ).toISOString();
    const candidateStartsBefore = new Date(
      nowDate.getTime() + MAX_STORED_REMINDER_MINUTES * 60 * 1000
    ).toISOString();
    const candidateRows = this.db
      .prepare(
        `SELECT id
         FROM event_metadata
         WHERE deleted = 0
           AND starts_at >= :candidateStartsAfter
           AND starts_at <= :candidateStartsBefore
         ORDER BY starts_at ASC`
      )
      .all({
        candidateStartsAfter,
        candidateStartsBefore,
      });
    const candidateEvents = candidateRows.flatMap((row) => {
      const event = this.getEventById(row.id);
      return event ? [event] : [];
    });

    return candidateEvents.flatMap((event) => {
      const notifications = normalizeStoredNotifications(event);

      return notifications.flatMap((notification) => {
        const reminderMinutes = Number(notification.reminderMinutesBeforeStart);
        if (!Number.isFinite(reminderMinutes) || reminderMinutes <= 0) {
          return [];
        }

        if (
          !notification.desktopNotificationEnabled &&
          !notification.emailNotificationEnabled
        ) {
          return [];
        }

        const reminderAt = new Date(
          new Date(event.startsAt).getTime() - reminderMinutes * 60 * 1000
        );
        if (
          Number.isNaN(reminderAt.getTime()) ||
          reminderAt > nowDate ||
          reminderAt < lowerBound
        ) {
          return [];
        }

        return [
          {
            ...event,
            notificationId: notification.id,
            reminderMinutesBeforeStart: notification.reminderMinutesBeforeStart,
            desktopNotificationEnabled: Boolean(notification.desktopNotificationEnabled),
            emailNotificationEnabled: Boolean(notification.emailNotificationEnabled),
            emailNotificationRecipients: notification.emailNotificationRecipients || [],
            reminderAt: reminderAt.toISOString(),
          },
        ];
      });
    });
  }

  hasReminderDispatch({ eventId, channel, recipient = '', reminderAt }) {
    const row = this.db
      .prepare(
        `SELECT dispatch_id AS dispatchId
         FROM reminder_dispatch_log
         WHERE event_id = :eventId
           AND channel = :channel
           AND recipient = :recipient
           AND reminder_at = :reminderAt
         LIMIT 1`
      )
      .get({
        eventId,
        channel,
        recipient,
        reminderAt,
      });

    return Boolean(row?.dispatchId);
  }

  recordReminderDispatch({ eventId, channel, recipient = '', reminderAt, sentAt = nowIso() }) {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO reminder_dispatch_log (
          dispatch_id,
          event_id,
          channel,
          recipient,
          reminder_at,
          sent_at,
          created_at
        ) VALUES (
          :dispatchId,
          :eventId,
          :channel,
          :recipient,
          :reminderAt,
          :sentAt,
          :createdAt
        )`
      )
      .run({
        dispatchId: createId('reminder_dispatch'),
        eventId,
        channel,
        recipient,
        reminderAt,
        sentAt,
        createdAt: sentAt,
      });
  }

  close() {
    this.oauthService?.close?.();
    this.db.close();
  }

  validateImportPath(candidatePath) {
    return validateImportPath(candidatePath, this.baseDir);
  }
}

module.exports = { CalendarStore };
