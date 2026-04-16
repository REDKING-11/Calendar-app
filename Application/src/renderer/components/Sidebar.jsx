import React, { useEffect, useMemo, useRef, useState } from 'react';
import { WEEKDAY_LABELS, buildMonthTiles, isSameDay } from './calendar-helpers';

const SIDEBAR_MONTH_SCROLL_LOCK_MS = 140;

export default function Sidebar({
  availableTags,
  events,
  visibleEvents,
  selectedDate,
  onSelectDate,
  onCreateEvent,
  searchQuery,
  onSearchQueryChange,
  quickFilter,
  onQuickFilterChange,
  activeTagFilters,
  onToggleTagFilter,
  onClearFilters,
}) {
  const [viewDate, setViewDate] = useState(() => selectedDate || new Date());
  const [isQuickFiltersOpen, setIsQuickFiltersOpen] = useState(true);
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const monthPickerRef = useRef(null);
  const lastMonthScrollAtRef = useRef(0);
  const tiles = useMemo(() => buildMonthTiles(viewDate, events), [viewDate, events]);
  const monthOptions = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => {
        const date = new Date(viewDate.getFullYear(), index, 1);

        return {
          key: `${viewDate.getFullYear()}-${index}`,
          index,
          label: date.toLocaleDateString('en-US', { month: 'short' }),
        };
      }),
    [viewDate]
  );
  const tagFilters = useMemo(
    () =>
      (availableTags || []).map((tag) => ({
        id: tag.label,
        label: tag.label,
        color: tag.color || '#475569',
      })),
    [availableTags]
  );
  const monthTitle = viewDate.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
  const quickFilterOptions = [
    { id: 'all', label: 'All' },
    { id: 'today', label: 'Today' },
    { id: 'week', label: 'This week' },
    { id: 'month', label: 'This month' },
  ];

  useEffect(() => {
    if (selectedDate) {
      setViewDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
    }
  }, [selectedDate]);

  useEffect(() => {
    if (!isMonthPickerOpen) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!monthPickerRef.current?.contains(event.target)) {
        setIsMonthPickerOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsMonthPickerOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isMonthPickerOpen]);

  const hasActiveFilters = searchQuery.trim() || activeTagFilters.length > 0;

  const changeViewMonth = (offset) => {
    setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  const handleMonthWheel = (event) => {
    if (event.deltaY === 0) {
      return;
    }

    event.preventDefault();

    const now = Date.now();
    if (now - lastMonthScrollAtRef.current < SIDEBAR_MONTH_SCROLL_LOCK_MS) {
      return;
    }

    lastMonthScrollAtRef.current = now;
    changeViewMonth(event.deltaY > 0 ? 1 : -1);
    setIsMonthPickerOpen(false);
  };

  return (
    <aside className="sidebar-shell w-full min-h-0 rounded-[28px] border border-slate-200 bg-white px-4 py-5 text-slate-900 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
      <div className="flex h-full flex-col">
        <button
          type="button"
          onClick={() => onCreateEvent?.(selectedDate || new Date())}
          className="flex items-center justify-between rounded-2xl bg-slate-800 px-5 py-4 text-left text-white shadow-[0_8px_20px_rgba(15,23,42,0.18)] transition hover:bg-slate-700"
        >
          <span className="flex items-center gap-3">
            <span className="text-3xl leading-none">+</span>
            <span className="text-lg font-semibold">Create</span>
          </span>
          <span className="text-sm text-slate-300">New</span>
        </button>

        <div className="sidebar-mini-calendar mt-10" onWheel={handleMonthWheel}>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div ref={monthPickerRef} className="sidebar-month-picker-anchor">
              <button
                type="button"
                className="sidebar-month-trigger"
                onClick={() => setIsMonthPickerOpen((current) => !current)}
                aria-expanded={isMonthPickerOpen}
                aria-haspopup="dialog"
                aria-label={`${monthTitle}. Click to choose a month or use the mouse wheel to move between months.`}
                title="Click to choose a month or use the mouse wheel to move between months"
              >
                <span className="sidebar-month-trigger-label">{monthTitle}</span>
              </button>

              {isMonthPickerOpen ? (
                <div
                  className="sidebar-month-picker"
                  role="dialog"
                  aria-label={`Choose month for ${viewDate.getFullYear()}`}
                >
                  <p className="sidebar-month-picker-year">{viewDate.getFullYear()}</p>
                  <div className="sidebar-month-picker-grid">
                    {monthOptions.map((month) => (
                      <button
                        key={month.key}
                        type="button"
                        className={[
                          'sidebar-month-option',
                          month.index === viewDate.getMonth() ? 'sidebar-month-option--active' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        onClick={() => {
                          setViewDate(
                            (current) => new Date(current.getFullYear(), month.index, 1)
                          );
                          setIsMonthPickerOpen(false);
                        }}
                      >
                        {month.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-4 text-slate-500">
              <button
                type="button"
                className="text-lg transition hover:text-slate-900"
                onClick={() => changeViewMonth(-1)}
                aria-label="Previous month"
              >
                {'<'}
              </button>
              <button
                type="button"
                className="text-lg transition hover:text-slate-900"
                onClick={() => changeViewMonth(1)}
                aria-label="Next month"
              >
                {'>'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-y-3 text-center text-[12px] font-semibold text-slate-500">
            {WEEKDAY_LABELS.map((day) => (
              <div key={day} className="py-1">
                {day[0]}
              </div>
            ))}

            {tiles.map((tile) => (
              (() => {
                const isSelected = selectedDate ? isSameDay(tile.date, selectedDate) : false;

                return (
                  <button
                    key={tile.key}
                    type="button"
                    onClick={() => onSelectDate?.(tile.date)}
                    className={[
                      'sidebar-mini-day mx-auto flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-medium transition',
                      tile.inCurrentMonth
                        ? 'text-slate-800 hover:bg-slate-100'
                        : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700',
                      tile.isToday ? 'sidebar-mini-day--today' : '',
                      isSelected ? 'sidebar-mini-day--selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {tile.dayNumber}
                  </button>
                );
              })()
            ))}
          </div>
        </div>

        <div className="mt-6">
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange?.(event.target.value)}
            placeholder="Search events or tags"
            className="w-full rounded-xl bg-slate-100 px-4 py-3 text-[15px] text-slate-700 outline-none transition focus:bg-white focus:ring-2 focus:ring-slate-200"
          />
        </div>

        <div className="mt-8 space-y-8 text-[15px]">
          <div className="mb-2">
            <div className="mb-4 flex items-center justify-between font-semibold text-slate-900">
              <button
                type="button"
                onClick={() => setIsQuickFiltersOpen((current) => !current)}
                className="flex items-center gap-2 text-left transition hover:text-slate-700"
              >
                <span>Quick filters</span>
                <span className="text-sm text-slate-500">
                  {isQuickFiltersOpen ? 'Hide' : 'Show'}
                </span>
              </button>

              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={onClearFilters}
                  className="text-sm font-medium text-slate-500 transition hover:text-slate-900"
                >
                  Clear
                </button>
              ) : null}
            </div>

            <div
              className={[
                'sidebar-quick-filters overflow-hidden transition-all duration-200',
                isQuickFiltersOpen ? 'max-h-[420px] opacity-100' : 'max-h-0 opacity-0',
              ].join(' ')}
            >
              <div className="mb-4 flex flex-wrap gap-2">
                {quickFilterOptions.map((option) => {
                  const isActive = quickFilter === option.id;

                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => onQuickFilterChange?.(option.id)}
                      className={[
                        'rounded-full border px-3 py-2 text-sm font-medium transition',
                        isActive
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900',
                      ].join(' ')}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>

              <div className="space-y-3">
                {tagFilters.length > 0 ? (
                  tagFilters.map((item) => {
                    const isActive = activeTagFilters.includes(item.id);

                    return (
                      <label key={item.id} className="flex cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          checked={isActive}
                          onChange={() => onToggleTagFilter?.(item.id)}
                          className="sr-only"
                        />
                        <span
                          className="flex h-5 w-5 items-center justify-center rounded-[4px] text-[12px] font-bold text-white"
                          style={{ backgroundColor: item.color }}
                        >
                          {isActive ? 'x' : ''}
                        </span>
                        <span className="text-[15px] text-slate-800">{item.label}</span>
                      </label>
                    );
                  })
                ) : (
                  <p className="text-sm text-slate-500">Add tags to events to filter them here.</p>
                )}
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1">
            <div className="mb-4 flex items-center justify-between font-semibold text-slate-900">
              <span>Visible events</span>
              <span className="text-sm font-medium text-slate-500">{visibleEvents.length}</span>
            </div>

            {isQuickFiltersOpen ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                Visible events are hidden while Quick filters is open.
              </div>
            ) : (
              <div className="sidebar-visible-events sidebar-visible-events--expanded space-y-3">
                {visibleEvents.map((event) => (
                  <div key={event.id} className="sidebar-visible-events-item">
                    <button
                      type="button"
                      onClick={() => onSelectDate?.(new Date(event.startsAt))}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left transition hover:bg-white"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: event.color || '#4f9d69' }}
                        />
                        <span className="text-sm font-semibold text-slate-900">{event.title}</span>
                      </div>
                      <p className="mt-2 text-sm text-slate-500">
                        {new Date(event.startsAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}{' '}
                        at{' '}
                        {new Date(event.startsAt).toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                    </button>
                  </div>
                ))}
                {visibleEvents.length === 0 ? (
                  <p className="text-sm text-slate-500">No events match the current filters.</p>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="mt-auto pt-10 text-sm text-slate-400">Terms - Privacy</div>
      </div>
    </aside>
  );
}
