import React, { useEffect, useState } from 'react';
import { buildMonthTiles, getWeekdayLabels } from '../calendar-helpers';
import CalendarViewHeader from './CalendarViewHeader';
import TodayScheduleControl from './TodayScheduleControl';

function formatEventPreview(event) {
  const firstTag = event.tags?.[0]?.label;
  const typePrefix =
    event.type === 'task'
      ? event.completed
        ? 'Done: '
        : 'Task: '
      : event.type === 'appointment'
        ? 'Appointment: '
        : '';
  const titleBase = event.completed ? `${event.title} (done)` : event.title;
  const title = firstTag ? `${firstTag}: ${titleBase}` : titleBase;
  return `${typePrefix}${title}`;
}

export default function MonthView({
  events,
  timeZone,
  onCreateEvent,
  selectedDate,
  onSelectDate,
  onSelectEvent,
  calendarView,
  onChangeView,
}) {
  const [viewDate, setViewDate] = useState(() => selectedDate || new Date());
  const tiles = buildMonthTiles(viewDate, events, timeZone);
  const weekdayLabels = getWeekdayLabels(timeZone);
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

  const handleTileClick = (date) => {
    onSelectDate?.(date);
    onCreateEvent?.(date);
  };

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
        {weekdayLabels.map((label) => (
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
            onClick={() => handleTileClick(tile.date)}
          >
            <button
              type="button"
              className="calendar-tile-date-button"
              onClick={(event) => {
                event.stopPropagation();
                handleTileClick(tile.date);
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
                <button
                  key={event.id}
                  type="button"
                  className="calendar-event-pill"
                  style={{ backgroundColor: event.color || '#4f9d69' }}
                  onClick={(clickEvent) => {
                    clickEvent.stopPropagation();
                    onSelectEvent?.(event);
                  }}
                >
                  {formatEventPreview(event)}
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
