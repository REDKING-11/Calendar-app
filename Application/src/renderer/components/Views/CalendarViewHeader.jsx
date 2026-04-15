import React from 'react';

const VIEW_OPTIONS = ['day', 'week', 'month', 'year'];

export default function CalendarViewHeader({
  eyebrow,
  title,
  titleTone = 'compact',
  calendarView,
  onChangeView,
  onToday,
  onPrevious,
  onNext,
  previousLabel,
  nextLabel,
  onAddEvent,
  secondaryAction = null,
}) {
  return (
    <header className="calendar-header">
      <div className="calendar-header-row calendar-header-row--primary">
        <div className="calendar-nav-group">
          <button type="button" onClick={onToday}>
            Today
          </button>
          <button
            type="button"
            className="calendar-nav-button"
            onClick={onPrevious}
            aria-label={previousLabel}
          >
            {'<'}
          </button>
          <button
            type="button"
            className="calendar-nav-button"
            onClick={onNext}
            aria-label={nextLabel}
          >
            {'>'}
          </button>
        </div>
        <div className="calendar-header-title">
          <p className="eyebrow">{eyebrow}</p>
          <h2 className={`calendar-title calendar-title--${titleTone}`}>{title}</h2>
        </div>
        <button type="button" onClick={onAddEvent}>
          Add event
        </button>
      </div>

      <div className="calendar-header-row calendar-header-row--secondary">
        <div className="calendar-view-switcher">
          {VIEW_OPTIONS.map((view) => (
            <button
              key={view}
              type="button"
              className={`rounded-full px-4 py-2.5 text-sm font-medium transition ${
                calendarView === view
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-900/12 bg-white/85 text-slate-800 hover:bg-white'
              }`}
              onClick={() => onChangeView?.(view)}
            >
              {view[0].toUpperCase() + view.slice(1)}
            </button>
          ))}
        </div>
        <div className="calendar-secondary-actions">{secondaryAction}</div>
      </div>
    </header>
  );
}
