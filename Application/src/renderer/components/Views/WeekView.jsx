import React, { useMemo } from 'react';
import { buildWeekDays, startOfWeek } from '../calendar-helpers';
import CalendarViewHeader from './CalendarViewHeader';
import TodayScheduleControl from './TodayScheduleControl';

const HOUR_HEIGHT = 64;
const HOURS = Array.from({ length: 24 }, (_, index) => index);
const HOUR_LABELS = Array.from({ length: 25 }, (_, index) =>
  `${String(index).padStart(2, '0')}:00`
);
function formatTime(dateString) {
  return new Date(dateString).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatTypeLabel(type) {
  if (!type) {
    return 'Event';
  }

  return `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}

function formatEventHeading(event) {
  if (event.type === 'task') {
    return event.completed ? `${event.title} (done)` : event.title;
  }

  return event.title;
}

function formatWeekTitle(startDate, endDate) {
  if (startDate.getMonth() === endDate.getMonth()) {
    return `${startDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })}-${endDate.toLocaleDateString('en-US', {
      day: 'numeric',
      year: 'numeric',
    })}`;
  }

  return `${startDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })}-${endDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;
}

function getEventLayout(event) {
  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);
  const startMinutes = startsAt.getHours() * 60 + startsAt.getMinutes();
  const endMinutes = endsAt.getHours() * 60 + endsAt.getMinutes();
  const durationMinutes = Math.max(endMinutes - startMinutes, 30);

  return {
    top: (startMinutes / 60) * HOUR_HEIGHT,
    height: Math.max((durationMinutes / 60) * HOUR_HEIGHT, 28),
  };
}

export default function WeekView({
  events,
  selectedDate,
  onSelectDate,
  onCreateEvent,
  onSelectEvent,
  calendarView,
  onChangeView,
}) {
  const weekDays = useMemo(
    () => buildWeekDays(selectedDate, events),
    [selectedDate, events]
  );

  const selectedDay = weekDays.find((day) => day.isSelected) || weekDays[0];
  const weekTitle = formatWeekTitle(weekDays[0].date, weekDays[6].date);

  const goToPreviousWeek = () => {
    const nextDate = new Date(selectedDate);
    nextDate.setDate(nextDate.getDate() - 7);
    onSelectDate?.(startOfWeek(nextDate));
  };

  const goToNextWeek = () => {
    const nextDate = new Date(selectedDate);
    nextDate.setDate(nextDate.getDate() + 7);
    onSelectDate?.(startOfWeek(nextDate));
  };

  const goToToday = () => {
    onSelectDate?.(new Date());
  };

  return (
    <section className="calendar-card relative flex h-full min-h-0 flex-col overflow-hidden">
      <CalendarViewHeader
        eyebrow="Week view"
        title={weekTitle}
        titleTone="compact"
        calendarView={calendarView}
        onChangeView={onChangeView}
        onToday={goToToday}
        onPrevious={goToPreviousWeek}
        onNext={goToNextWeek}
        previousLabel="Previous week"
        nextLabel="Next week"
        onAddEvent={() => onCreateEvent?.(selectedDate)}
        secondaryAction={<TodayScheduleControl events={events} />}
      />

      <div className="week-timeline min-h-0 flex-1">
        <div className="week-timeline-header">
          <div className="week-time-corner" />
          {weekDays.map((day) => (
            <button
              key={day.key}
              type="button"
              className={[
                'week-header-day',
                day.isSelected ? 'week-header-day--selected' : '',
                day.isToday ? 'week-header-day--today' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelectDate?.(day.date)}
            >
              <p className="week-header-label">{day.label}</p>
              <p className="week-header-date">{day.date.getDate()}</p>
            </button>
          ))}
        </div>

        <div className="week-timeline-body">
          <div className="week-time-column">
            {HOUR_LABELS.map((label, index) => (
              <p
                key={label}
                className="week-time-label"
                style={{ top: `${index * HOUR_HEIGHT}px` }}
              >
                {label}
              </p>
            ))}
          </div>

          {weekDays.map((day) => (
            <div key={day.key} className="week-day-column">
              <div className="week-day-slots">
                {HOURS.map((hour) => (
                  <div
                    key={`${day.key}-${hour}`}
                    className="week-hour-slot"
                    onContextMenu={(event) => {
                      event.preventDefault();
                      const slotDate = new Date(day.date);
                      slotDate.setHours(hour, 0, 0, 0);
                      onSelectDate?.(day.date);
                      onCreateEvent?.(slotDate);
                    }}
                    title="Right-click to add an event here"
                  />
                ))}
              </div>

              <div className="week-event-layer">
                {day.events.map((event) => {
                  const layout = getEventLayout(event);

                  return (
                    <article
                      key={event.id}
                      className="week-event-block"
                      style={{
                        top: `${layout.top}px`,
                        height: `${layout.height}px`,
                        backgroundColor: event.color || '#4f9d69',
                      }}
                      onClick={() => onSelectEvent?.(event)}
                    >
                      <p className="week-event-title">{formatEventHeading(event)}</p>
                      <p className="week-event-time">
                        {event.type === 'task'
                          ? event.completed
                            ? 'Completed task'
                            : 'Open task'
                          : formatTypeLabel(event.type)}
                      </p>
                      <p className="week-event-time">
                        {formatTime(event.startsAt)} - {formatTime(event.endsAt)}
                      </p>
                      {event.tags?.length ? (
                        <div className="event-inline-tag-list">
                          {event.tags.slice(0, 2).map((tag) => (
                            <span
                              key={tag.id}
                              className="event-inline-tag"
                              style={{
                                backgroundColor: `${tag.color}22`,
                                borderColor: `${tag.color}55`,
                                color: tag.color,
                              }}
                            >
                              {tag.label}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="day-detail-card">
        <div className="day-detail-header">
          <div>
            <p className="eyebrow">Selected day</p>
            <h3>
              {selectedDay.date.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </h3>
          </div>
        </div>

        <div className="day-detail-list">
          {selectedDay.events.length > 0 ? (
            selectedDay.events.map((event) => (
              <article key={event.id} className="day-detail-item">
                <button
                  type="button"
                  className="day-detail-item-button"
                  onClick={() => onSelectEvent?.(event)}
                >
                <p className="day-detail-time">{formatTime(event.startsAt)}</p>
                <div>
                  <p className="day-detail-title">{formatEventHeading(event)}</p>
                  <p className="day-detail-subtle">
                    {event.type === 'task'
                      ? event.completed
                        ? 'Completed task'
                        : 'Open task'
                      : formatTypeLabel(event.type)}
                  </p>
                  {event.tags?.length ? (
                    <div className="event-inline-tag-list">
                      {event.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="event-inline-tag"
                          style={{
                            backgroundColor: `${tag.color}22`,
                            borderColor: `${tag.color}55`,
                            color: tag.color,
                          }}
                        >
                          {tag.label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <p className="day-detail-subtle">
                    Ends at {formatTime(event.endsAt)}
                  </p>
                </div>
                </button>
              </article>
            ))
          ) : (
            <p className="day-detail-empty">
              No events scheduled for this day yet. Right-click any time slot above to add one.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
