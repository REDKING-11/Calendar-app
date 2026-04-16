const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { CalendarStore } = require('../src/data/calendar-store');

function createMockSafeStorage() {
  return {
    isEncryptionAvailable() {
      return true;
    },
    encryptString(value) {
      return Buffer.from(`enc:${value}`, 'utf8');
    },
    decryptString(buffer) {
      const text = Buffer.from(buffer).toString('utf8');
      if (!text.startsWith('enc:')) {
        throw new Error('Invalid protected secret');
      }

      return text.slice(4);
    },
  };
}

function createStoreFixture(prefix) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const store = new CalendarStore(tempDir, {
    safeStorage: createMockSafeStorage(),
    shell: { openExternal() {} },
  });

  return {
    tempDir,
    store,
    cleanup() {
      store.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function testEncryptedAtRest() {
  const fixture = createStoreFixture('calendar-store-test-');

  try {
    const title = 'ULTRA_SECRET_TITLE_439A';
    const description = 'ULTRA_SECRET_DESCRIPTION_93BD';
    fixture.store.createEvent({
      title,
      description,
      type: 'event',
      startsAt: '2026-04-16T09:00:00.000Z',
      endsAt: '2026-04-16T10:00:00.000Z',
      color: '#4f9d69',
      tags: [{ label: 'Highly private', color: '#1d4ed8' }],
    });

    const dbBytes = fs.readFileSync(path.join(fixture.tempDir, 'calendar-data.db'));
    assert.equal(dbBytes.includes(Buffer.from(title, 'utf8')), false);
    assert.equal(dbBytes.includes(Buffer.from(description, 'utf8')), false);

    const snapshot = fixture.store.snapshot();
    assert.equal(snapshot.events.some((event) => event.title === title), true);
  } finally {
    fixture.cleanup();
  }
}

function testLegacyMigration() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-store-migrate-'));
  const legacyPath = path.join(tempDir, 'calendar-data.json');
  const legacyTitle = 'LEGACY_SECRET_TITLE_D12F';

  fs.writeFileSync(
    legacyPath,
    JSON.stringify(
      {
        schemaVersion: 2,
        deviceId: 'device_legacy',
        lastSequence: 0,
        events: [
          {
            id: 'event_legacy',
            title: legacyTitle,
            description: 'legacy description',
            type: 'event',
            completed: false,
            repeat: 'none',
            hasDeadline: false,
            groupName: '',
            startsAt: '2026-04-16T09:00:00.000Z',
            endsAt: '2026-04-16T10:00:00.000Z',
            color: '#4f9d69',
            tags: [{ id: 'tag_legacy', label: 'Legacy', color: '#1d4ed8' }],
          },
        ],
        changes: [],
        tags: [{ id: 'tag_legacy', label: 'Legacy', color: '#1d4ed8' }],
      },
      null,
      2
    )
  );

  const store = new CalendarStore(tempDir, {
    safeStorage: createMockSafeStorage(),
    shell: { openExternal() {} },
  });

  try {
    const snapshot = store.snapshot();
    assert.equal(snapshot.events.length, 1);
    assert.equal(snapshot.events[0].title, legacyTitle);
    assert.equal(fs.existsSync(legacyPath), false);

    const backupPath = path.join(tempDir, 'calendar-data.legacy-backup.enc');
    assert.equal(fs.existsSync(backupPath), true);
    const backupBytes = fs.readFileSync(backupPath);
    assert.equal(backupBytes.includes(Buffer.from(legacyTitle, 'utf8')), false);
  } finally {
    store.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function testKeyRotation() {
  const fixture = createStoreFixture('calendar-store-rotate-');

  try {
    fixture.store.createEvent({
      title: 'Rotating secret',
      description: 'This event should survive key rotation.',
      type: 'event',
      startsAt: '2026-04-16T11:00:00.000Z',
      endsAt: '2026-04-16T12:00:00.000Z',
      color: '#4f9d69',
      tags: [{ label: 'Rotation', color: '#1d4ed8' }],
    });

    const challenge = fixture.store.beginReauth('rotateMasterKey');
    const approval = fixture.store.completeReauth(
      challenge.challengeId,
      challenge.confirmationPhrase
    );

    const rotated = fixture.store.rotateMasterKey(approval.approvalId);
    assert.equal(rotated.storage.vault.protectionMode, 'safeStorage');

    const snapshot = fixture.store.snapshot();
    assert.equal(
      snapshot.events.some((event) => event.title === 'Rotating secret'),
      true
    );
  } finally {
    fixture.cleanup();
  }
}

function testHostedBootstrapClearsDemoSeed() {
  const fixture = createStoreFixture('calendar-store-hosted-bootstrap-');

  try {
    const before = fixture.store.snapshot();
    assert.equal(before.events.length > 0, true);
    assert.equal(before.changes.length > 0, true);

    fixture.store.prepareHostedBootstrap();

    const after = fixture.store.snapshot();
    assert.equal(after.events.length, 0);
    assert.equal(after.changes.length, 0);
  } finally {
    fixture.cleanup();
  }
}

function testHostedEnvelopeProjection() {
  const sourceFixture = createStoreFixture('calendar-store-hosted-source-');
  const targetFixture = createStoreFixture('calendar-store-hosted-target-');

  try {
    sourceFixture.store.prepareHostedBootstrap();
    targetFixture.store.prepareHostedBootstrap();

    sourceFixture.store.createEvent({
      title: 'Hosted sync secret',
      description: 'This should arrive through a hosted sync envelope.',
      type: 'event',
      startsAt: '2026-04-16T13:00:00.000Z',
      endsAt: '2026-04-16T14:00:00.000Z',
      color: '#4f9d69',
      tags: [{ label: 'Hosted', color: '#1d4ed8' }],
    });

    const envelopes = sourceFixture.store.listHostedSyncEnvelopesSince(0);
    assert.equal(envelopes.length, 1);
    assert.equal(envelopes[0].contentPatch.title, 'Hosted sync secret');

    targetFixture.store.applyHostedEnvelope(envelopes[0]);

    const targetSnapshot = targetFixture.store.snapshot();
    assert.equal(targetSnapshot.events.length, 1);
    assert.equal(targetSnapshot.events[0].title, 'Hosted sync secret');
    assert.equal(targetSnapshot.events[0].description, 'This should arrive through a hosted sync envelope.');
  } finally {
    sourceFixture.cleanup();
    targetFixture.cleanup();
  }
}

function main() {
  const checks = [
    ['encrypted_at_rest', testEncryptedAtRest],
    ['legacy_migration', testLegacyMigration],
    ['master_key_rotation', testKeyRotation],
    ['hosted_bootstrap_clears_demo_seed', testHostedBootstrapClearsDemoSeed],
    ['hosted_envelope_projection', testHostedEnvelopeProjection],
  ];

  for (const [name, check] of checks) {
    check();
    console.log(`PASS ${name}`);
  }
}

main();
