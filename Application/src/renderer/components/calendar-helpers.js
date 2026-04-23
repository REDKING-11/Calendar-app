const BASE_WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getCurrentTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

export function getWeekStartDayIndex(timeZone = getCurrentTimeZone(), weekStartsOn = 'auto') {
  if (weekStartsOn === 'sunday') {
    return 0;
  }

  if (weekStartsOn === 'monday') {
    return 1;
  }

  return timeZone.startsWith('America/') ? 0 : 1;
}

export function getWeekdayLabels(timeZone = getCurrentTimeZone(), weekStartsOn = 'auto') {
  const weekStartDayIndex = getWeekStartDayIndex(timeZone, weekStartsOn);

  return [
    ...BASE_WEEKDAY_LABELS.slice(weekStartDayIndex),
    ...BASE_WEEKDAY_LABELS.slice(0, weekStartDayIndex),
  ];
}

export function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function startOfCalendarGrid(date, timeZone = getCurrentTimeZone(), weekStartsOn = 'auto') {
  const firstDayOfMonth = startOfMonth(date);
  const gridStart = new Date(firstDayOfMonth);
  const weekStartDay = getWeekStartDayIndex(timeZone, weekStartsOn);
  const offset = (firstDayOfMonth.getDay() - weekStartDay + 7) % 7;
  gridStart.setDate(firstDayOfMonth.getDate() - offset);
  return gridStart;
}

export function startOfWeek(date, timeZone = getCurrentTimeZone(), weekStartsOn = 'auto') {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const weekStartDay = getWeekStartDayIndex(timeZone, weekStartsOn);
  const offset = (start.getDay() - weekStartDay + 7) % 7;
  start.setDate(start.getDate() - offset);
  return start;
}

export function endOfWeek(date, timeZone = getCurrentTimeZone(), weekStartsOn = 'auto') {
  const nextDate = startOfWeek(date, timeZone, weekStartsOn);
  nextDate.setDate(nextDate.getDate() + 7);
  return nextDate;
}

export function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

export function isSameDay(left, right) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function getDateKey(date) {
  const dateValue = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(dateValue.getTime())) {
    return '';
  }

  return [
    dateValue.getFullYear(),
    String(dateValue.getMonth() + 1).padStart(2, '0'),
    String(dateValue.getDate()).padStart(2, '0'),
  ].join('-');
}

export function getMonthKey(date) {
  const dateValue = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(dateValue.getTime())) {
    return '';
  }

  return [
    dateValue.getFullYear(),
    String(dateValue.getMonth() + 1).padStart(2, '0'),
  ].join('-');
}

export function buildEventDateIndex(events = []) {
  const byDay = new Map();
  const byMonth = new Map();
  const byYear = new Map();
  const monthCounts = new Map();

  for (const event of events) {
    const startsAt = new Date(event.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
      continue;
    }

    const dayKey = getDateKey(startsAt);
    const monthKey = getMonthKey(startsAt);
    const yearKey = String(startsAt.getFullYear());

    if (!byDay.has(dayKey)) {
      byDay.set(dayKey, []);
    }
    if (!byMonth.has(monthKey)) {
      byMonth.set(monthKey, []);
    }
    if (!byYear.has(yearKey)) {
      byYear.set(yearKey, []);
    }

    byDay.get(dayKey).push(event);
    byMonth.get(monthKey).push(event);
    byYear.get(yearKey).push(event);
    monthCounts.set(monthKey, (monthCounts.get(monthKey) || 0) + 1);
  }

  return { byDay, byMonth, byYear, monthCounts };
}

export function isEventOnDate(event, date) {
  const eventDate = new Date(event.startsAt);
  return isSameDay(eventDate, date);
}

export function buildMonthTiles(
  viewDate,
  events,
  timeZone = getCurrentTimeZone(),
  weekStartsOn = 'auto',
  eventDateIndex = null
) {
  const monthStart = startOfMonth(viewDate);
  const gridStart = startOfCalendarGrid(viewDate, timeZone, weekStartsOn);

  return Array.from({ length: 35 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);

    return {
      key: date.toISOString(),
      date,
      dayNumber: date.getDate(),
      inCurrentMonth: date.getMonth() === monthStart.getMonth(),
      showMonthLabel: date.getDate() === 1,
      isToday: isSameDay(date, new Date()),
      events: (
        eventDateIndex?.byDay?.get(getDateKey(date)) ||
        events.filter((event) => isEventOnDate(event, date))
      ).slice(0, 2),
    };
  });
}

export function buildWeekDays(
  selectedDate,
  events,
  timeZone = getCurrentTimeZone(),
  weekStartsOn = 'auto',
  eventDateIndex = null
) {
  const weekStart = startOfWeek(selectedDate, timeZone, weekStartsOn);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);

    return {
      key: date.toISOString(),
      date,
      label: date.toLocaleDateString('en-US', { weekday: 'short' }),
      events: eventDateIndex?.byDay?.get(getDateKey(date)) || events.filter((event) => isEventOnDate(event, date)),
      isToday: isSameDay(date, new Date()),
      isSelected: isSameDay(date, selectedDate),
    };
  });
}

export function buildYearMonths(
  viewDate,
  events,
  timeZone = getCurrentTimeZone(),
  weekStartsOn = 'auto',
  eventDateIndex = null
) {
  const year = viewDate.getFullYear();

  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(year, index, 1);
    const count =
      eventDateIndex?.monthCounts?.get(getMonthKey(date)) ??
      events.filter((event) => {
        const eventDate = new Date(event.startsAt);
        return (
          eventDate.getFullYear() === year &&
          eventDate.getMonth() === index
        );
      }).length;
    const gridStart = startOfCalendarGrid(date, timeZone, weekStartsOn);
    const days = Array.from({ length: 42 }, (_, dayIndex) => {
      const dayDate = new Date(gridStart);
      dayDate.setDate(gridStart.getDate() + dayIndex);

      return {
        key: `${year}-${index}-${dayIndex}`,
        date: dayDate,
        dayNumber: dayDate.getDate(),
        inCurrentMonth: dayDate.getMonth() === index,
        isToday: isSameDay(dayDate, new Date()),
      };
    });

    return {
      key: `${year}-${index}`,
      date,
      monthLabel: date.toLocaleDateString('en-US', { month: 'long' }),
      count,
      days,
    };
  });
}
