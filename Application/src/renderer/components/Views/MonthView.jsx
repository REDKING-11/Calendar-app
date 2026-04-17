import React, { useEffect, useState } from 'react';
import { buildMonthTiles, getWeekdayLabels } from '../calendar-helpers';
import CalendarViewHeader from './CalendarViewHeader';
import TodayScheduleControl from './TodayScheduleControl';
import { formatMonthYear } from '../../formatting';

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
  preferences,
  timeZone,
  onCreateEvent,
  selectedDate,
  onSelectDate,
  onSelectEvent,
  calendarView,
  onChangeView,
}) {
  const [viewDate, setViewDate] = useState(() => selectedDate || new Date());
  const tiles = buildMonthTiles(viewDate, events, timeZone, preferences?.weekStartsOn);
  const weekdayLabels = getWeekdayLabels(timeZone, preferences?.weekStartsOn);
  const monthTitle = formatMonthYear(viewDate);

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
    <section className="calendar-card relative flex h-full min-h-0 flex-col rounded-[28px] p-5">
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
        secondaryAction={<TodayScheduleControl events={events} preferences={preferences} />}
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
