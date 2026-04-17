import React from 'react';
import DayView from './Views/DayView';
import MonthView from './Views/MonthView';
import WeekView from './Views/WeekView';
import YearView from './Views/YearView';

export default function CalendarViewport({
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
  return (
    <div className="h-full min-h-0 min-w-0 overflow-hidden">
      {calendarView === 'day' ? (
        <DayView
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
