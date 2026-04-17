export function formatDate(date, options, locale = undefined) {
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export function formatDateTime(value, preferences, options = {}) {
  if (!value) {
    return '';
  }

  const date = value instanceof Date ? value : new Date(value);
  const locale = typeof navigator !== 'undefined' ? navigator.language : undefined;

  return new Intl.DateTimeFormat(locale, {
    hour12: preferences?.timeFormat === '12h',
    ...options,
  }).format(date);
}

export function formatTime(value, preferences) {
  return formatDateTime(value, preferences, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatMonthYear(value) {
  const date = value instanceof Date ? value : new Date(value);
  return formatDate(date, {
    month: 'long',
    year: 'numeric',
  });
}
