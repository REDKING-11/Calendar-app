export function isExternalCalendarSourcePresent(snapshot = {}, sourceId = '') {
  if (!sourceId) {
    return false;
  }

  return (snapshot.externalCalendarSources || []).some(
    (source) => source?.sourceId === sourceId
  );
}

export function getExternalCalendarDeleteResultMessage({
  label = 'calendar',
  deletedEventCount = 0,
} = {}) {
  const safeCount = Math.max(Number(deletedEventCount) || 0, 0);
  return `Deleted imported calendar "${label}" and removed ${safeCount} imported event${
    safeCount === 1 ? '' : 's'
  }.`;
}
