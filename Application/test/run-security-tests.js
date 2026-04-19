const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const { transformFileSync } = require('@babel/core');

const { CalendarStore } = require('../src/data/calendar-store');
const { ReminderService, resolveReminderScope } = require('../src/reminder-service');
const { sanitizeEventCreateInput, sanitizeEventUpdateInput } = require('../src/security/validation');

function loadTranspiledModule(modulePath) {
  const transformed = transformFileSync(modulePath, {
    filename: modulePath,
    babelrc: false,
    configFile: false,
    presets: [
      [
        require.resolve('@babel/preset-env'),
        {
          modules: 'commonjs',
          targets: {
            node: 'current',
          },
        },
      ],
    ],
  });

  const loadedModule = new Module(modulePath, module);
  loadedModule.filename = modulePath;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(modulePath));
  loadedModule._compile(transformed.code, modulePath);
  return loadedModule.exports;
}

const eventDraft = loadTranspiledModule(
  path.join(__dirname, '..', 'src', 'renderer', 'eventDraft.js')
);
const clickIntent = loadTranspiledModule(
  path.join(__dirname, '..', 'src', 'renderer', 'clickIntent.js')
);
const composerRouting = loadTranspiledModule(
  path.join(__dirname, '..', 'src', 'renderer', 'composerRouting.js')
);

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

function createNotificationInput(
  id,
  {
    reminderMinutesBeforeStart = 15,
    desktopNotificationEnabled = true,
    emailNotificationEnabled = false,
    emailNotificationRecipients = [],
  } = {}
) {
  return {
    id,
    reminderMinutesBeforeStart,
    desktopNotificationEnabled,
    emailNotificationEnabled,
    emailNotificationRecipients,
  };
}

function createFakeTimer() {
  let nextId = 1;
  const tasks = new Map();

  return {
    schedule(callback) {
      const id = nextId++;
      tasks.set(id, callback);
      return id;
    },
    cancel(id) {
      tasks.delete(id);
    },
    flushAll() {
      for (const [id, callback] of Array.from(tasks.entries())) {
        tasks.delete(id);
        callback();
      }
    },
    get size() {
      return tasks.size;
    },
  };
}

function testClickIntentHelpers() {
  const timer = createFakeTimer();
  const singles = [];
  const doubles = [];
  const router = clickIntent.createClickIntentRouter({
    onSingle: (payload) => singles.push(payload),
    onDouble: (payload) => doubles.push(payload),
    schedule: (callback) => timer.schedule(callback),
    cancel: (id) => timer.cancel(id),
  });

  router.handleSingle({ kind: 'slot', id: 'slot-1' });
  assert.equal(singles.length, 0);
  assert.equal(doubles.length, 0);
  timer.flushAll();
  assert.deepEqual(singles, [{ kind: 'slot', id: 'slot-1' }]);
  assert.equal(doubles.length, 0);

  router.handleSingle({ kind: 'event', id: 'event-1' });
  assert.equal(timer.size, 1);
  router.handleDouble({ kind: 'event', id: 'event-1' });
  assert.equal(timer.size, 0);
  timer.flushAll();
  assert.equal(singles.length, 1);
  assert.deepEqual(doubles, [{ kind: 'event', id: 'event-1' }]);

  router.handleSingle({ kind: 'slot', id: 'slot-2' });
  assert.equal(timer.size, 1);
  router.cancelPending();
  assert.equal(timer.size, 0);
  timer.flushAll();
  assert.equal(singles.length, 1);
}

function testComposerRoutingHelpers() {
  const slotDate = new Date(2026, 3, 16, 9, 0, 0, 0);
  assert.equal(composerRouting.buildSlotSignature(slotDate), '2026-04-16T09:00');

  assert.equal(
    composerRouting.shouldPromoteQuickCreateDraft({
      composerState: { variant: 'quick', mode: 'create', anchorPoint: { x: 10, y: 20 } },
      activeEvent: null,
      draftEvent: { date: '2026-04-16', time: '09:00' },
      requestDate: slotDate,
    }),
    true
  );

  assert.equal(
    composerRouting.shouldPromoteQuickCreateDraft({
      composerState: { variant: 'quick', mode: 'create', anchorPoint: { x: 10, y: 20 } },
      activeEvent: null,
      draftEvent: { date: '2026-04-16', time: '10:00' },
      requestDate: slotDate,
    }),
    false
  );

  assert.equal(
    composerRouting.shouldPromoteQuickEditDraft({
      composerState: { variant: 'quick', mode: 'edit', anchorPoint: { x: 10, y: 20 } },
      activeEvent: { id: 'event-1' },
      requestEvent: { id: 'event-1' },
    }),
    true
  );

  assert.equal(
    composerRouting.shouldPromoteQuickEditDraft({
      composerState: { variant: 'quick', mode: 'edit', anchorPoint: { x: 10, y: 20 } },
      activeEvent: { id: 'event-1' },
      requestEvent: { id: 'event-2' },
    }),
    false
  );

  assert.deepEqual(
    composerRouting.promoteComposerStateToDrawer({
      variant: 'quick',
      mode: 'edit',
      anchorPoint: { x: 50, y: 60 },
    }),
    {
      variant: 'drawer',
      mode: 'edit',
      anchorPoint: null,
    }
  );
}

function testEventScopeHelpers() {
  const baseDate = new Date('2026-04-16T09:00:00.000Z');

  const internalDraft = eventDraft.createEmptyDraftEvent(baseDate, 30, { scope: 'internal' });
  const workDraft = eventDraft.createEmptyDraftEvent(baseDate, 30, { scope: 'work' });
  const personalDraft = eventDraft.createEmptyDraftEvent(baseDate, 30, { sendFrom: 'personal' });

  assert.equal(internalDraft.scope, 'internal');
  assert.equal(workDraft.scope, 'work');
  assert.equal(personalDraft.scope, 'personal');

  const internalPayload = eventDraft.buildEventPayloadFromDraft(
    {
      ...internalDraft,
      title: 'Internal scope',
    },
    30
  );
  assert.equal(internalPayload.syncPolicy, 'internal_only');
  assert.equal(internalPayload.visibility, 'private');

  const workPayload = eventDraft.buildEventPayloadFromDraft(
    {
      ...workDraft,
      title: 'Work scope',
    },
    30
  );
  assert.equal(workPayload.syncPolicy, 'google_sync');
  assert.equal(workPayload.visibility, 'busy_only');

  const personalPayload = eventDraft.buildEventPayloadFromDraft(
    {
      ...personalDraft,
      title: 'Personal scope',
    },
    30
  );
  assert.equal(personalPayload.syncPolicy, 'microsoft_sync');
  assert.equal(personalPayload.visibility, 'busy_only');

  const hydratedWorkDraft = eventDraft.createDraftEventFromEvent({
    id: 'event_work',
    title: 'Hydrated work',
    description: '',
    location: '',
    people: [],
    type: 'meeting',
    startsAt: '2026-04-16T09:00:00.000Z',
    endsAt: '2026-04-16T10:00:00.000Z',
    color: '#4f9d69',
    tags: [],
    externalProviderLinks: [],
    syncPolicy: 'google_sync',
    visibility: 'busy_only',
  });
  assert.equal(hydratedWorkDraft.scope, 'work');

  const hydratedPersonalDraft = eventDraft.createDraftEventFromEvent({
    id: 'event_personal',
    title: 'Hydrated personal',
    description: '',
    location: '',
    people: [],
    type: 'personal',
    startsAt: '2026-04-16T09:00:00.000Z',
    endsAt: '2026-04-16T10:00:00.000Z',
    color: '#4d8cf5',
    tags: [],
    externalProviderLinks: [],
    syncPolicy: 'microsoft_sync',
    visibility: 'busy_only',
  });
  assert.equal(hydratedPersonalDraft.scope, 'personal');

  const hydratedPrivateWorkDraft = eventDraft.createDraftEventFromEvent({
    id: 'event_private_work',
    title: 'Private work',
    description: '',
    location: '',
    people: [],
    type: 'meeting',
    startsAt: '2026-04-16T09:00:00.000Z',
    endsAt: '2026-04-16T10:00:00.000Z',
    color: '#4f9d69',
    tags: [],
    externalProviderLinks: [],
    syncPolicy: 'google_sync',
    visibility: 'private',
  });
  assert.equal(hydratedPrivateWorkDraft.scope, 'internal');

  const hydratedPrivatePersonalDraft = eventDraft.createDraftEventFromEvent({
    id: 'event_private_personal',
    title: 'Private personal',
    description: '',
    location: '',
    people: [],
    type: 'personal',
    startsAt: '2026-04-16T09:00:00.000Z',
    endsAt: '2026-04-16T10:00:00.000Z',
    color: '#4d8cf5',
    tags: [],
    externalProviderLinks: [],
    syncPolicy: 'microsoft_sync',
    visibility: 'private',
  });
  assert.equal(hydratedPrivatePersonalDraft.scope, 'internal');
}

function testReminderHelpersAndValidation() {
  assert.equal(eventDraft.buildReminderMinutesFromParts('2', 'hours'), 120);
  assert.equal(eventDraft.buildReminderMinutesFromParts('1', 'days'), 1440);
  assert.equal(eventDraft.buildReminderMinutesFromParts('', 'minutes'), null);
  assert.deepEqual(eventDraft.getReminderTimingParts(120), {
    amount: '2',
    unit: 'hours',
  });
  assert.deepEqual(eventDraft.getReminderTimingParts(1440), {
    amount: '1',
    unit: 'days',
  });
  assert.deepEqual(eventDraft.getReminderTimingParts(90), {
    amount: '90',
    unit: 'minutes',
  });

  const draft = eventDraft.createEmptyDraftEvent(new Date('2026-04-16T09:00:00.000Z'), 30, {
    notifications: [
      createNotificationInput('draft_primary', {
        reminderMinutesBeforeStart: 120,
        desktopNotificationEnabled: true,
        emailNotificationEnabled: true,
        emailNotificationRecipients: [
          'Owner@example.com',
          'owner@example.com',
          'team@example.com',
        ],
      }),
      createNotificationInput('draft_follow_up', {
        reminderMinutesBeforeStart: 1440,
        desktopNotificationEnabled: true,
      }),
    ],
  });
  assert.equal(draft.reminderMinutesBeforeStart, 120);
  assert.equal(draft.desktopNotificationEnabled, true);
  assert.equal(draft.emailNotificationEnabled, true);
  assert.deepEqual(draft.emailNotificationRecipients, ['owner@example.com', 'team@example.com']);
  assert.equal(draft.notifications.length, 2);
  assert.equal(draft.notifications[1].reminderMinutesBeforeStart, 1440);

  const hydratedDraft = eventDraft.createDraftEventFromEvent({
    id: 'event-reminder',
    title: 'Reminder event',
    description: '',
    location: '',
    people: [],
    type: 'meeting',
    notifications: [
      createNotificationInput('hydrated_primary', {
        reminderMinutesBeforeStart: 60,
        desktopNotificationEnabled: true,
        emailNotificationEnabled: true,
        emailNotificationRecipients: ['notify@example.com'],
      }),
      createNotificationInput('hydrated_follow_up', {
        reminderMinutesBeforeStart: 5,
        desktopNotificationEnabled: true,
      }),
    ],
    startsAt: '2026-04-16T09:00:00.000Z',
    endsAt: '2026-04-16T10:00:00.000Z',
    color: '#4f9d69',
    tags: [],
    externalProviderLinks: [],
    syncPolicy: 'internal_only',
    visibility: 'private',
  });
  assert.equal(hydratedDraft.reminderMinutesBeforeStart, 60);
  assert.equal(hydratedDraft.desktopNotificationEnabled, true);
  assert.equal(hydratedDraft.emailNotificationEnabled, true);
  assert.deepEqual(hydratedDraft.emailNotificationRecipients, ['notify@example.com']);
  assert.equal(hydratedDraft.notifications.length, 2);
  assert.equal(hydratedDraft.notifications[1].reminderMinutesBeforeStart, 5);

  const payload = eventDraft.buildEventPayloadFromDraft(
    {
      ...hydratedDraft,
      title: 'Reminder payload',
    },
    60
  );
  assert.equal(payload.reminderMinutesBeforeStart, 60);
  assert.equal(payload.desktopNotificationEnabled, true);
  assert.equal(payload.emailNotificationEnabled, true);
  assert.deepEqual(payload.emailNotificationRecipients, ['notify@example.com']);
  assert.equal(payload.notifications.length, 2);
  assert.deepEqual(payload.notifications[1], {
    id: 'hydrated_follow_up',
    reminderMinutesBeforeStart: 5,
    desktopNotificationEnabled: true,
    emailNotificationEnabled: false,
    emailNotificationRecipients: [],
  });

  const sanitizedCreate = sanitizeEventCreateInput({
    title: 'Reminder create',
    type: 'meeting',
    notifications: [
      createNotificationInput('sanitized_primary', {
        reminderMinutesBeforeStart: 30,
        desktopNotificationEnabled: true,
        emailNotificationEnabled: true,
        emailNotificationRecipients: ['alerts@example.com', 'alerts@example.com'],
      }),
      createNotificationInput('sanitized_follow_up', {
        reminderMinutesBeforeStart: 5,
        desktopNotificationEnabled: true,
      }),
    ],
    startsAt: '2026-04-16T09:00:00.000Z',
    endsAt: '2026-04-16T10:00:00.000Z',
    color: '#4f9d69',
  });
  assert.equal(sanitizedCreate.reminderMinutesBeforeStart, 30);
  assert.equal(sanitizedCreate.desktopNotificationEnabled, true);
  assert.equal(sanitizedCreate.emailNotificationEnabled, true);
  assert.deepEqual(sanitizedCreate.emailNotificationRecipients, ['alerts@example.com']);
  assert.equal(sanitizedCreate.notifications.length, 2);
  assert.deepEqual(sanitizedCreate.notifications[1], {
    id: 'sanitized_follow_up',
    reminderMinutesBeforeStart: 5,
    desktopNotificationEnabled: true,
    emailNotificationEnabled: false,
    emailNotificationRecipients: [],
  });

  const sanitizedUpdate = sanitizeEventUpdateInput({
    notifications: [
      createNotificationInput('update_primary', {
        reminderMinutesBeforeStart: 15,
        desktopNotificationEnabled: false,
        emailNotificationEnabled: true,
        emailNotificationRecipients: ['ops@example.com'],
      }),
      createNotificationInput('update_follow_up', {
        reminderMinutesBeforeStart: 60,
        desktopNotificationEnabled: true,
      }),
    ],
  });
  assert.equal(sanitizedUpdate.reminderMinutesBeforeStart, 15);
  assert.equal(sanitizedUpdate.desktopNotificationEnabled, false);
  assert.equal(sanitizedUpdate.emailNotificationEnabled, true);
  assert.deepEqual(sanitizedUpdate.emailNotificationRecipients, ['ops@example.com']);
  assert.equal(sanitizedUpdate.notifications.length, 2);

  assert.throws(
    () =>
      sanitizeEventCreateInput({
        title: 'Bad reminder',
        type: 'meeting',
        notifications: [
          createNotificationInput('bad_reminder', {
            reminderMinutesBeforeStart: 0,
            desktopNotificationEnabled: true,
          }),
        ],
        startsAt: '2026-04-16T09:00:00.000Z',
        endsAt: '2026-04-16T10:00:00.000Z',
        color: '#4f9d69',
      }),
    /whole number of minutes/
  );

  assert.throws(
    () =>
      sanitizeEventCreateInput({
        title: 'Bad recipient',
        type: 'meeting',
        notifications: [
          createNotificationInput('bad_recipient', {
            reminderMinutesBeforeStart: 15,
            emailNotificationEnabled: true,
            emailNotificationRecipients: ['bad-recipient'],
          }),
        ],
        startsAt: '2026-04-16T09:00:00.000Z',
        endsAt: '2026-04-16T10:00:00.000Z',
        color: '#4f9d69',
      }),
    /valid email addresses/
  );

  assert.throws(
    () =>
      sanitizeEventCreateInput({
        title: 'Missing channel',
        type: 'meeting',
        notifications: [
          createNotificationInput('missing_channel', {
            reminderMinutesBeforeStart: 15,
            desktopNotificationEnabled: false,
            emailNotificationEnabled: false,
          }),
        ],
        startsAt: '2026-04-16T09:00:00.000Z',
        endsAt: '2026-04-16T10:00:00.000Z',
        color: '#4f9d69',
      }),
    /this machine, email, or both/
  );
}

function testEncryptedAtRest() {
  const fixture = createStoreFixture('calendar-store-test-');

  try {
    const title = 'ULTRA_SECRET_TITLE_439A';
    const description = 'ULTRA_SECRET_DESCRIPTION_93BD';
    fixture.store.createEvent({
      title,
      description,
      type: 'meeting',
      location: 'Focus room',
      people: ['Taylor', 'Jordan'],
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
            location: 'Legacy room',
            people: ['Legacy Person'],
            startsAt: '2026-04-16T09:00:00.000Z',
            endsAt: '2026-04-16T10:00:00.000Z',
            color: '#4f9d69',
            tags: [{ id: 'tag_legacy', label: 'Legacy', color: '#1d4ed8' }],
          },
          {
            id: 'focus_legacy',
            title: 'Legacy focus',
            description: 'legacy focus description',
            type: 'task',
            completed: false,
            repeat: 'none',
            hasDeadline: false,
            groupName: '',
            location: '',
            people: [],
            startsAt: '2026-04-17T09:00:00.000Z',
            endsAt: '2026-04-17T10:00:00.000Z',
            color: '#e3a13b',
            tags: [],
          },
          {
            id: 'personal_legacy',
            title: 'Legacy personal',
            description: 'legacy personal description',
            type: 'appointment',
            completed: false,
            repeat: 'none',
            hasDeadline: false,
            groupName: '',
            location: '',
            people: [],
            startsAt: '2026-04-18T09:00:00.000Z',
            endsAt: '2026-04-18T10:00:00.000Z',
            color: '#4d8cf5',
            tags: [],
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
    assert.equal(snapshot.events.length, 3);
    assert.equal(snapshot.events[0].title, legacyTitle);
    assert.equal(snapshot.events.find((event) => event.id === 'event_legacy')?.type, 'meeting');
    assert.equal(snapshot.events.find((event) => event.id === 'focus_legacy')?.type, 'focus');
    assert.equal(snapshot.events.find((event) => event.id === 'personal_legacy')?.type, 'personal');
    assert.equal(snapshot.events.find((event) => event.id === 'event_legacy')?.location, 'Legacy room');
    assert.deepEqual(snapshot.events.find((event) => event.id === 'event_legacy')?.people, ['Legacy Person']);
    assert.equal(snapshot.events.find((event) => event.id === 'event_legacy')?.reminderMinutesBeforeStart, null);
    assert.equal(snapshot.events.find((event) => event.id === 'event_legacy')?.desktopNotificationEnabled, false);
    assert.equal(snapshot.events.find((event) => event.id === 'event_legacy')?.emailNotificationEnabled, false);
    assert.deepEqual(snapshot.events.find((event) => event.id === 'event_legacy')?.emailNotificationRecipients, []);
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

function testEventRoundTripFields() {
  const fixture = createStoreFixture('calendar-store-roundtrip-');

  try {
    fixture.store.prepareHostedBootstrap();

    const typeInputs = [
      {
        title: 'Meeting round-trip',
        type: 'meeting',
        syncPolicy: 'internal_only',
        visibility: 'private',
        startsAt: '2026-04-16T09:00:00.000Z',
        endsAt: '2026-04-16T10:00:00.000Z',
      },
      {
        title: 'Focus round-trip',
        type: 'focus',
        syncPolicy: 'google_sync',
        visibility: 'busy_only',
        startsAt: '2026-04-16T10:30:00.000Z',
        endsAt: '2026-04-16T11:30:00.000Z',
      },
      {
        title: 'Personal round-trip',
        type: 'personal',
        syncPolicy: 'microsoft_sync',
        visibility: 'busy_only',
        startsAt: '2026-04-16T12:00:00.000Z',
        endsAt: '2026-04-16T13:00:00.000Z',
      },
    ];

    for (const [index, input] of typeInputs.entries()) {
      fixture.store.createEvent({
        ...input,
        description: `Round-trip description ${index}`,
        location: `Room ${index + 1}`,
        people: [`Person ${index + 1}`, `Guest ${index + 1}`],
        notifications:
          index === 0
            ? [createNotificationInput('meeting_internal', { reminderMinutesBeforeStart: 30 })]
            : index === 1
              ? [
                  createNotificationInput('focus_primary', {
                    reminderMinutesBeforeStart: 15,
                    desktopNotificationEnabled: true,
                  }),
                  createNotificationInput('focus_follow_up', {
                    reminderMinutesBeforeStart: 5,
                    desktopNotificationEnabled: true,
                  }),
                ]
              : [
                  createNotificationInput('personal_primary', {
                    reminderMinutesBeforeStart: 60,
                    desktopNotificationEnabled: true,
                    emailNotificationEnabled: true,
                    emailNotificationRecipients: ['person3@example.com'],
                  }),
                ],
        color: ['#4f9d69', '#e3a13b', '#4d8cf5'][index],
        tags: [{ label: `Tag ${index + 1}`, color: '#1d4ed8' }],
      });
    }

    let snapshot = fixture.store.snapshot();
    assert.equal(snapshot.events.length, 3);
    assert.equal(snapshot.events.find((event) => event.type === 'meeting')?.syncPolicy, 'internal_only');
    assert.equal(snapshot.events.find((event) => event.type === 'focus')?.visibility, 'busy_only');
    assert.deepEqual(snapshot.events.find((event) => event.type === 'personal')?.people, ['Person 3', 'Guest 3']);
    assert.equal(snapshot.events.find((event) => event.type === 'focus')?.desktopNotificationEnabled, true);
    assert.equal(snapshot.events.find((event) => event.type === 'personal')?.emailNotificationEnabled, true);
    assert.deepEqual(snapshot.events.find((event) => event.type === 'personal')?.emailNotificationRecipients, ['person3@example.com']);
    assert.equal(snapshot.events.find((event) => event.type === 'focus')?.notifications.length, 2);

    const focusEvent = snapshot.events.find((event) => event.type === 'focus');
    const updatedSnapshot = fixture.store.updateEvent({
      id: focusEvent.id,
      title: 'Focus updated',
      location: 'Library booth',
      people: ['Alex', 'Sam'],
      notifications: [
        createNotificationInput('focus_updated_primary', {
          reminderMinutesBeforeStart: 30,
          desktopNotificationEnabled: true,
          emailNotificationEnabled: true,
          emailNotificationRecipients: ['alex@example.com', 'sam@example.com'],
        }),
        createNotificationInput('focus_updated_follow_up', {
          reminderMinutesBeforeStart: 5,
          desktopNotificationEnabled: true,
        }),
      ],
      syncPolicy: 'microsoft_sync',
      visibility: 'private',
      startsAt: '2026-04-16T11:00:00.000Z',
      endsAt: '2026-04-16T12:30:00.000Z',
    });

    snapshot = updatedSnapshot;
    const updatedFocus = snapshot.events.find((event) => event.id === focusEvent.id);
    assert.equal(updatedFocus.title, 'Focus updated');
    assert.equal(updatedFocus.location, 'Library booth');
    assert.deepEqual(updatedFocus.people, ['Alex', 'Sam']);
    assert.equal(updatedFocus.desktopNotificationEnabled, true);
    assert.equal(updatedFocus.emailNotificationEnabled, true);
    assert.deepEqual(updatedFocus.emailNotificationRecipients, ['alex@example.com', 'sam@example.com']);
    assert.equal(updatedFocus.notifications.length, 2);
    assert.equal(updatedFocus.notifications[1].reminderMinutesBeforeStart, 5);
    assert.equal(updatedFocus.syncPolicy, 'microsoft_sync');
    assert.equal(updatedFocus.visibility, 'private');
  } finally {
    fixture.cleanup();
  }
}

function testReminderRoundTrip() {
  const fixture = createStoreFixture('calendar-store-reminders-');

  try {
    fixture.store.prepareHostedBootstrap();

    const reminderValues = [null, 5, 15, 30, 60, 120, 1440, 2880];
    for (const value of reminderValues) {
      fixture.store.createEvent({
        title: `Reminder ${value === null ? 'none' : value}`,
        type: 'meeting',
        notifications:
          value === null
            ? []
            : [
                createNotificationInput(`reminder_${value}`, {
                  reminderMinutesBeforeStart: value,
                  desktopNotificationEnabled: true,
                  emailNotificationEnabled: value === 30,
                  emailNotificationRecipients: value === 30 ? ['notify@example.com'] : [],
                }),
              ],
        startsAt: `2026-04-${String(16 + reminderValues.indexOf(value)).padStart(2, '0')}T09:00:00.000Z`,
        endsAt: `2026-04-${String(16 + reminderValues.indexOf(value)).padStart(2, '0')}T10:00:00.000Z`,
        color: '#4f9d69',
      });
    }

    let snapshot = fixture.store.snapshot();
    assert.equal(snapshot.events.length, reminderValues.length);
    for (const value of reminderValues) {
      const title = `Reminder ${value === null ? 'none' : value}`;
      assert.equal(
        snapshot.events.find((event) => event.title === title)?.reminderMinutesBeforeStart,
        value
      );
    }

    assert.equal(snapshot.events.find((event) => event.title === 'Reminder 30')?.emailNotificationEnabled, true);
    assert.deepEqual(
      snapshot.events.find((event) => event.title === 'Reminder 30')?.emailNotificationRecipients,
      ['notify@example.com']
    );
    assert.equal(snapshot.events.find((event) => event.title === 'Reminder 30')?.notifications.length, 1);
    assert.equal(snapshot.events.find((event) => event.title === 'Reminder 120')?.reminderMinutesBeforeStart, 120);
    assert.equal(snapshot.events.find((event) => event.title === 'Reminder 2880')?.reminderMinutesBeforeStart, 2880);

    const target = snapshot.events.find((event) => event.title === 'Reminder none');
    snapshot = fixture.store.updateEvent({
      id: target.id,
      notifications: [
        createNotificationInput('later_primary', {
          reminderMinutesBeforeStart: 30,
          desktopNotificationEnabled: true,
          emailNotificationEnabled: true,
          emailNotificationRecipients: ['later@example.com'],
        }),
        createNotificationInput('later_follow_up', {
          reminderMinutesBeforeStart: 5,
          desktopNotificationEnabled: true,
        }),
      ],
    });
    assert.equal(
      snapshot.events.find((event) => event.id === target.id)?.reminderMinutesBeforeStart,
      30
    );
    assert.equal(snapshot.events.find((event) => event.id === target.id)?.desktopNotificationEnabled, true);
    assert.equal(snapshot.events.find((event) => event.id === target.id)?.emailNotificationEnabled, true);
    assert.deepEqual(
      snapshot.events.find((event) => event.id === target.id)?.emailNotificationRecipients,
      ['later@example.com']
    );
    assert.equal(snapshot.events.find((event) => event.id === target.id)?.notifications.length, 2);
  } finally {
    fixture.cleanup();
  }
}

function testKeyRotation() {
  const fixture = createStoreFixture('calendar-store-rotate-');

  try {
    fixture.store.createEvent({
      title: 'Rotating secret',
      description: 'This event should survive key rotation.',
      type: 'meeting',
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
      type: 'meeting',
      location: 'Hosted room',
      people: ['Casey', 'Morgan'],
      notifications: [
        createNotificationInput('hosted_primary', {
          reminderMinutesBeforeStart: 15,
          desktopNotificationEnabled: true,
        }),
        createNotificationInput('hosted_follow_up', {
          reminderMinutesBeforeStart: 30,
          emailNotificationEnabled: true,
          emailNotificationRecipients: ['casey@example.com'],
        }),
      ],
      syncPolicy: 'google_sync',
      visibility: 'busy_only',
      startsAt: '2026-04-16T13:00:00.000Z',
      endsAt: '2026-04-16T14:00:00.000Z',
      color: '#4f9d69',
      tags: [{ label: 'Hosted', color: '#1d4ed8' }],
    });

    const envelopes = sourceFixture.store.listHostedSyncEnvelopesSince(0);
    assert.equal(envelopes.length, 1);
    assert.equal(envelopes[0].contentPatch.title, 'Hosted sync secret');
    assert.equal(envelopes[0].contentPatch.location, 'Hosted room');
    assert.deepEqual(envelopes[0].contentPatch.people, ['Casey', 'Morgan']);
    assert.equal(envelopes[0].contentPatch.desktopNotificationEnabled, true);
    assert.equal(envelopes[0].contentPatch.emailNotificationEnabled, false);
    assert.deepEqual(envelopes[0].contentPatch.emailNotificationRecipients, []);
    assert.equal(envelopes[0].contentPatch.notifications.length, 2);
    assert.equal(envelopes[0].contentPatch.notifications[1].emailNotificationEnabled, true);
    assert.deepEqual(envelopes[0].contentPatch.notifications[1].emailNotificationRecipients, ['casey@example.com']);

    targetFixture.store.applyHostedEnvelope(envelopes[0]);

    const targetSnapshot = targetFixture.store.snapshot();
    assert.equal(targetSnapshot.events.length, 1);
    assert.equal(targetSnapshot.events[0].title, 'Hosted sync secret');
    assert.equal(targetSnapshot.events[0].description, 'This should arrive through a hosted sync envelope.');
    assert.equal(targetSnapshot.events[0].type, 'meeting');
    assert.equal(targetSnapshot.events[0].location, 'Hosted room');
    assert.deepEqual(targetSnapshot.events[0].people, ['Casey', 'Morgan']);
    assert.equal(targetSnapshot.events[0].reminderMinutesBeforeStart, 15);
    assert.equal(targetSnapshot.events[0].desktopNotificationEnabled, true);
    assert.equal(targetSnapshot.events[0].emailNotificationEnabled, false);
    assert.deepEqual(targetSnapshot.events[0].emailNotificationRecipients, []);
    assert.equal(targetSnapshot.events[0].notifications.length, 2);
    assert.equal(targetSnapshot.events[0].notifications[1].emailNotificationEnabled, true);
    assert.deepEqual(targetSnapshot.events[0].notifications[1].emailNotificationRecipients, ['casey@example.com']);
    assert.equal(targetSnapshot.events[0].syncPolicy, 'google_sync');
    assert.equal(targetSnapshot.events[0].visibility, 'busy_only');
  } finally {
    sourceFixture.cleanup();
    targetFixture.cleanup();
  }
}

async function testReminderServiceDispatch() {
  const fixture = createStoreFixture('calendar-store-reminder-service-');

  try {
    fixture.store.prepareHostedBootstrap();
    fixture.store.createEvent({
      title: 'Reminder service event',
      type: 'meeting',
      notifications: [
        createNotificationInput('service_primary', {
          reminderMinutesBeforeStart: 5,
          desktopNotificationEnabled: true,
          emailNotificationEnabled: true,
          emailNotificationRecipients: ['notify@example.com'],
        }),
        createNotificationInput('service_follow_up', {
          reminderMinutesBeforeStart: 5,
          desktopNotificationEnabled: true,
          emailNotificationEnabled: true,
          emailNotificationRecipients: ['notify@example.com'],
        }),
      ],
      syncPolicy: 'google_sync',
      visibility: 'busy_only',
      startsAt: '2026-04-16T09:10:00.000Z',
      endsAt: '2026-04-16T10:00:00.000Z',
      color: '#4f9d69',
    });

    const shownNotifications = [];
    class MockNotification {
      constructor(payload) {
        this.payload = payload;
      }

      static isSupported() {
        return true;
      }

      show() {
        shownNotifications.push(this.payload);
      }
    }

    const sentEmails = [];
    const reminderService = new ReminderService({
      store: fixture.store,
      oauthService: {
        async sendReminderEmail(input) {
          sentEmails.push(input);
        },
      },
      NotificationClass: MockNotification,
      now: () => new Date('2026-04-16T09:06:00.000Z'),
      setIntervalImpl(callback) {
        return callback;
      },
      clearIntervalImpl() {},
    });

    assert.equal(resolveReminderScope('google_sync', 'busy_only'), 'work');
    assert.equal(resolveReminderScope('microsoft_sync', 'busy_only'), 'personal');
    assert.equal(resolveReminderScope('google_sync', 'private'), 'internal');

    await reminderService.pollDueReminders();
    await reminderService.pollDueReminders();

    assert.equal(shownNotifications.length, 2);
    assert.equal(shownNotifications[0].title, 'Reminder service event');
    assert.equal(sentEmails.length, 2);
    assert.equal(sentEmails[0].scope, 'work');
    assert.deepEqual(sentEmails[0].recipients, ['notify@example.com']);

    const reminderEntries = fixture.store.listDueReminderEntries({
      now: new Date('2026-04-16T09:06:00.000Z'),
      gracePeriodMinutes: 5,
    });
    assert.equal(reminderEntries.length, 2);

    for (const reminderEntry of reminderEntries) {
      assert.equal(
        fixture.store.hasReminderDispatch({
          eventId: reminderEntry.id,
          channel: `desktop:${reminderEntry.notificationId}`,
          recipient: '',
          reminderAt: reminderEntry.reminderAt,
        }),
        true
      );
      assert.equal(
        fixture.store.hasReminderDispatch({
          eventId: reminderEntry.id,
          channel: `email:${reminderEntry.notificationId}`,
          recipient: 'notify@example.com',
          reminderAt: reminderEntry.reminderAt,
        }),
        true
      );
    }
  } finally {
    fixture.cleanup();
  }
}

async function main() {
  const checks = [
    ['click_intent_helpers', testClickIntentHelpers],
    ['composer_routing_helpers', testComposerRoutingHelpers],
    ['event_scope_helpers', testEventScopeHelpers],
    ['reminder_helpers_and_validation', testReminderHelpersAndValidation],
    ['encrypted_at_rest', testEncryptedAtRest],
    ['legacy_migration', testLegacyMigration],
    ['event_roundtrip_fields', testEventRoundTripFields],
    ['reminder_roundtrip', testReminderRoundTrip],
    ['master_key_rotation', testKeyRotation],
    ['hosted_bootstrap_clears_demo_seed', testHostedBootstrapClearsDemoSeed],
    ['hosted_envelope_projection', testHostedEnvelopeProjection],
    ['reminder_service_dispatch', testReminderServiceDispatch],
  ];

  for (const [name, check] of checks) {
    await check();
    console.log(`PASS ${name}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
