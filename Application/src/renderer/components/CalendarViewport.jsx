import React from 'react';
import DayView from './Views/DayView';
import MonthView from './Views/MonthView';
import WeekView from './Views/WeekView';
import YearView from './Views/YearView';

export default function CalendarViewport({
  regionRef,
  headerRef,
  calendarView,
  events,
  preferences,
  selectedDate,
  timeZone,
  onSelectDate,
  onCreateEvent,
  onSelectEvent,
  onChangeView,
  onSelectMonth,
}) {
  const viewLabel = `${calendarView[0].toUpperCase()}${calendarView.slice(1)} calendar`;

  return (
    <div
      ref={regionRef}
      className="h-full min-h-0 min-w-0 overflow-hidden"
      role="region"
      aria-label={viewLabel}
    >
      {calendarView === 'day' ? (
        <DayView
          headerRef={headerRef}
          events={events}
          preferences={preferences}
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
          onCreateEvent={onCreateEvent}
          onSelectEvent={onSelectEvent}
          calendarView={calendarView}
          onChangeView={onChangeView}
        />
      ) : null}
      {calendarView === 'month' ? (
        <MonthView
          headerRef={headerRef}
          events={events}
          preferences={preferences}
          timeZone={timeZone}
          onCreateEvent={onCreateEvent}
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
          onSelectEvent={onSelectEvent}
          calendarView={calendarView}
          onChangeView={onChangeView}
        />
      ) : null}
      {calendarView === 'week' ? (
        <WeekView
          headerRef={headerRef}
          events={events}
          preferences={preferences}
          timeZone={timeZone}
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
          onCreateEvent={onCreateEvent}
          onSelectEvent={onSelectEvent}
          calendarView={calendarView}
          onChangeView={onChangeView}
        />
      ) : null}
      {calendarView === 'year' ? (
        <YearView
          headerRef={headerRef}
          events={events}
          preferences={preferences}
          timeZone={timeZone}
          selectedDate={selectedDate}
          onSelectDate={onSelectDate}
          onCreateEvent={onCreateEvent}
          onSelectMonth={onSelectMonth}
          calendarView={calendarView}
          onChangeView={onChangeView}
        />
      ) : null}
    </div>
  );
}
