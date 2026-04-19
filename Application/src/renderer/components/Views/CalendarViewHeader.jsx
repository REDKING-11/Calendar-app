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
      <div className="calendar-nav-group">
        <button type="button" className="calendar-header-button" onClick={onToday}>
          Today
        </button>
        <button
          type="button"
          className="calendar-header-button calendar-header-button--icon calendar-nav-button"
          onClick={onPrevious}
          aria-label={previousLabel}
        >
          {'<'}
        </button>
        <button
          type="button"
          className="calendar-header-button calendar-header-button--icon calendar-nav-button"
          onClick={onNext}
          aria-label={nextLabel}
        >
          {'>'}
        </button>
      </div>

      <div className="calendar-header-title">
        <h2 className={`calendar-title calendar-title--${titleTone}`}>{title}</h2>
      </div>

      <div className="calendar-view-switcher">
        {VIEW_OPTIONS.map((view) => (
          <button
            key={view}
            type="button"
            className={`calendar-view-toggle rounded-full px-4 py-2.5 text-sm font-medium transition ${
              calendarView === view
                ? 'calendar-view-toggle--active'
                : ''
            }`}
            onClick={() => onChangeView?.(view)}
          >
            {view[0].toUpperCase() + view.slice(1)}
          </button>
        ))}
      </div>

      <div className="calendar-header-actions">
        {onAddEvent ? (
          <button
            type="button"
            className="calendar-header-button calendar-header-button--primary calendar-header-primary-action"
            onClick={(event) => onAddEvent?.(event)}
          >
            Add event
          </button>
        ) : null}
        {secondaryAction ? <div className="calendar-secondary-actions">{secondaryAction}</div> : null}
      </div>
    </header>
  );
}
