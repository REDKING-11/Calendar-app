export const LOCAL_CALENDAR_GROUP = {
  id: 'local',
  sourceId: '',
  provider: 'local',
  label: 'Local calendar',
  color: '#64748b',
};

export function getEventCalendarSourceId(event = {}) {
  const links = Array.isArray(event.externalProviderLinks) ? event.externalProviderLinks : [];
  const sourceLink = links.find((link) => String(link?.sourceId || '').trim());
  return String(sourceLink?.sourceId || '').trim();
}

export function buildCalendarGroupMap(externalCalendarSources = []) {
  const groups = new Map([[LOCAL_CALENDAR_GROUP.id, LOCAL_CALENDAR_GROUP]]);

  for (const source of externalCalendarSources || []) {
    if (!source?.sourceId) {
      continue;
    }

    groups.set(source.sourceId, {
      id: source.sourceId,
      sourceId: source.sourceId,
      provider: source.provider || 'external',
      label: source.displayName || source.remoteCalendarId || 'Provider calendar',
      color: source.color || (source.provider === 'microsoft' ? '#4d8cf5' : '#4f9d69'),
      accountId: source.accountId || '',
      remoteCalendarId: source.remoteCalendarId || '',
    });
  }

  return groups;
}

export function getEventCalendarGroup(event = {}, calendarGroupMap = new Map()) {
  const sourceId = getEventCalendarSourceId(event);
  return calendarGroupMap.get(sourceId) || LOCAL_CALENDAR_GROUP;
}

export function groupEventsByCalendar(events = [], externalCalendarSources = []) {
  const calendarGroupMap = buildCalendarGroupMap(externalCalendarSources);
  const groups = [];
  const groupsById = new Map();

  for (const event of events || []) {
    const calendar = getEventCalendarGroup(event, calendarGroupMap);
    let group = groupsById.get(calendar.id);

    if (!group) {
      group = {
        ...calendar,
        events: [],
      };
      groupsById.set(calendar.id, group);
      groups.push(group);
    }

    group.events.push(event);
  }

  return groups;
}

export function shouldSplitCalendarGroups(groups = [], mode = 'auto') {
  if (mode === 'combined') {
    return false;
  }
  if (mode === 'split') {
    return groups.length > 1;
  }
  return groups.length > 1;
}
