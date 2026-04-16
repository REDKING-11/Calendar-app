const path = require('node:path');

const EVENT_TYPES = new Set(['event', 'task', 'appointment']);
const REPEAT_OPTIONS = new Set(['none', 'daily', 'weekly', 'monthly']);
const SYNC_POLICIES = new Set([
  'internal_only',
  'google_sync',
  'microsoft_sync',
  'shared',
  'relay_sync',
]);
const VISIBILITY_OPTIONS = new Set(['private', 'busy_only', 'shared_read', 'shared_edit']);

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
    externalProviderLinks: normalizeExternalProviderLinks(input.externalProviderLinks),
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
  validateImportPath,
};
