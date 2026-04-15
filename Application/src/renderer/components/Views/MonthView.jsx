import React, { useEffect, useState } from 'react';
import { WEEKDAY_LABELS, buildMonthTiles } from '../calendar-helpers';
import CalendarViewHeader from './CalendarViewHeader';
import TodayScheduleControl from './TodayScheduleControl';

export default function MonthView({
  events,
  onCreateEvent,
  selectedDate,
  onSelectDate,
  calendarView,
  onChangeView,
}) {
  const [viewDate, setViewDate] = useState(() => selectedDate || new Date());
  const tiles = buildMonthTiles(viewDate, events);
  const monthTitle = viewDate.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const goToPreviousMonth = () => {
    setViewDate((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1));
  };

  const goToNextMonth = () => {
    setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1));
  };

  const goToToday = () => {
    setViewDate(new Date());
  };

  useEffect(() => {
    if (selectedDate) {
      setViewDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
    }
  }, [selectedDate]);

  return (
    <section className="calendar-card relative flex h-full min-h-0 flex-col rounded-[28px] border border-slate-900/8 bg-white/70 p-5 shadow-[0_24px_70px_rgba(36,52,89,0.12)] backdrop-blur-md">
      <CalendarViewHeader
        eyebrow="Month view"
        title={monthTitle}
        titleTone="compact"
        calendarView={calendarView}
        onChangeView={onChangeView}
        onToday={goToToday}
        onPrevious={goToPreviousMonth}
        onNext={goToNextMonth}
        previousLabel="Previous month"
        nextLabel="Next month"
        onAddEvent={() => onCreateEvent?.(selectedDate || viewDate)}
        secondaryAction={<TodayScheduleControl events={events} />}
      />

      <div className="calendar-weekdays" aria-hidden="true">
        {WEEKDAY_LABELS.map((label) => (
          <p key={label} className="calendar-weekday">
            {label}
          </p>
        ))}
      </div>

      <div className="calendar-grid flex-1" role="grid" aria-label={monthTitle}>
        {tiles.map((tile) => (
          <article
            key={tile.key}
            className={[
              'calendar-tile',
              tile.inCurrentMonth ? '' : 'calendar-tile--muted',
              tile.isToday ? 'calendar-tile--today' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <button
              type="button"
              className="calendar-tile-date-button"
              onClick={() => {
                onSelectDate?.(tile.date);
                onCreateEvent?.(tile.date);
              }}
            >
              <p className="calendar-tile-date">
                {tile.showMonthLabel
                  ? `${tile.date.toLocaleDateString('en-US', { month: 'short' })} ${tile.dayNumber}`
                  : tile.dayNumber}
              </p>
            </button>

            <div className="calendar-event-list">
              {tile.events.map((event) => (
                <p
                  key={event.id}
                  className="calendar-event-pill"
                  style={{ backgroundColor: event.color || '#4f9d69' }}
                >
                  {event.title}
                </p>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
