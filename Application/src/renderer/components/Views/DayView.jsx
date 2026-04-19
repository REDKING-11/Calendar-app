import React, { useEffect, useMemo, useRef, useState } from 'react';
import { isEventOnDate } from '../calendar-helpers';
import CalendarViewHeader from './CalendarViewHeader';
import TodayScheduleControl from './TodayScheduleControl';
import { getEventContextLabel, getEventTimeLabel, isFocusEvent } from '../eventPresentation';
import { createClickIntentRouter } from '../../clickIntent';

const ZOOM_LEVELS = [
  {
    id: '30m',
    label: '30 minutes',
    shortLabel: '30m',
    visibleRangeMinutes: 12 * 60,
    slotMinutes: 30,
    labelMinutes: 30,
    pixelsPerHour: 96,
  },
  {
    id: '15m',
    label: '15 minutes',
    shortLabel: '15m',
    visibleRangeMinutes: 8 * 60,
    slotMinutes: 15,
    labelMinutes: 15,
    pixelsPerHour: 132,
  },
  {
    id: '5m',
    label: '5 minutes',
    shortLabel: '5m',
    visibleRangeMinutes: 4 * 60,
    slotMinutes: 5,
    labelMinutes: 15,
    pixelsPerHour: 192,
  },
];
const DEFAULT_ZOOM_STATE = {
  centerMinutes: 12 * 60,
  zoomLevelIndex: 0,
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatMinutesLabel(totalMinutes) {
  const safeMinutes = clamp(Math.round(totalMinutes), 0, 24 * 60);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function getVisibleWindow(zoomState) {
  const zoomLevel = ZOOM_LEVELS[zoomState.zoomLevelIndex] || ZOOM_LEVELS[0];
  const halfRange = zoomLevel.visibleRangeMinutes / 2;
  let startMinutes = zoomState.centerMinutes - halfRange;
  let endMinutes = zoomState.centerMinutes + halfRange;

  if (startMinutes < 0) {
    endMinutes -= startMinutes;
    startMinutes = 0;
  }

  if (endMinutes > 24 * 60) {
    startMinutes -= endMinutes - 24 * 60;
    endMinutes = 24 * 60;
  }

  startMinutes = clamp(startMinutes, 0, 24 * 60 - zoomLevel.visibleRangeMinutes);
  endMinutes = startMinutes + zoomLevel.visibleRangeMinutes;

  return {
    startMinutes,
    endMinutes,
  };
}

function buildTimeLabels(windowState, pixelsPerHour, labelMinutes) {
  const labels = [];

  for (
    let currentMinutes = windowState.startMinutes;
    currentMinutes <= windowState.endMinutes;
    currentMinutes += labelMinutes
  ) {
    labels.push({
      key: `label-${currentMinutes}`,
      label: formatMinutesLabel(currentMinutes),
      top: ((currentMinutes - windowState.startMinutes) / 60) * pixelsPerHour,
    });
  }

  return labels;
}

function buildSlots(selectedDate, windowState, slotMinutes) {
  const slots = [];

  for (
    let currentMinutes = windowState.startMinutes;
    currentMinutes < windowState.endMinutes;
    currentMinutes += slotMinutes
  ) {
    const slotDate = new Date(selectedDate);
    slotDate.setHours(0, 0, 0, 0);
    slotDate.setMinutes(currentMinutes);

    slots.push({
      key: `slot-${currentMinutes}`,
      slotDate,
      minutes: currentMinutes,
      isSubtle: currentMinutes % 60 !== 0,
    });
  }

  return slots;
}

function getVisibleEventLayout(event, windowState, pixelsPerHour) {
  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);
  const eventStartMinutes = startsAt.getHours() * 60 + startsAt.getMinutes();
  const eventEndMinutes = endsAt.getHours() * 60 + endsAt.getMinutes();
  const clippedStart = Math.max(eventStartMinutes, windowState.startMinutes);
  const clippedEnd = Math.min(eventEndMinutes, windowState.endMinutes);
  const clippedDuration = clippedEnd - clippedStart;

  if (clippedDuration <= 0) {
    return null;
  }

  return {
    top: ((clippedStart - windowState.startMinutes) / 60) * pixelsPerHour,
    height: Math.max((clippedDuration / 60) * pixelsPerHour, 28),
  };
}

function getAnchorFromElement(element) {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.bottom,
  };
}

export default function DayView({
  events,
  preferences,
  selectedDate,
  onCreateEvent,
  onSelectEvent,
  calendarView,
  onChangeView,
  onSelectDate,
}) {
  const [zoomState, setZoomState] = useState(DEFAULT_ZOOM_STATE);
  const timelineBodyRef = useRef(null);
  const slotHandlersRef = useRef({ onSingle() {}, onDouble() {} });
  const eventHandlersRef = useRef({ onSingle() {}, onDouble() {} });
  const slotClickRouterRef = useRef(null);
  const eventClickRouterRef = useRef(null);

  const dayEvents = useMemo(
    () =>
      events
        .filter((event) => isEventOnDate(event, selectedDate))
        .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt)),
    [events, selectedDate]
  );

  const dayTitle = selectedDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const zoomConfig = ZOOM_LEVELS[zoomState.zoomLevelIndex] || ZOOM_LEVELS[0];
  const windowState = getVisibleWindow(zoomState);
  const timelineHeight =
    ((windowState.endMinutes - windowState.startMinutes) / 60) * zoomConfig.pixelsPerHour;
  const slotHeight = (zoomConfig.slotMinutes / 60) * zoomConfig.pixelsPerHour;

  const timeLabels = useMemo(
    () => buildTimeLabels(windowState, zoomConfig.pixelsPerHour, zoomConfig.labelMinutes),
    [windowState.startMinutes, windowState.endMinutes, zoomConfig.pixelsPerHour, zoomConfig.labelMinutes]
  );
  const slots = useMemo(
    () => buildSlots(selectedDate, windowState, zoomConfig.slotMinutes),
    [selectedDate, windowState.startMinutes, windowState.endMinutes, zoomConfig.slotMinutes]
  );
  const visibleDayEvents = useMemo(
    () =>
      dayEvents
        .map((event) => ({
          event,
          layout: getVisibleEventLayout(event, windowState, zoomConfig.pixelsPerHour),
        }))
        .filter((item) => item.layout),
    [dayEvents, windowState.startMinutes, windowState.endMinutes, zoomConfig.pixelsPerHour]
  );

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

  const getPointerMinutes = (event) => {
    const timelineElement = timelineBodyRef.current;

    if (!timelineElement) {
      return zoomState.centerMinutes;
    }

    const rect = timelineElement.getBoundingClientRect();
    const pointerY = clamp(event.clientY - rect.top + timelineElement.scrollTop, 0, timelineHeight);
    const ratio = timelineHeight === 0 ? 0 : pointerY / timelineHeight;

    return windowState.startMinutes + ratio * (windowState.endMinutes - windowState.startMinutes);
  };

  const handleTimelineWheel = (event) => {
    if (!event.ctrlKey) {
      return;
    }

    event.preventDefault();

    const pointerMinutes = getPointerMinutes(event);

    setZoomState((current) => {
      const direction = event.deltaY < 0 ? 1 : -1;
      const nextZoomLevelIndex = clamp(
        current.zoomLevelIndex + direction,
        0,
        ZOOM_LEVELS.length - 1
      );
      const currentLevel = ZOOM_LEVELS[current.zoomLevelIndex] || ZOOM_LEVELS[0];
      const nextLevel = ZOOM_LEVELS[nextZoomLevelIndex] || ZOOM_LEVELS[0];
      const currentWindow = getVisibleWindow(current);
      const ratio =
        currentLevel.visibleRangeMinutes === 0
          ? 0.5
          : (pointerMinutes - currentWindow.startMinutes) / currentLevel.visibleRangeMinutes;
      const unclampedStart = pointerMinutes - ratio * nextLevel.visibleRangeMinutes;
      const nextStart = clamp(unclampedStart, 0, 24 * 60 - nextLevel.visibleRangeMinutes);

      return {
        centerMinutes: nextStart + nextLevel.visibleRangeMinutes / 2,
        zoomLevelIndex: nextZoomLevelIndex,
      };
    });
  };

  const goToPreviousDay = () => {
    const nextDate = new Date(selectedDate);
    nextDate.setDate(nextDate.getDate() - 1);
    onSelectDate?.(nextDate);
  };

  const goToNextDay = () => {
    const nextDate = new Date(selectedDate);
    nextDate.setDate(nextDate.getDate() + 1);
    onSelectDate?.(nextDate);
  };

  const goToToday = () => {
    onSelectDate?.(new Date());
  };

  useEffect(() => {
    return () => {
      slotClickRouterRef.current?.cancelPending();
      eventClickRouterRef.current?.cancelPending();
    };
  }, []);

  return (
    <section className="calendar-card relative flex h-full min-h-0 flex-col overflow-hidden">
      <CalendarViewHeader
        eyebrow="Day view"
        title={dayTitle}
        titleTone="hero"
        calendarView={calendarView}
        onChangeView={onChangeView}
        onToday={goToToday}
        onPrevious={goToPreviousDay}
        onNext={goToNextDay}
        previousLabel="Previous day"
        nextLabel="Next day"
        onAddEvent={(event) =>
          onCreateEvent?.({
            date: selectedDate,
            anchorPoint: getAnchorFromElement(event.currentTarget),
          })
        }
        secondaryAction={<TodayScheduleControl events={events} preferences={preferences} />}
      />

      <div
        ref={timelineBodyRef}
        className="day-timeline min-h-0 flex-1"
        onWheel={handleTimelineWheel}
        title="Hold Ctrl and scroll to zoom around the hovered time"
      >
        <div className="day-timeline-body">
          <div className="day-time-column" style={{ height: `${timelineHeight}px` }}>
            {timeLabels.map((item) => (
              <p key={item.key} className="day-time-label" style={{ top: `${item.top}px` }}>
                {item.label}
              </p>
            ))}
          </div>

          <div className="day-column" style={{ height: `${timelineHeight}px` }}>
            <div
              className="day-slots"
              style={{
                height: `${timelineHeight}px`,
                gridTemplateRows: `repeat(${slots.length}, ${slotHeight}px)`,
              }}
            >
              {slots.map((slot) => (
                <button
                  key={slot.key}
                  type="button"
                  className={[
                    'day-slot',
                    slot.isSubtle ? 'day-slot--half-hour' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={(event) => {
                    slotClickRouterRef.current.handleSingle({
                      date: slot.slotDate,
                      anchorPoint: { x: event.clientX, y: event.clientY },
                    });
                  }}
                  onDoubleClick={() => {
                    slotClickRouterRef.current.handleDouble({
                      date: slot.slotDate,
                    });
                  }}
                  title={`Add an event at ${formatMinutesLabel(slot.minutes)}`}
                />
              ))}
            </div>

            <div className="day-event-layer">
              {visibleDayEvents.map(({ event, layout }) => (
                <article
                  key={event.id}
                  className={`day-event-block ${isFocusEvent(event) ? 'calendar-event-card--focus' : ''}`}
                  style={{
                    top: `${layout.top}px`,
                    height: `${layout.height}px`,
                    backgroundColor: event.color || '#4f9d69',
                  }}
                  onClick={(clickEvent) =>
                    eventClickRouterRef.current.handleSingle({
                      event,
                      anchorPoint: { x: clickEvent.clientX, y: clickEvent.clientY },
                    })
                  }
                  onDoubleClick={() =>
                    eventClickRouterRef.current.handleDouble({
                      event,
                    })
                  }
                >
                  <p className="calendar-event-card-title">{event.title}</p>
                  <p className="calendar-event-card-time">{getEventTimeLabel(event, preferences)}</p>
                  <p className="calendar-event-card-context">{getEventContextLabel(event)}</p>
                </article>
              ))}
            </div>
          </div>

          <aside className="day-zoom-sidebar" aria-label="Zoom level">
            <span className="day-zoom-sidebar-label">Zoom</span>
            <div className="day-zoom-control day-zoom-control--vertical">
              <div className="day-zoom-track day-zoom-track--vertical" aria-hidden="true">
                <div
                  className="day-zoom-progress day-zoom-progress--vertical"
                  style={{
                    height: `${((zoomState.zoomLevelIndex + 1) / ZOOM_LEVELS.length) * 100}%`,
                  }}
                />
              </div>
              <div className="day-zoom-stops day-zoom-stops--vertical">
                {ZOOM_LEVELS
                  .map((level, index) => ({ level, index }))
                  .reverse()
                  .map(({ level, index }) => (
                    <button
                      key={level.id}
                      type="button"
                      className={`day-zoom-stop day-zoom-stop--vertical ${
                        zoomState.zoomLevelIndex === index ? 'day-zoom-stop--active' : ''
                      }`}
                      onClick={() =>
                        setZoomState((current) => ({
                          ...current,
                          zoomLevelIndex: index,
                        }))
                      }
                    >
                      {level.shortLabel}
                    </button>
                  ))}
              </div>
            </div>
          </aside>
        </div>
      </div>

      <div className="day-detail-card">
        <div className="day-detail-header">
          <div>
            <p className="eyebrow">Selected day</p>
            <h3>
              {selectedDate.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </h3>
          </div>
        </div>

        <div className="day-detail-list">
          {dayEvents.length > 0 ? (
            dayEvents.map((event) => (
              <article key={event.id} className="day-detail-item">
                <button
                  type="button"
                  className="day-detail-item-button"
                  onClick={(clickEvent) =>
                    eventClickRouterRef.current.handleSingle({
                      event,
                      anchorPoint: { x: clickEvent.clientX, y: clickEvent.clientY },
                    })
                  }
                  onDoubleClick={() =>
                    eventClickRouterRef.current.handleDouble({
                      event,
                    })
                  }
                >
                  <p className="day-detail-time">{getEventTimeLabel(event, preferences)}</p>
                  <div>
                    <p className="day-detail-title">{event.title}</p>
                    <p className="day-detail-subtle">{getEventContextLabel(event)}</p>
                  </div>
                </button>
              </article>
            ))
          ) : (
            <p className="day-detail-empty">
              No events scheduled for this day yet. Click any time slot above to add one.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
