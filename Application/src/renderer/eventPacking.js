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

export function getMonthEventCapacity({
  width = 0,
  height = 0,
  eventCount = 0,
  hasLaneLabel = false,
  minCardWidth = 126,
  minCardHeight = 34,
  gap = 5,
  labelHeight = 17,
} = {}) {
  const safeEventCount = Math.max(Number(eventCount) || 0, 0);
  if (safeEventCount === 0) {
    return {
      columns: 1,
      rows: 0,
      capacity: 0,
    };
  }

  const safeWidth = Math.max(Number(width) || 0, 0);
  const safeHeight = Math.max(Number(height) || 0, 0);
  const safeGap = Math.max(Number(gap) || 0, 0);
  const safeMinCardWidth = Math.max(Number(minCardWidth) || 1, 1);
  const safeMinCardHeight = Math.max(Number(minCardHeight) || 1, 1);
  const labelOffset = hasLaneLabel ? Math.max(Number(labelHeight) || 0, 0) + safeGap : 0;
  const usableHeight = Math.max(safeHeight - labelOffset, 0);

  if (safeWidth === 0 || usableHeight === 0) {
    return {
      columns: 1,
      rows: Math.min(safeEventCount, 6),
      capacity: Math.min(safeEventCount, 6),
    };
  }

  const columns = Math.max(
    1,
    Math.min(safeEventCount, Math.floor((safeWidth + safeGap) / (safeMinCardWidth + safeGap)))
  );
  const rows = Math.max(
    1,
    Math.floor((usableHeight + safeGap) / (safeMinCardHeight + safeGap))
  );

  return {
    columns,
    rows,
    capacity: Math.max(1, columns * rows),
  };
}

export function getMonthVisibleEventsBySpace(events = [], area = {}, options = {}) {
  const capacityResult = getMonthEventCapacity({
    ...options,
    ...area,
    eventCount: events.length,
  });
  const visibleEvents = (events || []).slice(0, capacityResult.capacity);

  return {
    ...capacityResult,
    visibleEvents,
    hiddenCount: Math.max((events || []).length - visibleEvents.length, 0),
  };
}

function getEventDayKey(event = {}) {
  const startsAt = new Date(event.startsAt);
  if (Number.isNaN(startsAt.getTime())) {
    return null;
  }

  const year = startsAt.getFullYear();
  const month = String(startsAt.getMonth() + 1).padStart(2, '0');
  const day = String(startsAt.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildSelectedMonthAgenda(events = [], selectedDate = new Date()) {
  const safeSelectedDate =
    selectedDate instanceof Date && !Number.isNaN(selectedDate.getTime())
      ? selectedDate
      : new Date();
  const selectedYear = safeSelectedDate.getFullYear();
  const selectedMonth = safeSelectedDate.getMonth();
  const groupsByKey = new Map();

  for (const event of events || []) {
    const startsAt = new Date(event.startsAt);
    if (
      Number.isNaN(startsAt.getTime()) ||
      startsAt.getFullYear() !== selectedYear ||
      startsAt.getMonth() !== selectedMonth
    ) {
      continue;
    }

    const dayKey = getEventDayKey(event);
    if (!dayKey) {
      continue;
    }

    if (!groupsByKey.has(dayKey)) {
      const dayDate = new Date(startsAt);
      dayDate.setHours(0, 0, 0, 0);
      groupsByKey.set(dayKey, {
        key: dayKey,
        date: dayDate,
        events: [],
      });
    }

    groupsByKey.get(dayKey).events.push(event);
  }

  return [...groupsByKey.values()]
    .sort((left, right) => left.date - right.date)
    .map((group) => ({
      ...group,
      events: group.events.sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt)),
    }));
}
