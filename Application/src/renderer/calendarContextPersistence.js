export function shouldFallbackActiveCalendarContext({
  snapshotLoaded = false,
  activeCalendarContextId = 'local',
  externalCalendarSources = [],
}) {
  if (!snapshotLoaded || !activeCalendarContextId || activeCalendarContextId === 'local') {
    return false;
  }

  return !externalCalendarSources.some((source) => source.sourceId === activeCalendarContextId);
}
