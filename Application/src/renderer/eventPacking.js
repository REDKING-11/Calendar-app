function getEventMinutes(event = {}) {
  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);
  const startMinutes = startsAt.getHours() * 60 + startsAt.getMinutes();
  const rawEndMinutes = event.isAllDay
    ? 24 * 60
    : endsAt.getHours() * 60 + endsAt.getMinutes();
  const endMinutes = Math.max(rawEndMinutes, startMinutes + 1);

  return {
    startMinutes,
    endMinutes,
  };
}

function eventsOverlap(left = {}, right = {}) {
  return left.startMinutes < right.endMinutes && right.startMinutes < left.endMinutes;
}

function assignClusterColumns(cluster = []) {
  const activeColumns = [];
  let maxColumnCount = 1;
  const packed = [];

  for (const item of cluster) {
    for (let index = activeColumns.length - 1; index >= 0; index -= 1) {
      if (activeColumns[index]?.endMinutes <= item.startMinutes) {
        activeColumns[index] = null;
      }
    }

    let columnIndex = activeColumns.findIndex((activeItem) => !activeItem);
    if (columnIndex === -1) {
      columnIndex = activeColumns.length;
    }

    activeColumns[columnIndex] = item;
    maxColumnCount = Math.max(
      maxColumnCount,
      activeColumns.filter(Boolean).length,
      columnIndex + 1
    );
    packed.push({
      ...item,
      columnIndex,
    });
  }

  return packed.map((item) => ({
    ...item,
    columnCount: maxColumnCount,
  }));
}

export function packTimedEvents(events = []) {
  const sortedItems = (events || [])
    .map((event, index) => ({
      event,
      index,
      ...getEventMinutes(event),
    }))
    .sort((left, right) => {
      if (left.startMinutes !== right.startMinutes) {
        return left.startMinutes - right.startMinutes;
      }
      if (left.endMinutes !== right.endMinutes) {
        return right.endMinutes - left.endMinutes;
      }
      return left.index - right.index;
    });

  const packedItems = [];
  let cluster = [];
  let clusterEnd = -1;

  const flushCluster = () => {
    if (cluster.length === 0) {
      return;
    }
    packedItems.push(...assignClusterColumns(cluster));
    cluster = [];
    clusterEnd = -1;
  };

  for (const item of sortedItems) {
    if (cluster.length === 0 || item.startMinutes < clusterEnd) {
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.endMinutes);
      continue;
    }

    flushCluster();
    cluster.push(item);
    clusterEnd = item.endMinutes;
  }

  flushCluster();

  return packedItems
    .sort((left, right) => left.index - right.index)
    .map(({ event, columnIndex, columnCount }) => ({
      event,
      columnIndex,
      columnCount,
    }));
}

export function buildPackedEventMap(events = []) {
  return new Map(
    packTimedEvents(events).map((item) => [
      item.event.id,
      {
        columnIndex: item.columnIndex,
        columnCount: item.columnCount,
      },
    ])
  );
}

export function getPackedEventStyle(packed = {}, gutterPixels = 8) {
  const columnCount = Math.max(Number(packed.columnCount) || 1, 1);
  const columnIndex = Math.max(Number(packed.columnIndex) || 0, 0);

  if (columnCount <= 1) {
    return {
      left: '',
      width: '',
      right: '',
    };
  }

  const width = 100 / columnCount;
  const gutter = Math.max(Number(gutterPixels) || 0, 0);
  const halfGutter = gutter / 2;
  const leftInset = columnIndex === 0 ? 0 : halfGutter;
  const rightInset = columnIndex === columnCount - 1 ? 0 : halfGutter;

  return {
    left: `calc(${columnIndex * width}% + ${leftInset}px)`,
    width: `calc(${width}% - ${leftInset + rightInset}px)`,
    right: 'auto',
  };
}

export function getMonthVisibleEvents(events = [], maxVisible = 6) {
  const safeMaxVisible = Math.max(Number(maxVisible) || 0, 0);
  const visibleEvents = (events || []).slice(0, safeMaxVisible);

  return {
    visibleEvents,
    hiddenCount: Math.max((events || []).length - visibleEvents.length, 0),
  };
}
