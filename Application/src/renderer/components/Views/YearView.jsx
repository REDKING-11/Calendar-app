import React, { useMemo } from 'react';
import { buildYearMonths, getWeekdayLabels } from '../calendar-helpers';
import CalendarViewHeader from './CalendarViewHeader';
import TodayScheduleControl from './TodayScheduleControl';

export default function YearView({
  events,
  preferences,
  timeZone,
  selectedDate,
  onSelectMonth,
  onCreateEvent,
  onSelectDate,
  calendarView,
  onChangeView,
}) {
  const months = useMemo(
    () => buildYearMonths(selectedDate, events, timeZone, preferences?.weekStartsOn),
    [selectedDate, events, timeZone, preferences?.weekStartsOn]
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

  return (
    <section className="calendar-card relative flex h-full min-h-0 flex-col rounded-[28px] p-5">
      <CalendarViewHeader
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
        onAddEvent={() => onCreateEvent?.(selectedDate)}
        secondaryAction={<TodayScheduleControl events={events} preferences={preferences} />}
      />

      <div className="year-grid flex-1 overflow-auto">
        {months.map((month) => (
          <button
            key={month.key}
            type="button"
            className="year-month-card"
            onClick={() => onSelectMonth?.(month.date)}
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
        ))}
      </div>
    </section>
  );
}
