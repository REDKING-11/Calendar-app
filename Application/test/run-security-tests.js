const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { transformFileSync } = require('@babel/core');

const { CalendarStore } = require('../src/data/calendar-store');
const { ReminderService, resolveReminderScope } = require('../src/reminder-service');
const {
  EVENT_TITLE_MAX_LENGTH,
  isValidEmailAddress,
  sanitizeEventCreateInput,
  sanitizeEventUpdateInput,
} = require('../src/security/validation');
const {
  ERROR_CODES,
  createAppError,
  formatCodedMessage,
  normalizeAppError,
  parseCodedErrorMessage,
} = require('../src/shared/app-errors');
const { wrapIpcHandler } = require('../src/ipc/calendar-ipc');

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
const keyboardNavigation = loadTranspiledModule(
  path.join(__dirname, '..', 'src', 'renderer', 'keyboardNavigation.js')
);
const preferencesModule = loadTranspiledModule(
  path.join(__dirname, '..', 'src', 'renderer', 'preferences.js')
);
const debugTools = loadTranspiledModule(
  path.join(__dirname, '..', 'src', 'renderer', 'debug-tools.js')
);
const calendarInterchange = require('../src/data/calendar-interchange');

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

function createStoreFixture(prefix, options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const store = new CalendarStore(tempDir, {
    safeStorage: createMockSafeStorage(),
    shell: { openExternal() {} },
    ...options,
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

function createMockLocalStorage(initialValues = {}) {
  const values = new Map(Object.entries(initialValues));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

async function testAppErrorHelpersAndIpcWrapper() {
  assert.equal(formatCodedMessage(ERROR_CODES.calendarCreate, 'Failed to insert event.'), '[CAL-553] Failed to insert event.');
  assert.deepEqual(parseCodedErrorMessage('[VAL-422] Event title is required.'), {
    code: 'VAL-422',
    message: 'Event title is required.',
    formattedMessage: '[VAL-422] Event title is required.',
  });

  const explicitError = createAppError({
    code: ERROR_CODES.hosted,
    message: 'Hosted sync failed.',
  });
  assert.equal(normalizeAppError(explicitError, ERROR_CODES.unexpected), explicitError);

  const validationError = normalizeAppError(new Error('Event title is required.'), ERROR_CODES.calendarCreate);
  assert.equal(validationError.code, ERROR_CODES.validation);
  assert.equal(validationError.message, '[VAL-422] Event title is required.');

  const createFailure = await wrapIpcHandler('calendar:createEvent', () => {
    throw new Error('SQLite insert failed.');
  })().catch((error) => error);
  assert.equal(createFailure.code, ERROR_CODES.calendarCreate);
  assert.equal(createFailure.message, '[CAL-553] SQLite insert failed.');

  const updateFailure = await wrapIpcHandler('calendar:updateEvent', () => {
    throw new Error('database is locked');
  })().catch((error) => error);
  assert.equal(updateFailure.code, ERROR_CODES.calendarUpdate);

  const deleteFailure = await wrapIpcHandler('calendar:deleteEvent', () => {
    throw new Error('database is locked');
  })().catch((error) => error);
  assert.equal(deleteFailure.code, ERROR_CODES.calendarDelete);
}

function testDeveloperModePreferenceAndDebugRedaction() {
  const previousWindow = global.window;
  global.window = {
    localStorage: createMockLocalStorage(),
    matchMedia: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
  };

  try {
    const preferences = preferencesModule.getStoredPreferences();
    assert.equal(preferences.developerMode, false);
    preferencesModule.persistPreferences({
      ...preferences,
      developerMode: true,
    });
    assert.equal(global.window.localStorage.getItem(preferencesModule.STORAGE_KEYS.developerMode), 'true');
  } finally {
    global.window = previousWindow;
  }

  const debugSnapshot = debugTools.buildDebugSnapshot({
    windowMode: 'main',
    isSetupComplete: true,
    preferences: {
      developerMode: true,
      themeMode: 'dark',
      backgroundMotion: false,
    },
    effectiveTheme: 'dark',
    calendarView: 'month',
    selectedDate: new Date('2026-04-22T12:00:00.000Z'),
    snapshot: {
      events: [{ id: 'event-1', title: 'Visible title', password: 'bad' }],
      tags: [{ label: 'Work' }],
      externalCalendarSources: [],
      externalEventLinks: [],
      stats: { activeEventCount: 1, changeCount: 2 },
      security: {
        hosted: {
          connectionStatus: 'connected',
          refreshToken: 'secret-token',
        },
      },
    },
    visibleEvents: [{ id: 'event-1' }],
    availableTags: [{ label: 'Work' }],
    connectedAccounts: [{ email: 'person@example.com', accessToken: 'secret-token' }],
    hostedBusyAction: '',
    holidayPreloadState: { status: 'idle' },
    oauthBusyProvider: '',
    oauthPollingActive: false,
    externalCalendarsByAccount: {
      account_1: {
        status: 'ready',
        items: [{ id: 'calendar-1', privateKey: 'secret-key' }],
      },
    },
    composerState: { variant: null },
    isUpcomingOpen: false,
    isAboutOpen: false,
    lastAppError: { code: 'APP-500', message: 'Test error' },
  });
  const serialized = JSON.stringify(debugSnapshot);
  assert.equal(serialized.includes('secret-token'), false);
  assert.equal(serialized.includes('secret-key'), false);
  assert.equal(debugSnapshot.app.developerMode, true);
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

function createMockFocusableElement({
  tagName = 'BUTTON',
  disabled = false,
  hidden = false,
  attributes = {},
} = {}) {
  return {
    tagName,
    disabled,
    hidden,
    tabIndex: attributes.tabindex === undefined ? 0 : Number(attributes.tabindex),
    focused: false,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
    },
    matches(selector) {
      if (selector === 'a[href]') {
        return tagName === 'A' && Boolean(attributes.href);
      }
      if (selector === '[tabindex]') {
        return Object.prototype.hasOwnProperty.call(attributes, 'tabindex');
      }
      return false;
    },
    focus() {
      this.focused = true;
    },
  };
}

function testKeyboardNavigationHelpers() {
  assert.equal(keyboardNavigation.isEditableTarget({ tagName: 'INPUT' }), true);
  assert.equal(keyboardNavigation.isEditableTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(keyboardNavigation.isEditableTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(keyboardNavigation.isEditableTarget({ tagName: 'BUTTON' }), false);
  assert.equal(
    keyboardNavigation.isEditableTarget({
      tagName: 'SPAN',
      closest(selector) {
        return selector.includes('input') ? { tagName: 'INPUT' } : null;
      },
    }),
    true
  );

  assert.equal(
    keyboardNavigation.getRegionShortcutTarget({
      ctrlKey: true,
      key: '1',
      target: { tagName: 'BODY' },
    }),
    'sidebar'
  );
  assert.equal(
    keyboardNavigation.getRegionShortcutTarget({
      ctrlKey: true,
      key: '2',
      target: { tagName: 'BODY' },
    }),
    'header'
  );
  assert.equal(
    keyboardNavigation.getRegionShortcutTarget({
      ctrlKey: true,
      key: '3',
      target: { tagName: 'BODY' },
    }),
    'view'
  );
  assert.equal(
    keyboardNavigation.getRegionShortcutTarget({
      ctrlKey: true,
      key: '1',
      target: { tagName: 'INPUT' },
    }),
    null
  );
  assert.equal(
    keyboardNavigation.getRegionShortcutTarget({
      ctrlKey: true,
      shiftKey: true,
      key: '1',
      target: { tagName: 'BODY' },
    }),
    null
  );

  const disabledButton = createMockFocusableElement({ disabled: true });
  const hiddenButton = createMockFocusableElement({ hidden: true });
  const visibleButton = createMockFocusableElement();
  const container = {
    querySelectorAll() {
      return [disabledButton, hiddenButton, visibleButton];
    },
  };

  assert.deepEqual(keyboardNavigation.getFocusableElements(container), [visibleButton]);
  assert.equal(keyboardNavigation.focusFirstAvailable(container), visibleButton);
  assert.equal(visibleButton.focused, true);

  assert.equal(
    keyboardNavigation.getGridNavigationIndex({
      currentIndex: 8,
      itemCount: 35,
      columnCount: 7,
      key: 'ArrowLeft',
    }),
    7
  );
  assert.equal(
    keyboardNavigation.getGridNavigationIndex({
      currentIndex: 8,
      itemCount: 35,
      columnCount: 7,
      key: 'ArrowDown',
    }),
    15
  );
  assert.equal(
    keyboardNavigation.getGridNavigationIndex({
      currentIndex: 8,
      itemCount: 35,
      columnCount: 7,
      key: 'Home',
    }),
    7
  );
  assert.equal(
    keyboardNavigation.getGridNavigationIndex({
      currentIndex: 8,
      itemCount: 35,
      columnCount: 7,
      key: 'End',
    }),
    13
  );
  assert.equal(
    keyboardNavigation.getGridNavigationIndex({
      currentIndex: 0,
      itemCount: 35,
      columnCount: 7,
      key: 'ArrowUp',
    }),
    0
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
    repeat: 'yearly',
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
  assert.equal(sanitizedCreate.repeat, 'yearly');
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
    repeat: 'yearly',
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
  assert.equal(sanitizedUpdate.repeat, 'yearly');
  assert.equal(sanitizedUpdate.reminderMinutesBeforeStart, 15);
  assert.equal(sanitizedUpdate.desktopNotificationEnabled, false);
  assert.equal(sanitizedUpdate.emailNotificationEnabled, true);
  assert.deepEqual(sanitizedUpdate.emailNotificationRecipients, ['ops@example.com']);
  assert.equal(sanitizedUpdate.notifications.length, 2);

  const cappedPayload = eventDraft.buildEventPayloadFromDraft(
    {
      ...hydratedDraft,
      title: '12345678901234567890 extra',
      description: '<script>alert(1)</script>\nKeep this',
      location: '<img src=x>',
      groupName: '<group>',
    },
    60
  );
  assert.equal(cappedPayload.title, '12345678901234567890');
  assert.equal(cappedPayload.title.length, eventDraft.EVENT_TITLE_MAX_LENGTH);
  assert.equal(cappedPayload.description.includes('<script>'), false);
  assert.equal(cappedPayload.location.includes('<'), false);
  assert.equal(cappedPayload.groupName.includes('>'), false);

  assert.equal(isValidEmailAddress('person@example.com'), true);
  assert.equal(isValidEmailAddress('person.name+tag@example.co.uk'), true);
  assert.equal(isValidEmailAddress('t@t'), false);

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
            emailNotificationRecipients: ['t@t'],
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
    const title = 'ULTRA_SECRET_439A';
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

    const cappedCreateSnapshot = fixture.store.createEvent({
      title: '12345678901234567890 extra title text',
      type: 'meeting',
      startsAt: '2026-04-15T09:00:00.000Z',
      endsAt: '2026-04-15T10:00:00.000Z',
      color: '#4f9d69',
    });
    const cappedCreatedEvent = cappedCreateSnapshot.events.find(
      (event) => event.startsAt === '2026-04-15T09:00:00.000Z'
    );
    assert.equal(cappedCreatedEvent.title, '12345678901234567890');
    assert.equal(cappedCreatedEvent.title.length, EVENT_TITLE_MAX_LENGTH);

    const cappedUpdateSnapshot = fixture.store.updateEvent({
      id: cappedCreatedEvent.id,
      title: 'abcdefghijklmnopqrst too long',
    });
    assert.equal(
      cappedUpdateSnapshot.events.find((event) => event.id === cappedCreatedEvent.id).title,
      'abcdefghijklmnopqrst'
    );

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
    assert.equal(snapshot.events.length, 4);
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

function testNewStoreStartsWithoutDemoSeed() {
  const fixture = createStoreFixture('calendar-store-no-demo-seed-');

  try {
    const snapshot = fixture.store.snapshot();
    assert.equal(snapshot.events.length, 0);
    assert.equal(snapshot.changes, undefined);
    assert.equal(snapshot.stats.changeCount, 0);
    assert.equal(fixture.store.snapshot({ includeChanges: true }).changes.length, 0);
    assert.equal(fixture.store.getDemoSeedState(), 'disabled');
  } finally {
    fixture.cleanup();
  }
}

function testLegacyDemoSeedCleanup() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-store-demo-cleanup-'));
  let store = new CalendarStore(tempDir, {
    safeStorage: createMockSafeStorage(),
    shell: { openExternal() {} },
  });

  try {
    for (const title of [
      'Local-first architecture review',
      'Phone sync UX sketch',
      'Pairing flow test',
    ]) {
      store.createEvent({
        title,
        description: 'Old generated demo event',
        type: 'meeting',
        startsAt: '2026-04-16T09:00:00.000Z',
        endsAt: '2026-04-16T10:00:00.000Z',
        color: '#4f9d69',
        tags: [],
      });
    }

    store.createEvent({
      title: 'Real user event',
      description: 'Must stay in the calendar.',
      type: 'personal',
      startsAt: '2026-04-17T09:00:00.000Z',
      endsAt: '2026-04-17T10:00:00.000Z',
      color: '#4d8cf5',
      tags: [],
    });
    store.setMeta('demoSeedState', 'seeded');
    store.close();
    store = null;

    store = new CalendarStore(tempDir, {
      safeStorage: createMockSafeStorage(),
      shell: { openExternal() {} },
    });

    const snapshot = store.snapshot();
    assert.equal(snapshot.events.some((event) => event.title === 'Local-first architecture review'), false);
    assert.equal(snapshot.events.some((event) => event.title === 'Phone sync UX sketch'), false);
    assert.equal(snapshot.events.some((event) => event.title === 'Pairing flow test'), false);
    assert.equal(snapshot.events.some((event) => event.title === 'Real user event'), true);
    assert.equal(store.getDemoSeedState(), 'disabled');
  } finally {
    store?.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
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
      sourceTimeZone: 'Europe/Helsinki',
      color: '#4f9d69',
      tags: [{ label: 'Hosted', color: '#1d4ed8' }],
    });

    const envelopes = sourceFixture.store.listHostedSyncEnvelopesSince(0);
    assert.equal(envelopes.length, 1);
    assert.equal(envelopes[0].contentPatch.title, 'Hosted sync secret');
    assert.equal(envelopes[0].contentPatch.sourceTimeZone, 'Europe/Helsinki');
    assert.equal(envelopes[0].contentPatch.location, 'Hosted room');
    assert.deepEqual(envelopes[0].contentPatch.people, ['Casey', 'Morgan']);
    assert.equal(typeof envelopes[0].encryptedContent, 'string');
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
    assert.equal(targetSnapshot.events[0].sourceTimeZone, 'Europe/Helsinki');
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
      title: 'Reminder service',
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
    assert.equal(shownNotifications[0].title, 'Reminder service');
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

async function testOutboundProviderInviteFlow() {
  const fixture = createStoreFixture('calendar-store-outbound-invites-');
  const calls = [];

  try {
    const account = {
      accountId: 'acct_google_work',
      provider: 'google',
      email: 'work@example.com',
      displayName: 'Work',
      status: 'connected',
      canWrite: true,
      writeScopeGranted: true,
      mailScopeGranted: true,
      emailSendCapable: true,
    };
    const microsoftAccount = {
      accountId: 'acct_microsoft_personal',
      provider: 'microsoft',
      email: 'personal@example.com',
      displayName: 'Personal',
      status: 'connected',
      canWrite: true,
      writeScopeGranted: true,
      mailScopeGranted: true,
      emailSendCapable: true,
    };
    const calendar = {
      accountId: account.accountId,
      provider: 'google',
      remoteCalendarId: 'primary',
      displayName: 'Primary',
      selected: true,
      accessRole: 'owner',
    };
    const microsoftCalendar = {
      accountId: microsoftAccount.accountId,
      provider: 'microsoft',
      remoteCalendarId: 'calendar-personal',
      displayName: 'Personal Calendar',
      selected: true,
      accessRole: 'writer',
    };

    fixture.store.oauthService.listConnectedAccounts = () => [account, microsoftAccount];
    fixture.store.oauthService.listExternalCalendars = async (accountId) => {
      if (accountId === microsoftAccount.accountId) {
        return [microsoftCalendar];
      }
      assert.equal(accountId, account.accountId);
      return [calendar];
    };
    fixture.store.oauthService.createOutboundCalendarEvent = async (input) => {
      calls.push({ kind: 'create', input });
      if (input.accountId === microsoftAccount.accountId) {
        assert.deepEqual(input.attendees, ['casey@example.com']);
        assert.equal(input.remoteCalendarId, microsoftCalendar.remoteCalendarId);
        return {
          accountId: microsoftAccount.accountId,
          provider: 'microsoft',
          remoteCalendarId: microsoftCalendar.remoteCalendarId,
          remoteEventId: 'microsoft_event_1',
          remoteVersion: 'm1',
          url: 'https://outlook.office.com/calendar/item/1',
        };
      }
      assert.deepEqual(input.attendees, ['alex@example.com']);
      assert.equal(input.accountId, account.accountId);
      assert.equal(input.remoteCalendarId, calendar.remoteCalendarId);
      return {
        accountId: account.accountId,
        provider: 'google',
        remoteCalendarId: calendar.remoteCalendarId,
        remoteEventId: 'google_event_1',
        remoteVersion: 'v1',
        url: 'https://calendar.google.com/event?eid=1',
      };
    };
    fixture.store.oauthService.updateOutboundCalendarEvent = async (input) => {
      calls.push({ kind: 'update', input });
      assert.equal(input.remoteEventId, 'google_event_1');
      assert.deepEqual(input.attendees, ['alex@example.com']);
      return {
        accountId: account.accountId,
        provider: 'google',
        remoteCalendarId: calendar.remoteCalendarId,
        remoteEventId: 'google_event_1',
        remoteVersion: 'v2',
        url: 'https://calendar.google.com/event?eid=1',
      };
    };
    fixture.store.oauthService.deleteOutboundCalendarEvent = async (input) => {
      calls.push({ kind: 'delete', input });
      assert.equal(input.remoteEventId, 'google_event_1');
      return { provider: 'google', remoteEventId: 'google_event_1' };
    };

    const createdSnapshot = await fixture.store.createEvent({
      title: 'Provider invite',
      description: 'Send through Google Calendar',
      type: 'meeting',
      completed: false,
      repeat: 'none',
      hasDeadline: false,
      groupName: '',
      location: 'Room A',
      people: ['Alex'],
      inviteRecipients: ['alex@example.com'],
      startsAt: '2026-04-22T09:00:00.000Z',
      endsAt: '2026-04-22T10:00:00.000Z',
      color: '#4f9d69',
      syncPolicy: 'google_sync',
      visibility: 'busy_only',
      inviteTargetAccountId: account.accountId,
      inviteTargetProvider: 'google',
      inviteTargetCalendarId: calendar.remoteCalendarId,
      inviteDeliveryMode: 'provider_invite',
    });

    assert.equal(calls[0].kind, 'create');
    const createdEvent = createdSnapshot.events.find((event) => event.title === 'Provider invite');
    assert.equal(createdEvent.inviteDeliveryMode, 'provider_invite');
    assert.equal(createdEvent.inviteTargetAccountId, account.accountId);
    assert.equal(createdEvent.externalProviderLinks[0].mode, 'outbound');
    assert.equal(createdEvent.externalProviderLinks[0].externalEventId, 'google_event_1');

    const createdLinks = fixture.store.listExternalEventLinks({
      eventId: createdEvent.id,
      linkMode: 'outbound',
      syncStatus: 'active',
    });
    assert.equal(createdLinks.length, 1);
    assert.equal(createdLinks[0].remoteEventId, 'google_event_1');
    assert.equal(createdLinks[0].linkMode, 'outbound');

    const updatedSnapshot = await fixture.store.updateEvent({
      id: createdEvent.id,
      title: 'Provider invite updated',
      inviteDeliveryMode: 'provider_invite',
      inviteTargetAccountId: account.accountId,
      inviteTargetProvider: 'google',
      inviteTargetCalendarId: calendar.remoteCalendarId,
    });
    assert.equal(calls.some((call) => call.kind === 'update'), true);
    const updatedEvent = updatedSnapshot.events.find((event) => event.id === createdEvent.id);
    assert.equal(updatedEvent.title, 'Provider invite upda');
    assert.equal(updatedEvent.externalProviderLinks[0].externalEventId, 'google_event_1');

    await fixture.store.deleteEvent(createdEvent.id);
    assert.equal(calls.some((call) => call.kind === 'delete'), true);
    const removedLinks = fixture.store.listExternalEventLinks({
      eventId: createdEvent.id,
      linkMode: 'outbound',
    });
    assert.equal(removedLinks[0].syncStatus, 'removed');

    const personalSnapshot = await fixture.store.createEvent({
      title: 'Personal invite',
      type: 'meeting',
      completed: false,
      repeat: 'none',
      hasDeadline: false,
      people: ['Casey Example'],
      inviteRecipients: ['casey@example.com'],
      startsAt: '2026-04-23T09:00:00.000Z',
      endsAt: '2026-04-23T10:00:00.000Z',
      color: '#4d8cf5',
      syncPolicy: 'microsoft_sync',
      visibility: 'busy_only',
      inviteTargetAccountId: microsoftAccount.accountId,
      inviteTargetProvider: 'microsoft',
      inviteTargetCalendarId: microsoftCalendar.remoteCalendarId,
      inviteDeliveryMode: 'provider_invite',
    });
    assert.equal(calls.some((call) => call.input.accountId === microsoftAccount.accountId), true);
    const personalEvent = personalSnapshot.events.find((event) => event.title === 'Personal invite');
    assert.equal(personalEvent.externalProviderLinks[0].provider, 'microsoft');
    assert.equal(personalEvent.externalProviderLinks[0].mode, 'outbound');
  } finally {
    fixture.cleanup();
  }
}

async function testExternalCalendarImportRefreshAndDetach() {
  const fixture = createStoreFixture('calendar-store-external-import-');

  try {
    fixture.store.prepareHostedBootstrap();

    let remoteEvents = [
      {
        provider: 'google',
        remoteCalendarId: 'remote_cal_1',
        remoteEventId: 'remote_a',
        remoteVersion: 'v1',
        remoteDeleted: false,
        title: 'Imported A',
        description: 'First imported event',
        location: 'Remote room A',
        people: ['a@example.com'],
        type: 'meeting',
        completed: false,
        repeat: 'none',
        hasDeadline: false,
        groupName: '',
        startsAt: '2026-04-16T09:00:00.000Z',
        endsAt: '2026-04-16T10:00:00.000Z',
        isAllDay: false,
        sourceTimeZone: 'Europe/Helsinki',
        color: '#4f9d69',
        tags: [],
        syncPolicy: 'internal_only',
        visibility: 'private',
        externalProviderLinks: [{ provider: 'google', externalEventId: 'remote_a', url: '' }],
      },
      {
        provider: 'google',
        remoteCalendarId: 'remote_cal_1',
        remoteEventId: 'remote_b',
        remoteVersion: 'v1',
        remoteDeleted: false,
        title: 'Imported B title that stays long',
        description: 'Second imported event',
        location: 'Remote room B',
        people: ['b@example.com'],
        type: 'meeting',
        completed: false,
        repeat: 'weekly',
        hasDeadline: false,
        groupName: '',
        startsAt: '2026-04-17T00:00:00.000Z',
        endsAt: '2026-04-18T00:00:00.000Z',
        isAllDay: true,
        sourceTimeZone: 'Europe/Helsinki',
        color: '#4d8cf5',
        tags: [],
        syncPolicy: 'internal_only',
        visibility: 'private',
        externalProviderLinks: [{ provider: 'google', externalEventId: 'remote_b', url: '' }],
      },
    ];

    fixture.store.oauthService.listExternalCalendars = async () => [
      {
        accountId: 'acct_google',
        provider: 'google',
        remoteCalendarId: 'remote_cal_1',
        displayName: 'Work',
        selected: true,
        color: '#4f9d69',
        timeZone: 'Europe/Helsinki',
      },
    ];
    fixture.store.oauthService.listExternalEvents = async () => ({
      provider: 'google',
      remoteCalendarId: 'remote_cal_1',
      events: remoteEvents,
      syncCursor: null,
    });

    let result = await fixture.store.importExternalCalendar({
      accountId: 'acct_google',
      remoteCalendarId: 'remote_cal_1',
    });
    assert.equal(result.createdCount, 2);
    assert.equal(result.snapshot.events.length, 2);
    assert.equal(result.snapshot.externalCalendarSources.length, 1);
    assert.equal(result.snapshot.externalEventLinks.length, 2);
    assert.equal(
      result.snapshot.events.find((event) => event.title === 'Imported B title that stays long')
        ?.isAllDay,
      true
    );
    assert.equal(
      result.snapshot.events.find((event) => event.title === 'Imported A')?.sourceTimeZone,
      'Europe/Helsinki'
    );

    const importedA = result.snapshot.events.find((event) => event.title === 'Imported A');
    const importedB = result.snapshot.events.find(
      (event) => event.title === 'Imported B title that stays long'
    );
    assert.equal(importedB.title.length > EVENT_TITLE_MAX_LENGTH, true);
    fixture.store.updateEvent({
      id: importedA.id,
      title: 'Locally detached A',
    });

    remoteEvents = [
      {
        ...remoteEvents[0],
        remoteVersion: 'v2',
        title: 'Remote overwrite should not win',
      },
    ];

    result = await fixture.store.refreshExternalSource({
      sourceId: result.source.sourceId,
    });

    const latestSnapshot = result.snapshot;
    assert.equal(
      latestSnapshot.events.find((event) => event.id === importedA.id)?.title,
      'Locally detached A'
    );
    assert.equal(
      latestSnapshot.externalEventLinks.find((link) => link.eventId === importedA.id)?.syncStatus,
      'detached'
    );

    assert.equal(fixture.store.getEventById(importedB.id)?.deleted, true);
    assert.equal(
      latestSnapshot.externalEventLinks.find((link) => link.eventId === importedB.id)?.syncStatus,
      'removed'
    );
  } finally {
    fixture.cleanup();
  }
}

function testBundleAndIcsImportExport() {
  const sourceFixture = createStoreFixture('calendar-store-bundle-source-');
  const targetFixture = createStoreFixture('calendar-store-bundle-target-');
  const icsFixture = createStoreFixture('calendar-store-ics-target-');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-store-transfer-'));

  try {
    sourceFixture.store.prepareHostedBootstrap();
    sourceFixture.store.importCalendarBundle({
      version: 'calendar-bundle-v1',
      exportedAt: new Date('2026-04-16T08:00:00.000Z').toISOString(),
      deviceId: 'device_source',
      lastSequence: 0,
      tags: [{ id: 'tag_bundle', label: 'Bundle', color: '#1d4ed8' }],
      externalCalendarSources: [
        {
          sourceId: 'source_google',
          accountId: 'acct_google',
          provider: 'google',
          remoteCalendarId: 'google_cal',
          displayName: 'Google import',
          selected: true,
          syncCursor: null,
        },
      ],
      externalEventLinks: [
        {
          eventId: 'event_bundle',
          sourceId: 'source_google',
          provider: 'google',
          remoteCalendarId: 'google_cal',
          remoteEventId: 'google_event_1',
          remoteVersion: 'etag_1',
          syncStatus: 'active',
          lastSeenRemoteAt: '2026-04-16T08:00:00.000Z',
          importedAt: '2026-04-16T08:00:00.000Z',
          updatedAt: '2026-04-16T08:00:00.000Z',
        },
      ],
      events: [
        {
          id: 'event_bundle',
          title: 'Bundle event',
          description: 'Round-trip bundle content',
          type: 'focus',
          completed: false,
          repeat: 'weekly',
          hasDeadline: false,
          groupName: '',
          location: 'Bundle room',
          people: ['bundle@example.com'],
          sourceTimeZone: 'Europe/Helsinki',
          startsAt: '2026-04-16T09:00:00.000Z',
          endsAt: '2026-04-17T09:00:00.000Z',
          isAllDay: true,
          reminderMinutesBeforeStart: 30,
          desktopNotificationEnabled: true,
          emailNotificationEnabled: false,
          emailNotificationRecipients: [],
          notifications: [
            createNotificationInput('bundle_primary', {
              reminderMinutesBeforeStart: 30,
              desktopNotificationEnabled: true,
            }),
          ],
          color: '#4f9d69',
          tags: [{ id: 'tag_bundle', label: 'Bundle', color: '#1d4ed8' }],
          syncPolicy: 'google_sync',
          visibility: 'busy_only',
          externalProviderLinks: [
            { provider: 'google', externalEventId: 'google_event_1', url: 'https://example.com/a' },
          ],
        },
      ],
    });

    const bundlePath = path.join(tempDir, 'calendar-export.json');
    const icsPath = path.join(tempDir, 'calendar-export.ics');

    const exportedBundle = sourceFixture.store.exportData({
      format: 'json',
      path: bundlePath,
    });
    assert.equal(exportedBundle.format, 'json');

    const bundle = calendarInterchange.parseCalendarBundleText(fs.readFileSync(bundlePath, 'utf8'));
    assert.equal(bundle.events.length, 1);
    assert.equal(bundle.externalCalendarSources.length, 1);
    assert.equal(bundle.externalEventLinks.length, 1);
    assert.equal(bundle.events[0].isAllDay, true);
    assert.equal(bundle.events[0].sourceTimeZone, 'Europe/Helsinki');

    const importedBundle = targetFixture.store.importData({
      format: 'json',
      path: bundlePath,
    });
    assert.equal(importedBundle.importedCount, 1);
    assert.equal(importedBundle.snapshot.events[0].title, 'Bundle event');
    assert.equal(importedBundle.snapshot.events[0].isAllDay, true);
    assert.equal(importedBundle.snapshot.events[0].sourceTimeZone, 'Europe/Helsinki');
    assert.equal(importedBundle.snapshot.externalCalendarSources.length, 1);
    assert.equal(importedBundle.snapshot.externalEventLinks.length, 1);

    sourceFixture.store.exportData({
      format: 'ics',
      path: icsPath,
    });
    const importedIcs = icsFixture.store.importData({
      format: 'ics',
      path: icsPath,
    });
    assert.equal(importedIcs.importedCount >= 1, true);
    assert.equal(importedIcs.snapshot.events.some((event) => event.title === 'Bundle event'), true);
  } finally {
    sourceFixture.cleanup();
    targetFixture.cleanup();
    icsFixture.cleanup();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testFilePickerImportFlow() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calendar-store-picker-files-'));
  const icsPath = path.join(tempDir, 'picked-calendar.ics');
  fs.writeFileSync(
    icsPath,
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Calendar App Test//EN',
      'BEGIN:VEVENT',
      'UID:picked-event-1',
      'SUMMARY:Picked file event',
      'DTSTART:20260416T090000Z',
      'DTEND:20260416T100000Z',
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n'),
    'utf8'
  );

  const canceledFixture = createStoreFixture('calendar-store-picker-cancel-', {
    dialog: {
      async showOpenDialog() {
        return { canceled: true, filePaths: [] };
      },
    },
  });
  const importFixture = createStoreFixture('calendar-store-picker-import-', {
    dialog: {
      async showOpenDialog(options = {}) {
        assert.equal(options.title, 'Import calendar file');
        assert.equal(options.properties.includes('openFile'), true);
        assert.equal(
          options.filters.some((filter) => filter.extensions.includes('ics')),
          true
        );
        return { canceled: false, filePaths: [icsPath] };
      },
    },
  });

  try {
    const canceled = await canceledFixture.store.importDataFromFilePicker();
    assert.equal(canceled.canceled, true);
    assert.equal(canceledFixture.store.snapshot().events.length, 0);

    const imported = await importFixture.store.importDataFromFilePicker();
    assert.equal(imported.canceled, false);
    assert.equal(imported.format, 'ics');
    assert.equal(imported.importedCount, 1);
    assert.equal(imported.path, path.resolve(icsPath));
    assert.equal(
      imported.snapshot.events.some((event) => event.title === 'Picked file event'),
      true
    );
  } finally {
    canceledFixture.cleanup();
    importFixture.cleanup();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function testLocalTransportSession() {
  const fixture = createStoreFixture('calendar-store-transport-');

  try {
    fixture.store.prepareHostedBootstrap();
    fixture.store.createEvent({
      title: 'Transport event',
      type: 'meeting',
      startsAt: '2026-04-16T09:00:00.000Z',
      endsAt: '2026-04-16T10:00:00.000Z',
      color: '#4f9d69',
    });

    const session = fixture.store.createLocalSession({
      mode: 'snapshot',
      scope: 'all',
    });

    assert.equal(session.invite.version, 'local-transport-invite-v1');
    assert.equal(Boolean(session.invite.bundleGzipBase64), false);

    const consumed = fixture.store.consumeLocalSession({
      sessionId: session.sessionId,
      token: session.invite.token,
      device: { id: 'phone_1', name: 'Phone' },
    });

    assert.equal(consumed.payload.mode, 'snapshot');
    const bundleJson = zlib
      .gunzipSync(Buffer.from(consumed.payload.bundleGzipBase64, 'base64'))
      .toString('utf8');
    const bundle = calendarInterchange.parseCalendarBundleText(bundleJson);
    assert.equal(bundle.events.length, 1);
    assert.equal(bundle.events[0].title, 'Transport event');

    assert.throws(
      () =>
        fixture.store.consumeLocalSession({
          sessionId: session.sessionId,
          token: session.invite.token,
        }),
      /already closed/
    );
  } finally {
    fixture.cleanup();
  }
}

function testOAuthClientConfigPersistence() {
  const previousGoogleClientId = process.env.CALENDAR_GOOGLE_CLIENT_ID;
  const previousGoogleRedirectUri = process.env.CALENDAR_GOOGLE_REDIRECT_URI;
  const previousMicrosoftClientId = process.env.CALENDAR_MICROSOFT_CLIENT_ID;
  const previousMicrosoftRedirectUri = process.env.CALENDAR_MICROSOFT_REDIRECT_URI;
  const previousMicrosoftAuthority = process.env.CALENDAR_MICROSOFT_AUTHORITY;
  delete process.env.CALENDAR_GOOGLE_CLIENT_ID;
  delete process.env.CALENDAR_GOOGLE_REDIRECT_URI;
  delete process.env.CALENDAR_MICROSOFT_CLIENT_ID;
  delete process.env.CALENDAR_MICROSOFT_REDIRECT_URI;
  delete process.env.CALENDAR_MICROSOFT_AUTHORITY;

  const fixture = createStoreFixture('calendar-store-oauth-config-');

  try {
    const initialSecurity = fixture.store.getSecuritySnapshot();
    assert.equal(initialSecurity.auth.clientConfig.google.clientIdConfigured, false);
    assert.equal(initialSecurity.auth.clientConfig.microsoft.clientIdConfigured, false);
    assert.equal(
      fixture.store.getAvailableProviders().find((provider) => provider.id === 'google').configured,
      false
    );

    const updated = fixture.store.updateOAuthClientConfig({
      google: {
        clientId: 'google-client-id.apps.googleusercontent.com',
        redirectUri: 'http://127.0.0.1:45781/oauth/google/callback',
      },
      microsoft: {
        clientId: '00000000-0000-0000-0000-000000000000',
        redirectUri: 'http://localhost:45782/oauth/microsoft/callback',
        authority: 'consumers',
      },
    });

    assert.equal(updated.security.auth.clientConfig.google.clientIdConfigured, true);
    assert.equal(updated.security.auth.clientConfig.google.clientIdSource, 'settings');
    assert.equal(updated.security.auth.clientConfig.microsoft.clientIdConfigured, true);
    assert.equal(updated.security.auth.clientConfig.microsoft.authority, 'consumers');
    assert.equal(updated.security.auth.clientConfig.microsoft.defaultAuthority, 'common');
    assert.equal(
      fixture.store.getAvailableProviders().find((provider) => provider.id === 'google').configured,
      true
    );
    assert.equal(
      fixture.store.getAvailableProviders().find((provider) => provider.id === 'microsoft').configured,
      true
    );
    assert.equal(
      fixture.store.oauthService.getProviderConfig('microsoft').authUrl,
      'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize'
    );
    assert.equal(
      fixture.store.oauthService.getProviderConfig('microsoft').tokenUrl,
      'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'
    );

    assert.throws(
      () =>
        fixture.store.updateOAuthClientConfig({
          google: {
            redirectUri: 'https://example.com/oauth/callback',
          },
        }),
      /localhost HTTP URL/
    );
    assert.throws(
      () =>
        fixture.store.updateOAuthClientConfig({
          microsoft: {
            authority: 'bad authority/segment',
          },
        }),
      /Microsoft authority must be/
    );
  } finally {
    fixture.cleanup();
    if (previousGoogleClientId === undefined) {
      delete process.env.CALENDAR_GOOGLE_CLIENT_ID;
    } else {
      process.env.CALENDAR_GOOGLE_CLIENT_ID = previousGoogleClientId;
    }
    if (previousGoogleRedirectUri === undefined) {
      delete process.env.CALENDAR_GOOGLE_REDIRECT_URI;
    } else {
      process.env.CALENDAR_GOOGLE_REDIRECT_URI = previousGoogleRedirectUri;
    }
    if (previousMicrosoftClientId === undefined) {
      delete process.env.CALENDAR_MICROSOFT_CLIENT_ID;
    } else {
      process.env.CALENDAR_MICROSOFT_CLIENT_ID = previousMicrosoftClientId;
    }
    if (previousMicrosoftRedirectUri === undefined) {
      delete process.env.CALENDAR_MICROSOFT_REDIRECT_URI;
    } else {
      process.env.CALENDAR_MICROSOFT_REDIRECT_URI = previousMicrosoftRedirectUri;
    }
    if (previousMicrosoftAuthority === undefined) {
      delete process.env.CALENDAR_MICROSOFT_AUTHORITY;
    } else {
      process.env.CALENDAR_MICROSOFT_AUTHORITY = previousMicrosoftAuthority;
    }
  }
}

async function main() {
  const checks = [
    ['app_error_helpers_and_ipc_wrapper', testAppErrorHelpersAndIpcWrapper],
    ['developer_mode_preference_and_debug_redaction', testDeveloperModePreferenceAndDebugRedaction],
    ['click_intent_helpers', testClickIntentHelpers],
    ['composer_routing_helpers', testComposerRoutingHelpers],
    ['keyboard_navigation_helpers', testKeyboardNavigationHelpers],
    ['event_scope_helpers', testEventScopeHelpers],
    ['reminder_helpers_and_validation', testReminderHelpersAndValidation],
    ['encrypted_at_rest', testEncryptedAtRest],
    ['legacy_migration', testLegacyMigration],
    ['event_roundtrip_fields', testEventRoundTripFields],
    ['reminder_roundtrip', testReminderRoundTrip],
    ['master_key_rotation', testKeyRotation],
    ['new_store_starts_without_demo_seed', testNewStoreStartsWithoutDemoSeed],
    ['legacy_demo_seed_cleanup', testLegacyDemoSeedCleanup],
    ['hosted_envelope_projection', testHostedEnvelopeProjection],
    ['external_calendar_import_refresh_and_detach', testExternalCalendarImportRefreshAndDetach],
    ['outbound_provider_invite_flow', testOutboundProviderInviteFlow],
    ['bundle_and_ics_import_export', testBundleAndIcsImportExport],
    ['file_picker_import_flow', testFilePickerImportFlow],
    ['local_transport_session', testLocalTransportSession],
    ['oauth_client_config_persistence', testOAuthClientConfigPersistence],
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
