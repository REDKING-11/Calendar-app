const crypto = require('node:crypto');

const CALENDAR_BUNDLE_VERSION = 'calendar-bundle-v1';

function createStableId(prefix, seed = '') {
  const digest = crypto.createHash('sha256').update(String(seed || '')).digest('hex').slice(0, 24);
  return `${prefix}_${digest}`;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatDateOnlyUtc(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

function formatIcsDateTimeUtc(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function parseCompactDate(value) {
  const match = String(value || '').trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  const parsed = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseCompactDateTime(value) {
  const trimmed = String(value || '').trim();
  const utcMatch = trimmed.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (utcMatch) {
    const [, year, month, day, hour, minute, second] = utcMatch;
    const parsed = new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const localMatch = trimmed.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (!localMatch) {
    return null;
  }

  const [, year, month, day, hour, minute, second] = localMatch;
  const parsed = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
    0
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function escapeIcsText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function unescapeIcsText(value) {
  return String(value || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function foldIcsLine(line) {
  const text = String(line || '');
  if (text.length <= 74) {
    return text;
  }

  const chunks = [];
  for (let index = 0; index < text.length; index += 73) {
    const segment = text.slice(index, index + 73);
    chunks.push(index === 0 ? segment : ` ${segment}`);
  }

  return chunks.join('\r\n');
}

function unfoldIcsText(text) {
  return String(text || '')
    .replace(/\r\n[ \t]/g, '')
    .replace(/\n[ \t]/g, '');
}

function parsePropertyLine(line) {
  const separatorIndex = line.indexOf(':');
  if (separatorIndex === -1) {
    return null;
  }

  const rawLeft = line.slice(0, separatorIndex);
  const value = line.slice(separatorIndex + 1);
  const [rawName, ...rawParams] = rawLeft.split(';');
  const name = String(rawName || '').trim().toUpperCase();
  const params = {};

  for (const param of rawParams) {
    const [paramName, rawParamValue = ''] = String(param || '').split('=');
    if (!paramName) {
      continue;
    }

    params[String(paramName).trim().toUpperCase()] = String(rawParamValue).trim();
  }

  return {
    name,
    params,
    value,
  };
}

function mapRruleToRepeat(value) {
  const parts = Object.fromEntries(
    String(value || '')
      .split(';')
      .map((segment) => segment.trim())
      .filter(Boolean)
      .map((segment) => {
        const [key, partValue = ''] = segment.split('=');
        return [String(key || '').trim().toUpperCase(), String(partValue || '').trim().toUpperCase()];
      })
  );

  switch (parts.FREQ) {
    case 'DAILY':
      return 'daily';
    case 'WEEKLY':
      return 'weekly';
    case 'MONTHLY':
      return 'monthly';
    default:
      return 'none';
  }
}

function mapRepeatToRrule(repeat) {
  switch (String(repeat || 'none').trim().toLowerCase()) {
    case 'daily':
      return 'FREQ=DAILY';
    case 'weekly':
      return 'FREQ=WEEKLY';
    case 'monthly':
      return 'FREQ=MONTHLY';
    default:
      return '';
  }
}

function normalizeBundle(bundle = {}) {
  const normalized = {
    version: String(bundle.version || ''),
    exportedAt: bundle.exportedAt || null,
    deviceId: bundle.deviceId || null,
    lastSequence: Number(bundle.lastSequence || 0),
    events: normalizeArray(bundle.events).map((event) => ({ ...event })),
    tags: normalizeArray(bundle.tags).map((tag) => ({ ...tag })),
    externalCalendarSources: normalizeArray(bundle.externalCalendarSources).map((source) => ({
      ...source,
    })),
    externalEventLinks: normalizeArray(bundle.externalEventLinks).map((link) => ({ ...link })),
  };

  if (normalized.version !== CALENDAR_BUNDLE_VERSION) {
    throw new Error('Unsupported calendar bundle version.');
  }

  return normalized;
}

function buildCalendarBundle({
  exportedAt,
  deviceId,
  lastSequence,
  events = [],
  tags = [],
  externalCalendarSources = [],
  externalEventLinks = [],
} = {}) {
  return {
    version: CALENDAR_BUNDLE_VERSION,
    exportedAt: exportedAt || new Date().toISOString(),
    deviceId: deviceId || null,
    lastSequence: Number(lastSequence || 0),
    events: normalizeArray(events).map((event) => ({ ...event })),
    tags: normalizeArray(tags).map((tag) => ({ ...tag })),
    externalCalendarSources: normalizeArray(externalCalendarSources).map((source) => ({
      ...source,
    })),
    externalEventLinks: normalizeArray(externalEventLinks).map((link) => ({ ...link })),
  };
}

function serializeCalendarBundle(bundle = {}) {
  return `${JSON.stringify(normalizeBundle(bundle), null, 2)}\n`;
}

function parseCalendarBundleText(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || ''));
  } catch (_error) {
    throw new Error('Calendar bundle must be valid JSON.');
  }

  return normalizeBundle(parsed);
}

function parseIcsText(text, options = {}) {
  const lines = unfoldIcsText(text).split(/\r?\n/g);
  const events = [];
  let current = null;

  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line) {
      continue;
    }

    if (line.toUpperCase() === 'BEGIN:VEVENT') {
      current = [];
      continue;
    }

    if (line.toUpperCase() === 'END:VEVENT') {
      if (current) {
        const event = mapIcsPropertiesToEvent(current, options);
        if (event) {
          events.push(event);
        }
      }
      current = null;
      continue;
    }

    if (current) {
      const parsedLine = parsePropertyLine(line);
      if (parsedLine) {
        current.push(parsedLine);
      }
    }
  }

  return events;
}

function mapIcsPropertiesToEvent(properties = [], options = {}) {
  const lookup = new Map();
  for (const property of properties) {
    if (!lookup.has(property.name)) {
      lookup.set(property.name, []);
    }
    lookup.get(property.name).push(property);
  }

  const getFirst = (name) => lookup.get(name)?.[0] || null;
  const getAll = (name) => lookup.get(name) || [];

  const summary = unescapeIcsText(getFirst('SUMMARY')?.value || '').trim();
  const description = unescapeIcsText(getFirst('DESCRIPTION')?.value || '');
  const location = unescapeIcsText(getFirst('LOCATION')?.value || '');
  const uid = getFirst('UID')?.value || createStableId('ics', JSON.stringify(properties));
  const dtStart = getFirst('DTSTART');
  const dtEnd = getFirst('DTEND');
  const rrule = getFirst('RRULE')?.value || '';
  const categories = unescapeIcsText(getFirst('CATEGORIES')?.value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (!dtStart) {
    return null;
  }

  const isAllDay =
    dtStart.params.VALUE === 'DATE' ||
    dtEnd?.params.VALUE === 'DATE' ||
    String(getFirst('X-MICROSOFT-CDO-ALLDAYEVENT')?.value || '').toUpperCase() === 'TRUE';
  const sourceTimeZone =
    dtStart.params.TZID || dtEnd?.params.TZID || options.defaultTimeZone || '';
  const startsAt = isAllDay
    ? parseCompactDate(dtStart.value)
    : parseCompactDateTime(dtStart.value);

  if (!startsAt) {
    return null;
  }

  let endsAt = null;
  if (dtEnd) {
    endsAt = isAllDay ? parseCompactDate(dtEnd.value) : parseCompactDateTime(dtEnd.value);
  }

  if (!endsAt) {
    endsAt = new Date(startsAt);
    endsAt.setUTCMinutes(endsAt.getUTCMinutes() + (isAllDay ? 24 * 60 : 60));
  }

  const attendees = getAll('ATTENDEE')
    .map((property) => property.value)
    .map((value) => String(value || '').replace(/^mailto:/i, '').trim())
    .filter(Boolean);

  const color = options.defaultColor || '#4f9d69';
  const tags = categories.map((label) => ({
    id: createStableId('tag', label.toLowerCase()),
    label,
    color,
  }));

  return {
    title: summary || 'Imported event',
    description,
    location,
    people: attendees,
    type: 'meeting',
    completed: false,
    repeat: mapRruleToRepeat(rrule),
    hasDeadline: false,
    groupName: '',
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    isAllDay,
    sourceTimeZone,
    reminderMinutesBeforeStart: null,
    desktopNotificationEnabled: false,
    emailNotificationEnabled: false,
    emailNotificationRecipients: [],
    notifications: [],
    color,
    tags,
    syncPolicy: options.defaultSyncPolicy || 'internal_only',
    visibility: options.defaultVisibility || 'private',
    externalProviderLinks: [
      {
        provider: 'ics',
        externalEventId: uid,
        url: '',
      },
    ],
  };
}

function serializeEventsToIcs(events = []) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Calendar App//EN',
    'CALSCALE:GREGORIAN',
  ];

  for (const event of normalizeArray(events)) {
    const startsAt = new Date(event.startsAt);
    const endsAt = new Date(event.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      continue;
    }

    const uid =
      event.externalProviderLinks?.find((link) => String(link.provider || '').toLowerCase() === 'ics')
        ?.externalEventId ||
      event.id ||
      createStableId('ics', `${event.title}:${event.startsAt}:${event.endsAt}`);

    lines.push('BEGIN:VEVENT');
    lines.push(foldIcsLine(`UID:${escapeIcsText(uid)}`));
    lines.push(foldIcsLine(`SUMMARY:${escapeIcsText(event.title || 'Untitled event')}`));

    if (event.description) {
      lines.push(foldIcsLine(`DESCRIPTION:${escapeIcsText(event.description)}`));
    }

    if (event.location) {
      lines.push(foldIcsLine(`LOCATION:${escapeIcsText(event.location)}`));
    }

    const categories = normalizeArray(event.tags)
      .map((tag) => String(tag?.label || '').trim())
      .filter(Boolean);
    if (categories.length > 0) {
      lines.push(foldIcsLine(`CATEGORIES:${escapeIcsText(categories.join(','))}`));
    }

    if (event.isAllDay) {
      lines.push(`DTSTART;VALUE=DATE:${formatDateOnlyUtc(startsAt)}`);
      lines.push(`DTEND;VALUE=DATE:${formatDateOnlyUtc(endsAt)}`);
    } else {
      lines.push(`DTSTART:${formatIcsDateTimeUtc(startsAt)}`);
      lines.push(`DTEND:${formatIcsDateTimeUtc(endsAt)}`);
    }

    const rrule = mapRepeatToRrule(event.repeat);
    if (rrule) {
      lines.push(`RRULE:${rrule}`);
    }

    for (const person of normalizeArray(event.people)) {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(String(person || '').trim())) {
        lines.push(foldIcsLine(`ATTENDEE:MAILTO:${escapeIcsText(String(person).trim())}`));
      }
    }

    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

module.exports = {
  CALENDAR_BUNDLE_VERSION,
  buildCalendarBundle,
  serializeCalendarBundle,
  parseCalendarBundleText,
  parseIcsText,
  serializeEventsToIcs,
  createStableId,
};
