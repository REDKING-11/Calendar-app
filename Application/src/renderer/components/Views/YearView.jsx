import React, { useMemo, useRef } from 'react';
import { buildYearMonths, getWeekdayLabels } from '../calendar-helpers';
import CalendarViewHeader from './CalendarViewHeader';
import TodayScheduleControl from './TodayScheduleControl';
import {
  getGridNavigationIndex,
  getRenderedGridColumnCount,
  isGridNavigationKey,
} from '../../keyboardNavigation';

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
  calendarView,
  onChangeView,
}) {
  const yearGridRef = useRef(null);
  const months = useMemo(
    () => buildYearMonths(selectedDate, events, timeZone, preferences?.weekStartsOn, eventDateIndex),
    [selectedDate, events, timeZone, preferences?.weekStartsOn, eventDateIndex]
  );
  const weekdayLabels = useMemo(
    () => getWeekdayLabels(timeZone, preferences?.weekStartsOn),
    [timeZone, preferences?.weekStartsOn]
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

      <div ref={yearGridRef} className="year-grid flex-1 overflow-auto">
        {months.map((month, monthIndex) => {
          const isSelectedMonth =
            month.date.getFullYear() === selectedDate.getFullYear() &&
            month.date.getMonth() === selectedDate.getMonth();

          return (
            <button
              key={month.key}
              type="button"
              className="year-month-card"
              data-year-month-index={monthIndex}
              data-calendar-focus={isSelectedMonth ? 'active' : monthIndex === 0 ? 'first' : undefined}
              onClick={() => onSelectMonth?.(month.date)}
              onKeyDown={(keyboardEvent) => {
                if (!isGridNavigationKey(keyboardEvent.key)) {
                  return;
                }

                keyboardEvent.preventDefault();
                const nextIndex = getGridNavigationIndex({
                  currentIndex: monthIndex,
                  itemCount: months.length,
                  columnCount: getRenderedGridColumnCount(yearGridRef.current, 3),
                  key: keyboardEvent.key,
                });
                focusMonthCard(nextIndex);
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
    </section>
  );
}
