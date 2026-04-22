import React, { useEffect, useRef, useState } from 'react';
import { buildMonthTiles, getWeekdayLabels } from '../calendar-helpers';
import CalendarViewHeader from './CalendarViewHeader';
import TodayScheduleControl from './TodayScheduleControl';
import { formatMonthYear } from '../../formatting';
import { getEventContextLabel, getEventTimeLabel, isFocusEvent } from '../eventPresentation';
import { createClickIntentRouter } from '../../clickIntent';
import { getGridNavigationIndex, isGridNavigationKey } from '../../keyboardNavigation';

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

function getPreferredMonthTileKey(tiles, selectedDate) {
  return (
    tiles.find((tile) => selectedDate && tile.date.toDateString() === selectedDate.toDateString())?.key ||
    tiles.find((tile) => tile.isToday)?.key ||
    tiles[0]?.key ||
    ''
  );
}

function focusMonthDateButton(sourceElement, tileIndex) {
  const gridElement = sourceElement.closest('[data-calendar-grid="month"]');
  const nextButton = gridElement?.querySelector(`[data-month-date-index="${tileIndex}"]`);
  window.requestAnimationFrame(() => nextButton?.focus({ preventScroll: true }));
}

export default function MonthView({
  headerRef,
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
  const [focusedDateKey, setFocusedDateKey] = useState('');
  const slotHandlersRef = useRef({ onSingle() {}, onDouble() {} });
  const eventHandlersRef = useRef({ onSingle() {}, onDouble() {} });
  const slotClickRouterRef = useRef(null);
  const eventClickRouterRef = useRef(null);
  const tiles = buildMonthTiles(viewDate, events, timeZone, preferences?.weekStartsOn);
  const weekdayLabels = getWeekdayLabels(timeZone, preferences?.weekStartsOn);
  const monthTitle = formatMonthYear(viewDate);
  const preferredDateKey = getPreferredMonthTileKey(tiles, selectedDate);
  const activeDateKey = focusedDateKey || preferredDateKey;

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
    setFocusedDateKey(getPreferredMonthTileKey(tiles, selectedDate));
  }, [selectedDate, viewDate]);

  useEffect(() => {
    return () => {
      slotClickRouterRef.current?.cancelPending();
      eventClickRouterRef.current?.cancelPending();
    };
  }, []);

  return (
    <section className="calendar-card calendar-card--month relative flex h-full min-h-0 flex-col rounded-[28px] p-5">
      <CalendarViewHeader
        headerRef={headerRef}
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
        secondaryAction={<TodayScheduleControl events={events} preferences={preferences} />}
      />

      <div className="calendar-weekdays" aria-hidden="true">
        {weekdayLabels.map((label) => (
          <p key={label} className="calendar-weekday">
            {label}
          </p>
        ))}
      </div>

      <div className="calendar-grid flex-1" role="grid" aria-label={monthTitle} data-calendar-grid="month">
        {tiles.map((tile, tileIndex) => (
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
              tabIndex={tile.key === activeDateKey ? 0 : -1}
              data-month-date-index={tileIndex}
              data-calendar-focus={
                tile.key === preferredDateKey ? 'active' : tile.isToday ? 'today' : tileIndex === 0 ? 'first' : undefined
              }
              onFocus={() => setFocusedDateKey(tile.key)}
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
              onKeyDown={(keyboardEvent) => {
                if (isGridNavigationKey(keyboardEvent.key)) {
                  keyboardEvent.preventDefault();
                  const nextIndex = getGridNavigationIndex({
                    currentIndex: tileIndex,
                    itemCount: tiles.length,
                    columnCount: 7,
                    key: keyboardEvent.key,
                  });
                  const nextTile = tiles[nextIndex];
                  if (nextTile) {
                    setFocusedDateKey(nextTile.key);
                    focusMonthDateButton(keyboardEvent.currentTarget, nextIndex);
                  }
                  return;
                }

                if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
                  keyboardEvent.preventDefault();
                  const payload = {
                    date: tile.date,
                    anchorPoint: getAnchorFromElement(keyboardEvent.currentTarget),
                  };
                  if (keyboardEvent.ctrlKey || keyboardEvent.shiftKey) {
                    slotHandlersRef.current.onDouble(payload);
                  } else {
                    slotHandlersRef.current.onSingle(payload);
                  }
                }
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
                  className={[
                    'calendar-event-pill',
                    tile.events.length > 1 ? 'calendar-event-pill--compact' : '',
                    isFocusEvent(event) ? 'calendar-event-card--focus' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
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
                  onKeyDown={(keyboardEvent) => {
                    if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') {
                      return;
                    }

                    keyboardEvent.preventDefault();
                    keyboardEvent.stopPropagation();
                    const payload = {
                      event,
                      anchorPoint: getAnchorFromElement(keyboardEvent.currentTarget),
                    };
                    if (keyboardEvent.ctrlKey || keyboardEvent.shiftKey) {
                      eventHandlersRef.current.onDouble(payload);
                    } else {
                      eventHandlersRef.current.onSingle(payload);
                    }
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
