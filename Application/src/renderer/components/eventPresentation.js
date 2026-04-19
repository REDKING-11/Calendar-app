import { formatTime } from '../formatting';
import { normalizeEventType, resolveDraftScope } from '../eventDraft';

export function isFocusEvent(eventOrType) {
  const type = typeof eventOrType === 'string' ? eventOrType : eventOrType?.type;
  return normalizeEventType(type) === 'focus';
}

export function getEventTypeLabel(type) {
  const normalized = normalizeEventType(type);
  if (normalized === 'focus') {
    return 'Focus';
  }
  if (normalized === 'personal') {
    return 'Personal';
  }
  return 'Meeting';
}

function formatPeopleSummary(people = []) {
  if (!Array.isArray(people) || people.length === 0) {
    return '';
  }

  return people.slice(0, 2).join(', ');
}

export function getEventContextLabel(event) {
  if (event.location?.trim()) {
    return event.location.trim();
  }

  const peopleSummary = formatPeopleSummary(event.people);
  if (peopleSummary) {
    return peopleSummary;
  }

  const scope = resolveDraftScope(event.syncPolicy, event.visibility);
  if (scope === 'work') {
    return 'Work';
  }
  if (scope === 'personal') {
    return 'Personal';
  }

  return getEventTypeLabel(event.type);
}

export function getEventTimeLabel(event, preferences) {
  return `${formatTime(event.startsAt, preferences)} - ${formatTime(event.endsAt, preferences)}`;
}
