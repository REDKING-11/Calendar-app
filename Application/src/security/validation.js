const path = require('node:path');

const EVENT_TYPES = new Set(['meeting', 'focus', 'personal']);
const EVENT_TYPE_ALIASES = {
  event: 'meeting',
  task: 'focus',
  appointment: 'personal',
};
const REPEAT_OPTIONS = new Set(['none', 'daily', 'weekly', 'monthly']);
const MAX_REMINDER_MINUTES = 365 * 24 * 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const SYNC_POLICIES = new Set([
  'internal_only',
  'google_sync',
  'microsoft_sync',
  'shared',
  'relay_sync',
]);
const SYNC_POLICY_ALIASES = {
  internal: 'internal_only',
  work: 'google_sync',
  personal: 'microsoft_sync',
};
const VISIBILITY_OPTIONS = new Set(['private', 'busy_only', 'shared_read', 'shared_edit']);
const VISIBILITY_ALIASES = {
  internal: 'private',
  external: 'busy_only',
};

function sanitizeInlineText(value, maxLength = 160) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function sanitizeMultilineText(value, maxLength = 5000) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLength);
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

function mapEventTypeValue(value) {
  const candidate = sanitizeInlineText(value, 32).toLowerCase();
  return EVENT_TYPE_ALIASES[candidate] || candidate;
}

function normalizeEventType(value, fallback = 'meeting') {
  const candidate = mapEventTypeValue(value);
  if (EVENT_TYPES.has(candidate)) {
    return candidate;
  }

  const fallbackCandidate = mapEventTypeValue(fallback);
  return EVENT_TYPES.has(fallbackCandidate) ? fallbackCandidate : 'meeting';
}

function sanitizeEventType(value, fallback = 'meeting') {
  const candidate = mapEventTypeValue(value || fallback);
  if (!EVENT_TYPES.has(candidate)) {
    throw new Error('Unsupported event type.');
  }

  return candidate;
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

  return links.slice(0, 8).flatMap((link) => {
    const provider = sanitizeInlineText(link?.provider, 32).toLowerCase();
    const externalEventId = sanitizeInlineText(link?.externalEventId, 160);
    const url = link?.url ? sanitizeUrl(link.url) : '';

    if (!provider || !externalEventId) {
      return [];
    }

    return [
      {
        provider,
        externalEventId,
        url,
      },
    ];
  });
}

function normalizeTags(tags = []) {
  if (!Array.isArray(tags)) {
    return [];
  }

  const seen = new Set();

  return tags.slice(0, 20).flatMap((tag) => {
    const label = sanitizeInlineText(tag?.label, 40);
    if (!label) {
      return [];
    }

    const key = label.toLowerCase();
    if (seen.has(key)) {
      return [];
    }

    seen.add(key);
    return [
      {
        id: sanitizeInlineText(tag?.id, 80) || null,
        label,
        color: sanitizeColor(tag?.color, '#475569'),
      },
    ];
  });
}

function normalizePeople(people = []) {
  const rawPeople = Array.isArray(people)
    ? people
    : String(people ?? '')
        .split(/[\n,;]+/g)
        .map((person) => person.trim());
  const seen = new Set();

  return rawPeople.slice(0, 20).flatMap((person) => {
    const value = sanitizeInlineText(person, 120);
    if (!value) {
      return [];
    }

    const key = value.toLowerCase();
    if (seen.has(key)) {
      return [];
    }

    seen.add(key);
    return [value];
  });
}

function sanitizeSyncPolicy(value, fallback = 'internal_only') {
  const candidate = sanitizeInlineText(value, 40).toLowerCase();
  const mappedCandidate = SYNC_POLICY_ALIASES[candidate] || candidate;
  const mappedFallback = SYNC_POLICY_ALIASES[fallback] || fallback;
  return SYNC_POLICIES.has(mappedCandidate) ? mappedCandidate : mappedFallback;
}

function sanitizeVisibility(value, fallback = 'private') {
  const candidate = sanitizeInlineText(value, 40).toLowerCase();
  const mappedCandidate = VISIBILITY_ALIASES[candidate] || candidate;
  const mappedFallback = VISIBILITY_ALIASES[fallback] || fallback;
  return VISIBILITY_OPTIONS.has(mappedCandidate) ? mappedCandidate : mappedFallback;
}

function sanitizeReminderMinutesBeforeStart(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const numeric = Number(value);
  if (
    !Number.isFinite(numeric) ||
    !Number.isInteger(numeric) ||
    numeric <= 0 ||
    numeric > MAX_REMINDER_MINUTES
  ) {
    throw new Error('Reminder value must be a whole number of minutes.');
  }

  return numeric;
}

function sanitizeNotificationRecipients(recipients = []) {
  const rawRecipients = Array.isArray(recipients)
    ? recipients
    : String(recipients ?? '')
        .split(/[\n,;]+/g)
        .map((recipient) => recipient.trim());
  const seen = new Set();

  return rawRecipients.slice(0, 20).flatMap((recipient) => {
    const normalized = sanitizeInlineText(recipient, 160).toLowerCase();
    if (!normalized) {
      return [];
    }

    if (!EMAIL_PATTERN.test(normalized)) {
      throw new Error('Notification recipients must be valid email addresses.');
    }

    if (seen.has(normalized)) {
      return [];
    }

    seen.add(normalized);
    return [normalized];
  });
}

function sanitizeNotificationEntry(notification = {}) {
  const reminderMinutesBeforeStart = sanitizeReminderMinutesBeforeStart(
    notification.reminderMinutesBeforeStart
  );
  const desktopNotificationEnabled = sanitizeBoolean(notification.desktopNotificationEnabled);
  const emailNotificationEnabled = sanitizeBoolean(notification.emailNotificationEnabled);
  const emailNotificationRecipients = sanitizeNotificationRecipients(
    notification.emailNotificationRecipients
  );

  if (reminderMinutesBeforeStart === null) {
    throw new Error('Notification timing is required.');
  }

  if (!desktopNotificationEnabled && !emailNotificationEnabled) {
    throw new Error('Notification must send to this machine, email, or both.');
  }

  if (emailNotificationEnabled && emailNotificationRecipients.length === 0) {
    throw new Error('Email notifications need at least one recipient.');
  }

  return {
    id: sanitizeInlineText(notification.id, 120) || null,
    reminderMinutesBeforeStart,
    desktopNotificationEnabled,
    emailNotificationEnabled,
    emailNotificationRecipients,
  };
}

function sanitizeNotifications(notifications = []) {
  if (notifications === undefined) {
    return undefined;
  }

  if (!Array.isArray(notifications)) {
    throw new Error('Notifications must be an array.');
  }

  const seenKeys = new Set();

  return notifications.flatMap((notification, index) => {
    const sanitized = sanitizeNotificationEntry(notification);
    const key = sanitized.id || `${sanitized.reminderMinutesBeforeStart}:${index}`;
    if (seenKeys.has(key)) {
      return [];
    }

    seenKeys.add(key);
    return [sanitized];
  });
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

  const repeat = sanitizeInlineText(input.repeat || 'none', 32).toLowerCase();
  if (!REPEAT_OPTIONS.has(repeat)) {
    throw new Error('Unsupported repeat value.');
  }

  const notifications = sanitizeNotifications(input.notifications) || [];
  const primaryNotification =
    notifications[0] ||
    (input.reminderMinutesBeforeStart !== undefined ||
    input.desktopNotificationEnabled !== undefined ||
    input.emailNotificationEnabled !== undefined ||
    input.emailNotificationRecipients !== undefined
      ? {
          reminderMinutesBeforeStart: sanitizeReminderMinutesBeforeStart(
            input.reminderMinutesBeforeStart
          ),
          desktopNotificationEnabled: sanitizeBoolean(input.desktopNotificationEnabled),
          emailNotificationEnabled: sanitizeBoolean(input.emailNotificationEnabled),
          emailNotificationRecipients: sanitizeNotificationRecipients(
            input.emailNotificationRecipients
          ),
        }
      : null);

  return {
    title,
    description: sanitizeMultilineText(input.description, 5000),
    type: sanitizeEventType(input.type || 'meeting'),
    completed: sanitizeBoolean(input.completed),
    repeat,
    hasDeadline: sanitizeBoolean(input.hasDeadline),
    groupName: sanitizeInlineText(input.groupName, 120),
    location: sanitizeInlineText(input.location, 160),
    people: normalizePeople(input.people),
    startsAt,
    endsAt,
    reminderMinutesBeforeStart: primaryNotification?.reminderMinutesBeforeStart ?? null,
    desktopNotificationEnabled: Boolean(primaryNotification?.desktopNotificationEnabled),
    emailNotificationEnabled: Boolean(primaryNotification?.emailNotificationEnabled),
    emailNotificationRecipients: primaryNotification?.emailNotificationRecipients || [],
    notifications,
    color: sanitizeColor(input.color),
    tags: normalizeTags(input.tags),
    syncPolicy: sanitizeSyncPolicy(input.syncPolicy),
    visibility: sanitizeVisibility(input.visibility),
    externalProviderLinks: normalizeExternalProviderLinks(input.externalProviderLinks),
  };
}

function sanitizeEventUpdateInput(input = {}) {
  const sanitized = {};
  let notificationsOverride = null;

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
    sanitized.type = sanitizeEventType(input.type);
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

  if (input.location !== undefined) {
    sanitized.location = sanitizeInlineText(input.location, 160);
  }

  if (input.people !== undefined) {
    sanitized.people = normalizePeople(input.people);
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

  if (input.reminderMinutesBeforeStart !== undefined) {
    sanitized.reminderMinutesBeforeStart = sanitizeReminderMinutesBeforeStart(
      input.reminderMinutesBeforeStart
    );
  }

  if (input.desktopNotificationEnabled !== undefined) {
    sanitized.desktopNotificationEnabled = sanitizeBoolean(input.desktopNotificationEnabled);
  }

  if (input.emailNotificationEnabled !== undefined) {
    sanitized.emailNotificationEnabled = sanitizeBoolean(input.emailNotificationEnabled);
  }

  if (input.emailNotificationRecipients !== undefined) {
    sanitized.emailNotificationRecipients = sanitizeNotificationRecipients(
      input.emailNotificationRecipients
    );
  }

  if (input.notifications !== undefined) {
    notificationsOverride = sanitizeNotifications(input.notifications);
    sanitized.notifications = notificationsOverride;
  }

  if (notificationsOverride) {
    sanitized.reminderMinutesBeforeStart =
      notificationsOverride[0]?.reminderMinutesBeforeStart ?? null;
    sanitized.desktopNotificationEnabled = Boolean(
      notificationsOverride[0]?.desktopNotificationEnabled
    );
    sanitized.emailNotificationEnabled = Boolean(
      notificationsOverride[0]?.emailNotificationEnabled
    );
    sanitized.emailNotificationRecipients =
      notificationsOverride[0]?.emailNotificationRecipients || [];
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
  normalizeEventType,
  sanitizeEventCreateInput,
  sanitizeEventUpdateInput,
  validateImportPath,
};
