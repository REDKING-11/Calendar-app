import React, { useEffect, useMemo, useRef } from 'react';
import { buildYearMonths, getWeekdayLabels } from '../calendar-helpers';
import CalendarViewHeader from './CalendarViewHeader';
import TodayScheduleControl from './TodayScheduleControl';
import { getEventContextLabel, getEventTimeLabel, isFocusEvent } from '../eventPresentation';
import { buildSelectedMonthAgenda } from '../../eventPacking';
import { createClickIntentRouter } from '../../clickIntent';
import {
  getGridNavigationIndex,
  getRenderedGridColumnCount,
  isGridNavigationKey,
} from '../../keyboardNavigation';

function formatAgendaMonth(date) {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

function formatAgendaDay(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function getAnchorFromElement(element) {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.bottom,
  };
}

export default function YearView({
  headerRef,
  events,
  eventDateIndex,
  todayEvents,
  preferences,
  timeZone,
  selectedDate,
  onSelectMonth,
  onSelectDate,
  onSelectEvent,
  calendarView,
  onChangeView,
}) {
  const yearGridRef = useRef(null);
  const eventHandlersRef = useRef({ onSingle() {}, onDouble() {} });
  const eventClickRouterRef = useRef(null);
  const months = useMemo(
    () => buildYearMonths(selectedDate, events, timeZone, preferences?.weekStartsOn, eventDateIndex),
    [selectedDate, events, timeZone, preferences?.weekStartsOn, eventDateIndex]
  );
  const weekdayLabels = useMemo(
    () => getWeekdayLabels(timeZone, preferences?.weekStartsOn),
    [timeZone, preferences?.weekStartsOn]
  );
  const selectedMonthAgenda = useMemo(
    () => buildSelectedMonthAgenda(events, selectedDate),
    [events, selectedDate]
  );
  const selectedMonthTitle = formatAgendaMonth(selectedDate);
  const selectedMonthEventCount = selectedMonthAgenda.reduce(
    (count, group) => count + group.events.length,
    0
  );

  const goToPreviousYear = () => {
    const nextDate = new Date(selectedDate);
    nextDate.setFullYear(nextDate.getFullYear() - 1);
    onSelectDate?.(nextDate);
  };

  const goToNextYear = () => {
    const nextDate = new Date(selectedDate);
    nextDate.setFullYear(nextDate.getFullYear() + 1);
    onSelectDate?.(nextDate);
  };

  const goToToday = () => {
    onSelectDate?.(new Date());
  };

  const focusMonthCard = (monthIndex) => {
    const nextElement = yearGridRef.current?.querySelector(`[data-year-month-index="${monthIndex}"]`);
    window.requestAnimationFrame(() => nextElement?.focus({ preventScroll: true }));
  };

  eventHandlersRef.current.onSingle = ({ event, anchorPoint }) => {
    onSelectEvent?.({ event, anchorPoint });
  };
  eventHandlersRef.current.onDouble = ({ event }) => {
    onSelectEvent?.({ event, openInDrawer: true });
  };

  if (!eventClickRouterRef.current) {
    eventClickRouterRef.current = createClickIntentRouter({
      onSingle: (payload) => eventHandlersRef.current.onSingle(payload),
      onDouble: (payload) => eventHandlersRef.current.onDouble(payload),
    });
  }

  useEffect(() => {
    return () => {
      eventClickRouterRef.current?.cancelPending();
    };
  }, []);

  return (
    <section className="calendar-card relative flex h-full min-h-0 flex-col rounded-[28px] p-5">
      <CalendarViewHeader
        headerRef={headerRef}
        eyebrow="Year view"
        title={selectedDate.getFullYear()}
        titleTone="compact"
        calendarView={calendarView}
        onChangeView={onChangeView}
        onToday={goToToday}
        onPrevious={goToPreviousYear}
        onNext={goToNextYear}
        previousLabel="Previous year"
        nextLabel="Next year"
        secondaryAction={
          <TodayScheduleControl events={events} todayEvents={todayEvents} preferences={preferences} />
        }
      />

      <div className="year-workspace flex-1">
        <div ref={yearGridRef} className="year-grid min-h-0 overflow-auto">
          {months.map((month, monthIndex) => {
            const isSelectedMonth =
              month.date.getFullYear() === selectedDate.getFullYear() &&
              month.date.getMonth() === selectedDate.getMonth();

            return (
              <button
                key={month.key}
                type="button"
                className={[
                  'year-month-card',
                  isSelectedMonth ? 'year-month-card--selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-year-month-index={monthIndex}
                data-calendar-focus={isSelectedMonth ? 'active' : monthIndex === 0 ? 'first' : undefined}
                onClick={() => onSelectDate?.(month.date)}
                onDoubleClick={() => onSelectMonth?.(month.date)}
                onKeyDown={(keyboardEvent) => {
                  if (isGridNavigationKey(keyboardEvent.key)) {
                    keyboardEvent.preventDefault();
                    const nextIndex = getGridNavigationIndex({
                      currentIndex: monthIndex,
                      itemCount: months.length,
                      columnCount: getRenderedGridColumnCount(yearGridRef.current, 3),
                      key: keyboardEvent.key,
                    });
                    focusMonthCard(nextIndex);
                    return;
                  }

                  if (keyboardEvent.key === 'Enter') {
                    keyboardEvent.preventDefault();
                    onSelectMonth?.(month.date);
                    return;
                  }

                  if (keyboardEvent.key === ' ') {
                    keyboardEvent.preventDefault();
                    onSelectDate?.(month.date);
                  }
                }}
              >
                <div className="year-month-header">
                  <p className="year-month-label">{month.monthLabel}</p>
                  <p className="year-month-meta">
                    {month.count} {month.count === 1 ? 'event' : 'events'}
                  </p>
                </div>

                <div className="year-mini-weekdays" aria-hidden="true">
                  {weekdayLabels.map((label) => (
                    <span key={`${month.key}-${label}`} className="year-mini-weekday">
                      {label[0]}
                    </span>
                  ))}
                </div>

                <div className="year-mini-grid" role="presentation">
                  {month.days.map((day) => (
                    <span
                      key={day.key}
                      className={[
                        'year-mini-day',
                        day.inCurrentMonth ? '' : 'year-mini-day--muted',
                        day.isToday ? 'year-mini-day--today' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {day.dayNumber}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>

        <aside className="year-agenda-panel" aria-label={`${selectedMonthTitle} agenda`}>
          <div className="year-agenda-header">
            <div className="min-w-0">
              <p className="settings-section-eyebrow">Selected month</p>
              <h3>{selectedMonthTitle}</h3>
            </div>
            <span className="year-agenda-count">
              {selectedMonthEventCount} {selectedMonthEventCount === 1 ? 'event' : 'events'}
            </span>
          </div>

          <div className="year-agenda-list">
            {selectedMonthAgenda.length > 0 ? (
              selectedMonthAgenda.map((group) => (
                <section key={group.key} className="year-agenda-day">
                  <p className="year-agenda-day-label">{formatAgendaDay(group.date)}</p>
                  <div className="year-agenda-events">
                    {group.events.map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        className={[
                          'year-agenda-event',
                          isFocusEvent(event) ? 'year-agenda-event--focus' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        style={{ borderLeftColor: event.color || '#4f9d69' }}
                        onClick={(clickEvent) =>
                          eventClickRouterRef.current.handleSingle({
                            event,
                            anchorPoint: { x: clickEvent.clientX, y: clickEvent.clientY },
                          })
                        }
                        onDoubleClick={() => eventClickRouterRef.current.handleDouble({ event })}
                        onKeyDown={(keyboardEvent) => {
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
                        }}
                      >
                        <span className="year-agenda-event-time">
                          {getEventTimeLabel(event, preferences)}
                        </span>
                        <span className="year-agenda-event-body">
                          <span className="year-agenda-event-title">{event.title}</span>
                          <span className="year-agenda-event-context">{getEventContextLabel(event)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              ))
            ) : (
              <p className="year-agenda-empty">
                No visible events in this month. Select another month or create one from the calendar.
              </p>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
