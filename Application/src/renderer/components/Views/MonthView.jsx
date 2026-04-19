import React, { useEffect, useRef, useState } from 'react';
import { buildMonthTiles, getWeekdayLabels } from '../calendar-helpers';
import CalendarViewHeader from './CalendarViewHeader';
import TodayScheduleControl from './TodayScheduleControl';
import { formatMonthYear } from '../../formatting';
import { getEventContextLabel, getEventTimeLabel, isFocusEvent } from '../eventPresentation';
import { createClickIntentRouter } from '../../clickIntent';

function getAnchorFromElement(element) {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.bottom,
  };
}

function getAnchorFromPointerEvent(event) {
  return {
    x: event.clientX,
    y: event.clientY,
  };
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
  const slotHandlersRef = useRef({ onSingle() {}, onDouble() {} });
  const eventHandlersRef = useRef({ onSingle() {}, onDouble() {} });
  const slotClickRouterRef = useRef(null);
  const eventClickRouterRef = useRef(null);
  const tiles = buildMonthTiles(viewDate, events, timeZone, preferences?.weekStartsOn);
  const weekdayLabels = getWeekdayLabels(timeZone, preferences?.weekStartsOn);
  const monthTitle = formatMonthYear(viewDate);

  slotHandlersRef.current.onSingle = ({ date, anchorPoint }) => {
    onSelectDate?.(date);
    onCreateEvent?.({ date, anchorPoint });
  };
  slotHandlersRef.current.onDouble = ({ date }) => {
    onSelectDate?.(date);
    onCreateEvent?.({ date, openInDrawer: true });
  };
  eventHandlersRef.current.onSingle = ({ event, anchorPoint }) => {
    onSelectEvent?.({ event, anchorPoint });
  };
  eventHandlersRef.current.onDouble = ({ event }) => {
    onSelectEvent?.({ event, openInDrawer: true });
  };

  if (!slotClickRouterRef.current) {
    slotClickRouterRef.current = createClickIntentRouter({
      onSingle: (payload) => slotHandlersRef.current.onSingle(payload),
      onDouble: (payload) => slotHandlersRef.current.onDouble(payload),
    });
  }

  if (!eventClickRouterRef.current) {
    eventClickRouterRef.current = createClickIntentRouter({
      onSingle: (payload) => eventHandlersRef.current.onSingle(payload),
      onDouble: (payload) => eventHandlersRef.current.onDouble(payload),
    });
  }

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

  useEffect(() => {
    return () => {
      slotClickRouterRef.current?.cancelPending();
      eventClickRouterRef.current?.cancelPending();
    };
  }, []);

  return (
    <section className="calendar-card calendar-card--month relative flex h-full min-h-0 flex-col rounded-[28px] p-5">
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
        onAddEvent={(event) =>
          onCreateEvent?.({
            date: selectedDate || viewDate,
            anchorPoint: getAnchorFromElement(event.currentTarget),
          })
        }
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
            role="gridcell"
            onClick={(event) => {
              slotClickRouterRef.current.handleSingle({
                date: tile.date,
                anchorPoint: getAnchorFromPointerEvent(event),
              });
            }}
            onDoubleClick={() => {
              slotClickRouterRef.current.handleDouble({
                date: tile.date,
              });
            }}
          >
            <button
              type="button"
              className="calendar-tile-date-button"
              onClick={(event) => {
                event.stopPropagation();
                slotClickRouterRef.current.handleSingle({
                  date: tile.date,
                  anchorPoint: getAnchorFromPointerEvent(event),
                });
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                slotClickRouterRef.current.handleDouble({
                  date: tile.date,
                });
              }}
              aria-label={`Create or edit events for ${tile.date.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}`}
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
                  className={`calendar-event-pill ${isFocusEvent(event) ? 'calendar-event-card--focus' : ''}`}
                  style={{ backgroundColor: event.color || '#4f9d69' }}
                  onClick={(clickEvent) => {
                    clickEvent.stopPropagation();
                    eventClickRouterRef.current.handleSingle({
                      event,
                      anchorPoint: getAnchorFromPointerEvent(clickEvent),
                    });
                  }}
                  onDoubleClick={(clickEvent) => {
                    clickEvent.stopPropagation();
                    eventClickRouterRef.current.handleDouble({
                      event,
                    });
                  }}
                >
                  <span className="calendar-event-card-title">{event.title}</span>
                  <span className="calendar-event-card-time">{getEventTimeLabel(event, preferences)}</span>
                  <span className="calendar-event-card-context">{getEventContextLabel(event)}</span>
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
