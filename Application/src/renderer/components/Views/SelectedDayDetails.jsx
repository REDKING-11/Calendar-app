import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  getEventContextLabel,
  getEventTimeLabel,
  getEventTypeLabel,
  isFocusEvent,
} from '../eventPresentation';

function formatSelectedDate(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function getSummaryEvent(events, selectedDate) {
  if (!events.length) {
    return null;
  }

  const now = new Date();
  const isSelectedToday = selectedDate.toDateString() === now.toDateString();
  if (!isSelectedToday) {
    return events[0];
  }

  return events.find((event) => new Date(event.endsAt) >= now) || events[0];
}

export default function SelectedDayDetails({
  events = [],
  preferences,
  selectedDate,
  onEventClick,
  onEventDoubleClick,
  onEventKeyDown,
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const panelId = useId();
  const sortedEvents = useMemo(
    () =>
      [...events].sort(
        (left, right) => new Date(left.startsAt) - new Date(right.startsAt)
      ),
    [events]
  );
  const summaryEvent = getSummaryEvent(sortedEvents, selectedDate);
  const selectedDateLabel = formatSelectedDate(selectedDate);
  const eventCountLabel = `${sortedEvents.length} event${sortedEvents.length === 1 ? '' : 's'}`;

  useEffect(() => {
    setIsExpanded(false);
  }, [selectedDate]);

  return (
    <section className="day-detail-toggle" aria-label="Selected day details">
      <button
        type="button"
        className="day-detail-summary"
        aria-expanded={isExpanded}
        aria-controls={panelId}
        onClick={() => setIsExpanded((current) => !current)}
      >
        <div className="day-detail-summary-main">
          <span className="eyebrow">Selected day</span>
          <strong>{selectedDateLabel}</strong>
        </div>
        <div className="day-detail-summary-meta">
          <span>{eventCountLabel}</span>
          <span>
            {summaryEvent
              ? `${getEventTimeLabel(summaryEvent, preferences)} - ${summaryEvent.title}`
              : 'No events scheduled'}
          </span>
        </div>
        <span className="day-detail-summary-action">
          {isExpanded ? 'Hide details' : 'Show details'}
        </span>
      </button>

      {isExpanded ? (
        <div id={panelId} className="day-detail-panel">
          {sortedEvents.length > 0 ? (
            sortedEvents.map((event) => (
              <article key={event.id} className="day-detail-row-wrap">
                <button
                  type="button"
                  className={[
                    'day-detail-row',
                    isFocusEvent(event) ? 'day-detail-row--focus' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{ borderLeftColor: event.color || '#4f9d69' }}
                  onClick={(clickEvent) => onEventClick?.(event, clickEvent)}
                  onDoubleClick={() => onEventDoubleClick?.(event)}
                  onKeyDown={(keyboardEvent) => onEventKeyDown?.(keyboardEvent, event)}
                >
                  <span className="day-detail-time">{getEventTimeLabel(event, preferences)}</span>
                  <span className="day-detail-row-body">
                    <span className="day-detail-title">{event.title}</span>
                    <span className="day-detail-subtle">{getEventContextLabel(event)}</span>
                  </span>
                  <span className="day-detail-type">{getEventTypeLabel(event.type)}</span>
                </button>
              </article>
            ))
          ) : (
            <p className="day-detail-empty">
              No events scheduled for this day yet. Click any time slot above to add one.
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
