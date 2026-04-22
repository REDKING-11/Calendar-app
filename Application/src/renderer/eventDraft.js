export const COLOR_PRESETS = ['#4f9d69', '#4d8cf5', '#e3a13b', '#7c3aed', '#ef4444', '#0f766e'];
export const EVENT_TYPE_OPTIONS = [
  { id: 'meeting', label: 'Meeting' },
  { id: 'focus', label: 'Focus' },
  { id: 'personal', label: 'Personal' },
];
export const EVENT_SCOPE_OPTIONS = [
  { id: 'internal', label: 'Internal' },
  { id: 'work', label: 'Work' },
  { id: 'personal', label: 'Personal' },
];
export const DURATION_PRESET_OPTIONS = [
  { id: 30, label: '30m' },
  { id: 60, label: '1h' },
  { id: 120, label: '2h' },
];
export const REMINDER_UNIT_OPTIONS = [
  { id: 'minutes', label: 'Minutes' },
  { id: 'hours', label: 'Hours' },
  { id: 'days', label: 'Days' },
];
export const INVITE_DELIVERY_MODE_OPTIONS = [
  { id: 'local_only', label: 'Save locally only' },
  { id: 'provider_invite', label: 'Send calendar invites' },
];

const EVENT_TYPE_ALIASES = {
  event: 'meeting',
  task: 'focus',
  appointment: 'personal',
};

const EVENT_SCOPE_ALIASES = {
  internal_only: 'internal',
  private: 'internal',
  internal: 'internal',
  google_sync: 'work',
  work: 'work',
  microsoft_sync: 'personal',
  personal: 'personal',
};

const REMINDER_UNIT_MULTIPLIERS = {
  minutes: 1,
  hours: 60,
  days: 1440,
};
const MAX_REMINDER_MINUTES = 365 * 24 * 60;
export const EVENT_TITLE_MAX_LENGTH = 20;
export const DEFAULT_NOTIFICATION_REMINDER_MINUTES = 15;
const PRACTICAL_EMAIL_PATTERN = /^[a-z0-9](?:[a-z0-9.!#$%&'*+/=?^_`{|}~-]{0,62}[a-z0-9])?@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function sanitizeInlineUserText(value = '', maxLength = 160) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function sanitizeMultilineUserText(value = '', maxLength = 5000) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLength);
}

export function normalizeEmailAddress(value = '') {
  return sanitizeInlineUserText(value, 254).toLowerCase();
}

export function isValidEmailAddress(value = '') {
  const normalized = normalizeEmailAddress(value);
  if (!normalized || normalized.length > 254 || !PRACTICAL_EMAIL_PATTERN.test(normalized)) {
    return false;
  }

  const [localPart, domain] = normalized.split('@');
  if (!localPart || !domain || localPart.length > 64 || domain.length > 253) {
    return false;
  }

  return domain.split('.').every((label) => label.length > 0 && label.length <= 63);
}

export function normalizeOptionalEmailAddress(value = '') {
  const normalized = normalizeEmailAddress(value);
  return normalized && isValidEmailAddress(normalized) ? normalized : '';
}

const INVITE_DELIVERY_MODE_ALIASES = {
  local: 'local_only',
  local_only: 'local_only',
  provider: 'provider_invite',
  invite: 'provider_invite',
  provider_invite: 'provider_invite',
};

export function normalizeEventType(value = 'meeting') {
  const normalized = String(value || 'meeting').trim().toLowerCase();
  return EVENT_TYPE_ALIASES[normalized] || normalized || 'meeting';
}

export function normalizeEventScope(value = 'internal') {
  const normalized = String(value || 'internal').trim().toLowerCase();
  return EVENT_SCOPE_ALIASES[normalized] || 'internal';
}

export function scopeToSyncPolicy(value = 'internal') {
  const normalized = normalizeEventScope(value);
  if (normalized === 'work') {
    return 'google_sync';
  }
  if (normalized === 'personal') {
    return 'microsoft_sync';
  }
  return 'internal_only';
}

export function scopeToVisibility(value = 'internal') {
  return normalizeEventScope(value) === 'internal' ? 'private' : 'busy_only';
}

export function resolveDraftScope(syncPolicy = 'internal_only', visibility = 'private') {
  const normalizedVisibility = String(visibility || 'private').trim().toLowerCase();
  if (normalizedVisibility === 'private') {
    return 'internal';
  }

  const normalizedSyncPolicy = String(syncPolicy || 'internal_only').trim().toLowerCase();
  if (normalizedSyncPolicy === 'google_sync') {
    return 'work';
  }
  if (normalizedSyncPolicy === 'microsoft_sync') {
    return 'personal';
  }

  return 'internal';
}

export function normalizeReminderUnit(value = 'minutes') {
  const normalized = String(value || 'minutes').trim().toLowerCase();
  return REMINDER_UNIT_MULTIPLIERS[normalized] ? normalized : 'minutes';
}

export function normalizeReminderMinutesBeforeStart(value = null) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }

  return numeric <= MAX_REMINDER_MINUTES ? numeric : null;
}

export function buildReminderMinutesFromParts(amount, unit = 'minutes') {
  if (amount === '' || amount === null || amount === undefined) {
    return null;
  }

  const normalizedAmount = Number(amount);
  if (!Number.isFinite(normalizedAmount) || !Number.isInteger(normalizedAmount) || normalizedAmount <= 0) {
    return null;
  }

  const multiplier = REMINDER_UNIT_MULTIPLIERS[normalizeReminderUnit(unit)];
  return normalizeReminderMinutesBeforeStart(normalizedAmount * multiplier);
}

export function getReminderTimingParts(reminderMinutesBeforeStart = null) {
  const normalizedMinutes = normalizeReminderMinutesBeforeStart(reminderMinutesBeforeStart);
  if (normalizedMinutes === null) {
    return {
      amount: '',
      unit: 'minutes',
    };
  }

  if (normalizedMinutes % REMINDER_UNIT_MULTIPLIERS.days === 0) {
    return {
      amount: String(normalizedMinutes / REMINDER_UNIT_MULTIPLIERS.days),
      unit: 'days',
    };
  }

  if (normalizedMinutes % REMINDER_UNIT_MULTIPLIERS.hours === 0) {
    return {
      amount: String(normalizedMinutes / REMINDER_UNIT_MULTIPLIERS.hours),
      unit: 'hours',
    };
  }

  return {
    amount: String(normalizedMinutes),
    unit: 'minutes',
  };
}

export function getReminderAmountLimit(unit = 'minutes') {
  const normalizedUnit = normalizeReminderUnit(unit);
  return Math.floor(MAX_REMINDER_MINUTES / REMINDER_UNIT_MULTIPLIERS[normalizedUnit]);
}

export function normalizeNotificationRecipients(value = []) {
  const rawValues = Array.isArray(value)
    ? value
    : String(value || '')
        .split(/[\n,;]+/g)
        .map((item) => item.trim());
  const seen = new Set();

  return rawValues.slice(0, 20).flatMap((item) => {
    const normalized = normalizeEmailAddress(item);
    if (!normalized || !isValidEmailAddress(normalized) || seen.has(normalized)) {
      return [];
    }

    seen.add(normalized);
    return [normalized];
  });
}

export function normalizeInviteDeliveryMode(value = 'local_only') {
  const normalized = String(value || 'local_only').trim().toLowerCase();
  return INVITE_DELIVERY_MODE_ALIASES[normalized] || 'local_only';
}

export function scopeToInviteProvider(scope = 'internal') {
  const normalizedScope = normalizeEventScope(scope);
  if (normalizedScope === 'work') {
    return 'google';
  }
  if (normalizedScope === 'personal') {
    return 'microsoft';
  }
  return '';
}

export function normalizeInviteProvider(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return ['google', 'microsoft'].includes(normalized) ? normalized : '';
}

export function extractInviteeEmails(value = []) {
  const rawValues = Array.isArray(value) ? value : parsePeopleInput(value);
  const seen = new Set();

  return rawValues.flatMap((item) => {
    const normalized = normalizeEmailAddress(item);
    if (!normalized || !isValidEmailAddress(normalized) || seen.has(normalized)) {
      return [];
    }

    seen.add(normalized);
    return [normalized];
  });
}

function createNotificationId() {
  const randomPart =
    typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  return `notification_${randomPart}`;
}

export function createNotificationDraft(defaults = {}) {
  return {
    id: String(defaults.id || createNotificationId()),
    reminderMinutesBeforeStart: normalizeReminderMinutesBeforeStart(
      defaults.reminderMinutesBeforeStart
    ),
    desktopNotificationEnabled: Boolean(defaults.desktopNotificationEnabled),
    emailNotificationEnabled: Boolean(defaults.emailNotificationEnabled),
    emailNotificationRecipients: normalizeNotificationRecipients(
      defaults.emailNotificationRecipients
    ),
  };
}

export function isNotificationDraftConfigured(notification = {}) {
  return Boolean(
    normalizeReminderMinutesBeforeStart(notification.reminderMinutesBeforeStart) !== null &&
      (Boolean(notification.desktopNotificationEnabled) ||
        (Boolean(notification.emailNotificationEnabled) &&
          normalizeNotificationRecipients(notification.emailNotificationRecipients).length > 0))
  );
}

export function normalizeNotificationDrafts(notifications = [], legacyFallback = null) {
  const seenIds = new Set();
  const sourceNotifications =
    Array.isArray(notifications) && notifications.length > 0
      ? notifications
      : legacyFallback
        ? [legacyFallback]
        : [];

  return sourceNotifications.flatMap((notification) => {
    const normalized = createNotificationDraft(notification);
    if (seenIds.has(normalized.id)) {
      return [];
    }

    seenIds.add(normalized.id);
    return [normalized];
  });
}

export function getPrimaryNotificationDraft(draftEvent) {
  const notifications = normalizeNotificationDrafts(
    draftEvent?.notifications,
    draftEvent
      ? {
          reminderMinutesBeforeStart: draftEvent.reminderMinutesBeforeStart,
          desktopNotificationEnabled: draftEvent.desktopNotificationEnabled,
          emailNotificationEnabled: draftEvent.emailNotificationEnabled,
          emailNotificationRecipients: draftEvent.emailNotificationRecipients,
        }
      : null
  );
  const configuredNotification = notifications.find((notification) =>
    isNotificationDraftConfigured(notification)
  );

  return configuredNotification || null;
}

export function syncDraftNotificationFields(draftEvent) {
  const notifications = normalizeNotificationDrafts(
    draftEvent?.notifications,
    draftEvent
      ? {
          reminderMinutesBeforeStart: draftEvent.reminderMinutesBeforeStart,
          desktopNotificationEnabled: draftEvent.desktopNotificationEnabled,
          emailNotificationEnabled: draftEvent.emailNotificationEnabled,
          emailNotificationRecipients: draftEvent.emailNotificationRecipients,
        }
      : null
  );
  const primaryNotification = notifications.find((notification) =>
    isNotificationDraftConfigured(notification)
  );

  return {
    ...draftEvent,
    notifications,
    reminderMinutesBeforeStart: primaryNotification?.reminderMinutesBeforeStart ?? null,
    desktopNotificationEnabled: Boolean(primaryNotification?.desktopNotificationEnabled),
    emailNotificationEnabled: Boolean(primaryNotification?.emailNotificationEnabled),
    emailNotificationRecipients: primaryNotification?.emailNotificationRecipients || [],
  };
}

export function formatDateForInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatTimeForInput(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function parsePeopleInput(value = '') {
  return String(value || '')
    .split(/[\n,;]+/g)
    .map((item) => sanitizeInlineUserText(item, 120))
    .filter(Boolean);
}

function formatEmailListInput(value = []) {
  return normalizeNotificationRecipients(value).join(', ');
}

function coerceMinutes(value, fallback = 60) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function addMinutesToDate(date, minutes) {
  const nextDate = new Date(date);
  nextDate.setMinutes(nextDate.getMinutes() + minutes);
  return nextDate;
}

export function addMinutesToTime(timeValue, minutes) {
  const [hours = '0', mins = '0'] = String(timeValue || '09:00').split(':');
  const baseDate = new Date(2000, 0, 1, Number(hours), Number(mins), 0, 0);
  return formatTimeForInput(addMinutesToDate(baseDate, minutes));
}

export function getTimeDifferenceMinutes(startTime, endTime) {
  const [startHours = '0', startMinutes = '0'] = String(startTime || '09:00').split(':');
  const [endHours = '0', endMinutes = '0'] = String(endTime || '10:00').split(':');
  const startTotal = Number(startHours) * 60 + Number(startMinutes);
  const endTotal = Number(endHours) * 60 + Number(endMinutes);
  return endTotal - startTotal;
}

export function getDraftDurationMinutes(draftEvent, fallback = 60) {
  const draftDuration = coerceMinutes(draftEvent?.durationMinutes, 0);
  if (draftDuration > 0) {
    return draftDuration;
  }

  const timeDifference = getTimeDifferenceMinutes(draftEvent?.time, draftEvent?.endTime);
  return timeDifference > 0 ? timeDifference : fallback;
}

export function getDraftStartDate(draftEvent) {
  return new Date(`${draftEvent.date}T${draftEvent.time}:00`);
}

export function getDraftEndDate(draftEvent, fallbackDuration = 60) {
  const startsAt = getDraftStartDate(draftEvent);
  const endsAt = new Date(`${draftEvent.date}T${draftEvent.endTime}:00`);
  if (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    return addMinutesToDate(startsAt, getDraftDurationMinutes(draftEvent, fallbackDuration));
  }

  return endsAt;
}

export function setDraftDuration(draftEvent, durationMinutes) {
  const nextDuration = coerceMinutes(durationMinutes, 60);
  return {
    ...draftEvent,
    durationMinutes: nextDuration,
    endTime: addMinutesToTime(draftEvent.time, nextDuration),
  };
}

export function isDraftEventValid(draftEvent) {
  return Boolean(
    draftEvent?.title?.trim() &&
      draftEvent?.date &&
      draftEvent?.time &&
      draftEvent?.endTime
  );
}

export function createEmptyDraftEvent(date = new Date(), durationMinutes = 60, defaults = {}) {
  const defaultDuration = coerceMinutes(durationMinutes, 60);
  const defaultTime =
    date.getHours() === 0 && date.getMinutes() === 0 ? '09:00' : formatTimeForInput(date);
  const endTime = addMinutesToTime(defaultTime, defaultDuration);

  const notifications = normalizeNotificationDrafts(
    defaults.notifications,
    {
      reminderMinutesBeforeStart: defaults.reminderMinutesBeforeStart,
      desktopNotificationEnabled: defaults.desktopNotificationEnabled,
      emailNotificationEnabled: defaults.emailNotificationEnabled,
      emailNotificationRecipients: defaults.emailNotificationRecipients,
    }
  );

  return syncDraftNotificationFields({
    title: '',
    description: '',
    location: '',
    peopleInput: '',
    inviteRecipientsInput: formatEmailListInput(defaults.inviteRecipients || []),
    type: normalizeEventType(defaults.type || 'meeting'),
    scope: normalizeEventScope(defaults.scope || defaults.sendFrom || 'internal'),
    date: formatDateForInput(date),
    time: defaultTime,
    endTime,
    durationMinutes: defaultDuration,
    reminderMinutesBeforeStart: notifications[0]?.reminderMinutesBeforeStart ?? null,
    desktopNotificationEnabled: Boolean(notifications[0]?.desktopNotificationEnabled),
    emailNotificationEnabled: Boolean(notifications[0]?.emailNotificationEnabled),
    emailNotificationRecipients: notifications[0]?.emailNotificationRecipients || [],
    notifications:
      notifications.length > 0
        ? notifications
        : [createNotificationDraft({ reminderMinutesBeforeStart: DEFAULT_NOTIFICATION_REMINDER_MINUTES })],
    color: defaults.color || COLOR_PRESETS[0],
    completed: false,
    repeat: 'none',
    hasDeadline: false,
    groupName: '',
    tags: [],
    externalProviderLinks: [],
    inviteTargetAccountId: defaults.inviteTargetAccountId || '',
    inviteTargetProvider: normalizeInviteProvider(
      defaults.inviteTargetProvider || scopeToInviteProvider(defaults.scope || defaults.sendFrom)
    ),
    inviteTargetCalendarId: defaults.inviteTargetCalendarId || '',
    inviteDeliveryMode: normalizeInviteDeliveryMode(defaults.inviteDeliveryMode),
    lastInviteError: defaults.lastInviteError || '',
    showDescription: false,
    showLocation: false,
    showPeople: false,
  });
}

export function createDraftEventFromEvent(event) {
  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);
  const people = Array.isArray(event.people) ? event.people : [];
  const storedInviteRecipients = normalizeNotificationRecipients(event.inviteRecipients || []);
  const fallbackGuestEmails = extractInviteeEmails(people);
  const inviteRecipients =
    storedInviteRecipients.length > 0 ? storedInviteRecipients : fallbackGuestEmails;

  return syncDraftNotificationFields({
    title: event.title || '',
    description: event.description || '',
    location: event.location || '',
    peopleInput: people.join(', '),
    inviteRecipientsInput: inviteRecipients.join(', '),
    type: normalizeEventType(event.type || 'meeting'),
    date: formatDateForInput(startsAt),
    time: formatTimeForInput(startsAt),
    endTime: formatTimeForInput(endsAt),
    durationMinutes: Math.max(getTimeDifferenceMinutes(formatTimeForInput(startsAt), formatTimeForInput(endsAt)), 30),
    reminderMinutesBeforeStart: normalizeReminderMinutesBeforeStart(
      event.reminderMinutesBeforeStart
    ),
    desktopNotificationEnabled: Boolean(event.desktopNotificationEnabled),
    emailNotificationEnabled: Boolean(event.emailNotificationEnabled),
    emailNotificationRecipients: normalizeNotificationRecipients(
      event.emailNotificationRecipients
    ),
    notifications:
      normalizeNotificationDrafts(event.notifications, {
        reminderMinutesBeforeStart: event.reminderMinutesBeforeStart,
        desktopNotificationEnabled: event.desktopNotificationEnabled,
        emailNotificationEnabled: event.emailNotificationEnabled,
        emailNotificationRecipients: event.emailNotificationRecipients,
      }).length > 0
        ? normalizeNotificationDrafts(event.notifications, {
            reminderMinutesBeforeStart: event.reminderMinutesBeforeStart,
            desktopNotificationEnabled: event.desktopNotificationEnabled,
            emailNotificationEnabled: event.emailNotificationEnabled,
            emailNotificationRecipients: event.emailNotificationRecipients,
          })
        : [createNotificationDraft({ reminderMinutesBeforeStart: DEFAULT_NOTIFICATION_REMINDER_MINUTES })],
    completed: Boolean(event.completed),
    repeat: event.repeat || 'none',
    hasDeadline: Boolean(event.hasDeadline),
    groupName: event.groupName || '',
    color: event.color || COLOR_PRESETS[0],
    tags: (event.tags || []).map((tag) => ({ ...tag })),
    externalProviderLinks: (event.externalProviderLinks || []).map((link) => ({ ...link })),
    scope: resolveDraftScope(event.syncPolicy || 'internal_only', event.visibility || 'private'),
    inviteTargetAccountId: event.inviteTargetAccountId || '',
    inviteTargetProvider: normalizeInviteProvider(event.inviteTargetProvider),
    inviteTargetCalendarId: event.inviteTargetCalendarId || '',
    inviteDeliveryMode: normalizeInviteDeliveryMode(event.inviteDeliveryMode),
    lastInviteError: event.lastInviteError || '',
    showDescription: Boolean(event.description?.trim()),
    showLocation: Boolean(event.location?.trim()),
    showPeople: people.length > 0,
  });
}

export function buildEventPayloadFromDraft(draftEvent, fallbackDuration = 60) {
  const startsAt = getDraftStartDate(draftEvent);
  const endsAt = getDraftEndDate(draftEvent, fallbackDuration);
  const configuredNotifications = normalizeNotificationDrafts(draftEvent.notifications).filter(
    (notification) => isNotificationDraftConfigured(notification)
  );
  const primaryNotification = configuredNotifications[0] || null;

  return {
    title: sanitizeInlineUserText(draftEvent.title, EVENT_TITLE_MAX_LENGTH),
    description: sanitizeMultilineUserText(draftEvent.description, 5000),
    location: sanitizeInlineUserText(draftEvent.location, 160),
    people: parsePeopleInput(draftEvent.peopleInput),
    type: normalizeEventType(draftEvent.type),
    completed: Boolean(draftEvent.completed),
    repeat: draftEvent.repeat || 'none',
    hasDeadline: Boolean(draftEvent.hasDeadline),
    groupName: sanitizeInlineUserText(draftEvent.groupName, 120),
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    inviteRecipients: extractInviteeEmails(draftEvent.inviteRecipientsInput),
    reminderMinutesBeforeStart: primaryNotification?.reminderMinutesBeforeStart ?? null,
    desktopNotificationEnabled: Boolean(primaryNotification?.desktopNotificationEnabled),
    emailNotificationEnabled: Boolean(primaryNotification?.emailNotificationEnabled),
    emailNotificationRecipients: primaryNotification?.emailNotificationRecipients || [],
    notifications: configuredNotifications,
    color: draftEvent.color,
    tags: draftEvent.tags || [],
    syncPolicy: scopeToSyncPolicy(draftEvent.scope),
    visibility: scopeToVisibility(draftEvent.scope),
    inviteTargetAccountId: sanitizeInlineUserText(draftEvent.inviteTargetAccountId, 120),
    inviteTargetProvider:
      normalizeInviteProvider(draftEvent.inviteTargetProvider) ||
      scopeToInviteProvider(draftEvent.scope),
    inviteTargetCalendarId: sanitizeInlineUserText(draftEvent.inviteTargetCalendarId, 240),
    inviteDeliveryMode: normalizeInviteDeliveryMode(draftEvent.inviteDeliveryMode),
    lastInviteError: sanitizeInlineUserText(draftEvent.lastInviteError, 500),
    externalProviderLinks: draftEvent.externalProviderLinks || [],
  };
}
