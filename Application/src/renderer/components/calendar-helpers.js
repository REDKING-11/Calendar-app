const BASE_WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getCurrentTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

export function getWeekStartDayIndex(timeZone = getCurrentTimeZone()) {
  return timeZone.startsWith('America/') ? 0 : 1;
}

export function getWeekdayLabels(timeZone = getCurrentTimeZone()) {
  const weekStartDayIndex = getWeekStartDayIndex(timeZone);

  return [
    ...BASE_WEEKDAY_LABELS.slice(weekStartDayIndex),
    ...BASE_WEEKDAY_LABELS.slice(0, weekStartDayIndex),
  ];
}

export function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function startOfCalendarGrid(date, timeZone = getCurrentTimeZone()) {
  const firstDayOfMonth = startOfMonth(date);
  const gridStart = new Date(firstDayOfMonth);
  const weekStartDay = getWeekStartDayIndex(timeZone);
  const offset = (firstDayOfMonth.getDay() - weekStartDay + 7) % 7;
  gridStart.setDate(firstDayOfMonth.getDate() - offset);
  return gridStart;
}

export function startOfWeek(date, timeZone = getCurrentTimeZone()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const weekStartDay = getWeekStartDayIndex(timeZone);
  const offset = (start.getDay() - weekStartDay + 7) % 7;
  start.setDate(start.getDate() - offset);
  return start;
}

export function endOfWeek(date, timeZone = getCurrentTimeZone()) {
  const nextDate = startOfWeek(date, timeZone);
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

export function isEventOnDate(event, date) {
  const eventDate = new Date(event.startsAt);
  return isSameDay(eventDate, date);
}

export function buildMonthTiles(viewDate, events, timeZone = getCurrentTimeZone()) {
  const monthStart = startOfMonth(viewDate);
  const gridStart = startOfCalendarGrid(viewDate, timeZone);

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
      events: events.filter((event) => isEventOnDate(event, date)).slice(0, 2),
    };
  });
}

export function buildWeekDays(selectedDate, events, timeZone = getCurrentTimeZone()) {
  const weekStart = startOfWeek(selectedDate, timeZone);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + index);

    return {
      key: date.toISOString(),
      date,
      label: date.toLocaleDateString('en-US', { weekday: 'short' }),
      events: events.filter((event) => isEventOnDate(event, date)),
      isToday: isSameDay(date, new Date()),
      isSelected: isSameDay(date, selectedDate),
    };
  });
}

export function buildYearMonths(viewDate, events, timeZone = getCurrentTimeZone()) {
  const year = viewDate.getFullYear();

  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(year, index, 1);
    const count = events.filter((event) => {
      const eventDate = new Date(event.startsAt);
      return (
        eventDate.getFullYear() === year &&
        eventDate.getMonth() === index
      );
    }).length;
    const gridStart = startOfCalendarGrid(date, timeZone);
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
