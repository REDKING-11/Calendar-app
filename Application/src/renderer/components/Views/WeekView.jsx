import React, { useEffect, useMemo, useRef } from 'react';
import { buildWeekDays, startOfWeek } from '../calendar-helpers';
import CalendarViewHeader from './CalendarViewHeader';
import SelectedDayDetails from './SelectedDayDetails';
import TodayScheduleControl from './TodayScheduleControl';
import { getEventContextLabel, getEventTimeLabel, isFocusEvent } from '../eventPresentation';
import { createClickIntentRouter } from '../../clickIntent';
import { getGridNavigationIndex, isGridNavigationKey } from '../../keyboardNavigation';

const HOUR_HEIGHT = 64;
const HOURS = Array.from({ length: 24 }, (_, index) => index);
const HOUR_LABELS = Array.from({ length: 25 }, (_, index) =>
  `${String(index).padStart(2, '0')}:00`
);

function formatWeekTitle(startDate, endDate) {
  const startMonth = startDate.toLocaleDateString('en-US', { month: 'short' });
  const endMonth = endDate.toLocaleDateString('en-US', { month: 'short' });
  const startDay = startDate.getDate();
  const endDay = endDate.getDate();
  const endYear = endDate.getFullYear();

  if (startDate.getMonth() === endDate.getMonth()) {
    return `${startMonth} ${startDay}-${endDay}, ${endYear}`;
  }

  return `${startMonth} ${startDay}-${endMonth} ${endDay}, ${endYear}`;
}

function getEventLayout(event) {
  const startsAt = new Date(event.startsAt);
  const endsAt = new Date(event.endsAt);
  const startMinutes = startsAt.getHours() * 60 + startsAt.getMinutes();
  const endMinutes = endsAt.getHours() * 60 + endsAt.getMinutes();
  const durationMinutes = Math.max(endMinutes - startMinutes, 30);

  return {
    top: (startMinutes / 60) * HOUR_HEIGHT,
    height: Math.max((durationMinutes / 60) * HOUR_HEIGHT, 32),
  };
}

function getAnchorFromElement(element) {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.bottom,
  };
}

function focusWeekTarget(sourceElement, selector) {
  const calendarElement = sourceElement.closest('[data-calendar-grid="week"]');
  const nextElement = calendarElement?.querySelector(selector);
  window.requestAnimationFrame(() => nextElement?.focus({ preventScroll: true }));
}

export default function WeekView({
  headerRef,
  events,
  eventDateIndex,
  todayEvents,
  preferences,
  timeZone,
  selectedDate,
  onSelectDate,
  onCreateEvent,
  onSelectEvent,
  calendarView,
  onChangeView,
}) {
  const slotHandlersRef = useRef({ onSingle() {}, onDouble() {} });
  const eventHandlersRef = useRef({ onSingle() {}, onDouble() {} });
  const slotClickRouterRef = useRef(null);
  const eventClickRouterRef = useRef(null);
  const weekDays = useMemo(
    () => buildWeekDays(selectedDate, events, timeZone, preferences?.weekStartsOn, eventDateIndex),
    [selectedDate, events, timeZone, preferences?.weekStartsOn, eventDateIndex]
  );

  const selectedDay = weekDays.find((day) => day.isSelected) || weekDays[0];
  const weekTitle = formatWeekTitle(weekDays[0].date, weekDays[6].date);

  slotHandlersRef.current.onSingle = ({ date, anchorPoint, selectedDayDate }) => {
    onSelectDate?.(selectedDayDate || date);
    onCreateEvent?.({ date, anchorPoint });
  };
  slotHandlersRef.current.onDouble = ({ date, selectedDayDate }) => {
    onSelectDate?.(selectedDayDate || date);
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

  const goToPreviousWeek = () => {
    const nextDate = new Date(selectedDate);
    nextDate.setDate(nextDate.getDate() - 7);
    onSelectDate?.(startOfWeek(nextDate, timeZone, preferences?.weekStartsOn));
  };

  const goToNextWeek = () => {
    const nextDate = new Date(selectedDate);
    nextDate.setDate(nextDate.getDate() + 7);
    onSelectDate?.(startOfWeek(nextDate, timeZone, preferences?.weekStartsOn));
  };

  const goToToday = () => {
    onSelectDate?.(new Date());
  };

  const openSlotFromKeyboard = (keyboardEvent, day, hour, openInDrawer = false) => {
    const slotDate = new Date(day.date);
    slotDate.setHours(hour, 0, 0, 0);
    const payload = {
      date: slotDate,
      anchorPoint: getAnchorFromElement(keyboardEvent.currentTarget),
      selectedDayDate: day.date,
    };

    if (openInDrawer) {
      slotHandlersRef.current.onDouble(payload);
    } else {
      slotHandlersRef.current.onSingle(payload);
    }
  };

  const handleEventKeyboardOpen = (keyboardEvent, event) => {
    if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') {
      return;
    }

    keyboardEvent.preventDefault();
    const payload = {
      event,
      anchorPoint: getAnchorFromElement(keyboardEvent.currentTarget),
    };

    if (keyboardEvent.ctrlKey || keyboardEvent.shiftKey) {
      eventHandlersRef.current.onDouble(payload);
    } else {
      eventHandlersRef.current.onSingle(payload);
    }
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
        headerRef={headerRef}
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
        secondaryAction={
          <TodayScheduleControl events={events} todayEvents={todayEvents} preferences={preferences} />
        }
      />

      <div className="week-timeline min-h-0 flex-1" data-calendar-grid="week">
        <div className="week-timeline-header">
          <div className="week-time-corner" />
          {weekDays.map((day, dayIndex) => (
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
              data-week-day-index={dayIndex}
              data-calendar-focus={day.isSelected ? 'active' : day.isToday ? 'today' : dayIndex === 0 ? 'first' : undefined}
              onKeyDown={(keyboardEvent) => {
                if (!isGridNavigationKey(keyboardEvent.key)) {
                  return;
                }

                keyboardEvent.preventDefault();
                const nextIndex = getGridNavigationIndex({
                  currentIndex: dayIndex,
                  itemCount: weekDays.length,
                  columnCount: weekDays.length,
                  key: keyboardEvent.key,
                });
                focusWeekTarget(keyboardEvent.currentTarget, `[data-week-day-index="${nextIndex}"]`);
              }}
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

          {weekDays.map((day, dayIndex) => (
            <div key={day.key} className="week-day-column">
              <div className="week-day-slots">
                {HOURS.map((hour, hourIndex) => {
                  const slotIndex = hourIndex * weekDays.length + dayIndex;

                  return (
                    <button
                      key={`${day.key}-${hour}`}
                      type="button"
                      className="week-hour-slot"
                      data-week-slot-index={slotIndex}
                      onClick={(event) => {
                        const slotDate = new Date(day.date);
                        slotDate.setHours(hour, 0, 0, 0);
                        slotClickRouterRef.current.handleSingle({
                          date: slotDate,
                          anchorPoint: { x: event.clientX, y: event.clientY },
                          selectedDayDate: day.date,
                        });
                      }}
                      onDoubleClick={() => {
                        const slotDate = new Date(day.date);
                        slotDate.setHours(hour, 0, 0, 0);
                        slotClickRouterRef.current.handleDouble({
                          date: slotDate,
                          selectedDayDate: day.date,
                        });
                      }}
                      onKeyDown={(keyboardEvent) => {
                        if (isGridNavigationKey(keyboardEvent.key)) {
                          keyboardEvent.preventDefault();
                          const nextIndex = getGridNavigationIndex({
                            currentIndex: slotIndex,
                            itemCount: HOURS.length * weekDays.length,
                            columnCount: weekDays.length,
                            key: keyboardEvent.key,
                          });
                          focusWeekTarget(keyboardEvent.currentTarget, `[data-week-slot-index="${nextIndex}"]`);
                          return;
                        }

                        if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
                          keyboardEvent.preventDefault();
                          openSlotFromKeyboard(
                            keyboardEvent,
                            day,
                            hour,
                            keyboardEvent.ctrlKey || keyboardEvent.shiftKey
                          );
                        }
                      }}
                      aria-label={`Add an event on ${day.date.toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'long',
                        day: 'numeric',
                      })} at ${String(hour).padStart(2, '0')}:00`}
                      title="Add an event here"
                    />
                  );
                })}
              </div>

              <div className="week-event-layer">
                {day.events.map((event) => {
                  const layout = getEventLayout(event);

                  return (
                    <button
                      key={event.id}
                      type="button"
                      className={`week-event-block ${isFocusEvent(event) ? 'calendar-event-card--focus' : ''}`}
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
                      onKeyDown={(keyboardEvent) => handleEventKeyboardOpen(keyboardEvent, event)}
                    >
                      <p className="calendar-event-card-title">{event.title}</p>
                      <p className="calendar-event-card-time">{getEventTimeLabel(event, preferences)}</p>
                      <p className="calendar-event-card-context">{getEventContextLabel(event)}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <SelectedDayDetails
        events={selectedDay.events}
        preferences={preferences}
        selectedDate={selectedDay.date}
        onEventClick={(event, clickEvent) =>
          eventClickRouterRef.current.handleSingle({
            event,
            anchorPoint: { x: clickEvent.clientX, y: clickEvent.clientY },
          })
        }
        onEventDoubleClick={(event) =>
          eventClickRouterRef.current.handleDouble({
            event,
          })
        }
        onEventKeyDown={handleEventKeyboardOpen}
      />
    </section>
  );
}
