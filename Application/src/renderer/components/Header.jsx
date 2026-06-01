import React from 'react';

function getWeekStartDayIndex(weekStartsOn = 'monday') {
  if (weekStartsOn === 'sunday' || weekStartsOn === 0) {
    return 0;
  }
  if (weekStartsOn === 'monday' || weekStartsOn === 1) {
    return 1;
  }

  const numericValue = Number(weekStartsOn);
  return Number.isFinite(numericValue) ? numericValue : 1;
}

function startOfWeek(date, weekStartsOn = 'monday') {
  const nextDate = new Date(date);
  if (Number.isNaN(nextDate.getTime())) {
    return new Date();
  }

  const day = nextDate.getDay();
  const diff = (day - getWeekStartDayIndex(weekStartsOn) + 7) % 7;
  nextDate.setDate(nextDate.getDate() - diff);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
}

export function formatHeaderDateRange(selectedDate, calendarView, weekStartsOn) {
  const date = selectedDate instanceof Date ? selectedDate : new Date(selectedDate || Date.now());
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const monthDayFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  const monthYearFormatter = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

  if (calendarView === 'day') {
    return new Intl.DateTimeFormat(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(safeDate);
  }

  if (calendarView === 'week') {
    const weekStart = startOfWeek(safeDate, weekStartsOn);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    return `${monthDayFormatter.format(weekStart)} - ${monthDayFormatter.format(weekEnd)}, ${weekEnd.getFullYear()}`;
  }

  if (calendarView === 'year') {
    return String(safeDate.getFullYear());
  }

  return monthYearFormatter.format(safeDate);
}

export default function Header({
  regionRef,
  eventCount,
  calendarView,
  selectedDate,
  preferences,
  onToggleUpcoming,
  onOpenDebug,
  onOpenAbout,
  onOpenSettings,
  developerMode = false,
  timeZone,
}) {
  const dateRangeLabel = formatHeaderDateRange(
    selectedDate,
    calendarView,
    preferences?.weekStartsOn
  );
  const viewLabel = calendarView ? `${calendarView[0].toUpperCase()}${calendarView.slice(1)} view` : 'Calendar';

  return (
    <section ref={regionRef} className="flex w-full min-w-0 flex-col gap-3" aria-label="Header controls">
      <div className="app-toolbar app-toolbar--front">
        <div className="app-toolbar-context">
          <p className="app-toolbar-kicker">{viewLabel}</p>
          <h1 className="app-toolbar-title">{dateRangeLabel}</h1>
        </div>

        <div className="app-toolbar-actions">
          <span className="app-stat-pill">
            <strong>{eventCount}</strong>
            <span>events</span>
          </span>
          <span className="app-stat-pill app-stat-pill--muted">
            <span>{timeZone}</span>
          </span>
          <button
            type="button"
            onClick={onToggleUpcoming}
            data-keyboard-focus="app-header-primary"
            className="app-button app-button--secondary app-toolbar-button"
          >
            Upcoming
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="app-button app-button--primary app-toolbar-button"
          >
            Settings
          </button>
          {developerMode ? (
            <button
              type="button"
              onClick={onOpenDebug}
              className="app-button app-button--secondary app-toolbar-button"
            >
              Debug
            </button>
          ) : null}
          <button
            type="button"
            onClick={onOpenAbout}
            className="app-button app-button--secondary app-toolbar-button"
          >
            About
          </button>
        </div>
      </div>
    </section>
  );
}
