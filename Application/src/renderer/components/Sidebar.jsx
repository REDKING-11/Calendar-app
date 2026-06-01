import React, { useEffect, useMemo, useRef, useState } from 'react';
import { buildMonthTiles, getWeekdayLabels, isSameDay } from './calendar-helpers';

export default function Sidebar({
  regionRef,
  availableTags,
  events,
  eventDateIndex,
  visibleEvents,
  calendarGroups = [],
  connectedAccounts = [],
  externalCalendarSources = [],
  preferences,
  timeZone,
  selectedDate,
  onSelectDate,
  onCreateEvent,
  searchQuery,
  onSearchQueryChange,
  quickFilter,
  onQuickFilterChange,
  activeTagFilters,
  onToggleTagFilter,
  onManageTag,
  onToggleCalendar,
  onUseCalendar,
  onClearFilters,
}) {
  const [viewDate, setViewDate] = useState(() => selectedDate || new Date());
  const [activeSidebarPanel, setActiveSidebarPanel] = useState('filters');
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const [isYearPickerOpen, setIsYearPickerOpen] = useState(false);
  const [tagActionMenu, setTagActionMenu] = useState(null);
  const monthPickerRef = useRef(null);
  const yearPickerRef = useRef(null);
  const tiles = useMemo(
    () => buildMonthTiles(viewDate, events, timeZone, preferences?.weekStartsOn, eventDateIndex),
    [viewDate, events, timeZone, preferences?.weekStartsOn, eventDateIndex]
  );
  const weekdayLabels = useMemo(
    () => getWeekdayLabels(timeZone, preferences?.weekStartsOn),
    [timeZone, preferences?.weekStartsOn]
  );
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
  const yearOptions = useMemo(() => {
    const currentYear = viewDate.getFullYear();

    return Array.from({ length: 17 }, (_, index) => currentYear - 8 + index);
  }, [viewDate]);
  const tagFilters = useMemo(
    () =>
      (availableTags || []).map((tag) => ({
        id: tag.id || tag.label,
        filterId: tag.label,
        label: tag.label,
        color: tag.color || '#475569',
      })),
    [availableTags]
  );
  const monthLabel = viewDate.toLocaleDateString('en-US', {
    month: 'long',
  });
  const yearLabel = String(viewDate.getFullYear());
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
    if (!isMonthPickerOpen && !isYearPickerOpen) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!monthPickerRef.current?.contains(event.target)) {
        setIsMonthPickerOpen(false);
      }
      if (!yearPickerRef.current?.contains(event.target)) {
        setIsYearPickerOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsMonthPickerOpen(false);
        setIsYearPickerOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isMonthPickerOpen, isYearPickerOpen]);

  useEffect(() => {
    if (!tagActionMenu) {
      return undefined;
    }

    const handlePointerDown = () => {
      setTagActionMenu(null);
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setTagActionMenu(null);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [tagActionMenu]);

  const hasActiveFilters = searchQuery.trim() || activeTagFilters.length > 0;
  const hasConnectedAccounts = connectedAccounts.length > 0;
  const importedCalendarCount = externalCalendarSources.length;

  const changeViewMonth = (offset) => {
    setViewDate((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  const changeViewYear = (offset) => {
    setViewDate((current) => new Date(current.getFullYear() + offset, current.getMonth(), 1));
  };

  const handleMonthWheel = (event) => {
    if (event.deltaY === 0) {
      return;
    }

    event.preventDefault();
    setIsYearPickerOpen(false);
    setIsMonthPickerOpen(false);
    changeViewMonth(event.deltaY > 0 ? 1 : -1);
  };

  const handleYearWheel = (event) => {
    if (event.deltaY === 0) {
      return;
    }

    event.preventDefault();
    setIsMonthPickerOpen(false);
    setIsYearPickerOpen(false);
    changeViewYear(event.deltaY > 0 ? 1 : -1);
  };

  const openTagActionMenu = (event, tag) => {
    event.preventDefault();
    event.stopPropagation();
    setTagActionMenu({
      tag,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const handleTagMouseDown = (event, tag) => {
    if (event.button !== 1) {
      return;
    }

    openTagActionMenu(event, tag);
  };

  const handleTagAuxClick = (event, tag) => {
    if (event.button !== 1) {
      return;
    }

    openTagActionMenu(event, tag);
  };

  return (
    <aside
      ref={regionRef}
      className="sidebar-shell app-panel w-full min-h-0 rounded-[20px] px-3 py-4"
      aria-label="Sidebar"
    >
      <div className="flex h-full flex-col">
        <button
          type="button"
          onClick={() =>
            onCreateEvent?.({
              date: selectedDate || new Date(),
              openInDrawer: true,
            })
          }
          data-keyboard-focus="sidebar-primary"
          className="app-button app-button--primary flex items-center justify-between rounded-xl px-3 py-2.5 text-left"
        >
          <span className="flex items-center gap-2">
            <span className="text-2xl leading-none">+</span>
            <span className="text-sm font-semibold">Create</span>
          </span>
          <span className="text-xs opacity-80">New</span>
        </button>

        <div className="sidebar-mini-calendar mt-5">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div className="sidebar-period-picker">
              <div className="sidebar-period-control">
                <div ref={monthPickerRef} className="sidebar-period-segment sidebar-month-picker-anchor">
                  <button
                    type="button"
                    className="sidebar-month-trigger sidebar-month-trigger--segment"
                    onClick={() => {
                      setIsMonthPickerOpen((current) => {
                        const next = !current;
                        if (next) {
                          setIsYearPickerOpen(false);
                        }
                        return next;
                      });
                    }}
                    aria-expanded={isMonthPickerOpen}
                    aria-haspopup="dialog"
                    aria-label={`Choose month. Current month is ${monthLabel}.`}
                    title="Choose month"
                    onWheel={handleMonthWheel}
                  >
                    <span className="sidebar-month-trigger-label">{monthLabel}</span>
                  </button>

                  {isMonthPickerOpen ? (
                    <div
                      className="sidebar-month-picker sidebar-month-picker--month"
                      role="dialog"
                      aria-label={`Choose month for ${viewDate.getFullYear()}`}
                      onWheel={handleMonthWheel}
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

                <span className="sidebar-period-divider" aria-hidden="true" />

                <div ref={yearPickerRef} className="sidebar-period-segment sidebar-year-picker-anchor">
                    <button
                      type="button"
                      className="sidebar-month-trigger sidebar-month-trigger--segment sidebar-year-trigger"
                      onClick={() => {
                        setIsYearPickerOpen((current) => {
                          const next = !current;
                          if (next) {
                            setIsMonthPickerOpen(false);
                          }
                          return next;
                        });
                      }}
                      aria-expanded={isYearPickerOpen}
                      aria-haspopup="dialog"
                      aria-label={`Choose year. Current year is ${yearLabel}.`}
                      title="Choose year"
                      onWheel={handleYearWheel}
                    >
                      <span className="sidebar-month-trigger-label">{yearLabel}</span>
                    </button>

                    {isYearPickerOpen ? (
                      <div
                        className="sidebar-month-picker sidebar-year-picker"
                        role="dialog"
                        aria-label={`Choose year around ${viewDate.getFullYear()}`}
                        onWheel={(event) => event.stopPropagation()}
                      >
                        <p className="sidebar-month-picker-year">Select year</p>
                        <div className="sidebar-year-picker-grid">
                          {yearOptions.map((year) => (
                            <button
                              key={year}
                              type="button"
                              className={[
                                'sidebar-month-option',
                                'sidebar-year-option',
                                year === viewDate.getFullYear() ? 'sidebar-month-option--active' : '',
                              ]
                                .filter(Boolean)
                                .join(' ')}
                              onClick={() => {
                                setViewDate((current) => new Date(year, current.getMonth(), 1));
                                setIsYearPickerOpen(false);
                              }}
                            >
                              {year}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                </div>
              </div>
            </div>

            <div className="sidebar-period-nav">
              <button
                type="button"
                className="sidebar-period-arrow"
                onClick={() => changeViewMonth(-1)}
                aria-label="Previous month"
              >
                {'<'}
              </button>
              <button
                type="button"
                className="sidebar-period-arrow"
                onClick={() => changeViewMonth(1)}
                aria-label="Next month"
              >
                {'>'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-y-1 text-center text-[10px] font-semibold app-text-soft">
            {weekdayLabels.map((day) => (
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
                      'sidebar-mini-day mx-auto flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-medium transition',
                      tile.inCurrentMonth
                        ? 'text-[var(--text-primary)]'
                        : 'app-text-soft',
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

        <div className="mt-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange?.(event.target.value)}
            placeholder="Search events or tags"
            data-keyboard-focus="sidebar-search"
            className="app-input w-full rounded-xl px-3 py-2 text-[13px]"
          />
        </div>

        <div className="mt-5">
          <div className="mb-3 flex items-center justify-between gap-2 font-semibold text-[var(--text-primary)]">
            <span>Calendars</span>
            <span className="sidebar-section-count">{importedCalendarCount}</span>
          </div>
          <p className="sidebar-section-copy">
            Using sets where new events go. Visibility only changes the view.
          </p>

          <div className="sidebar-calendar-groups grid gap-3">
            {calendarGroups.map((group) => (
              <section key={group.id} className="sidebar-calendar-group">
                <div className="sidebar-calendar-group-header">
                  <div className="min-w-0">
                    <p className="sidebar-calendar-group-title">
                      {group.title}
                    </p>
                    <p className="sidebar-calendar-provider">
                      {group.provider === 'microsoft'
                        ? 'Outlook'
                        : group.provider === 'google'
                          ? 'Google'
                          : 'Local'}
                    </p>
                  </div>
                </div>

                {group.calendars.length > 0 ? (
                  <div className="grid gap-1.5">
                    {group.calendars.map((calendar) => (
                      <div
                        key={calendar.id}
                        className={[
                          'sidebar-calendar-toggle rounded-xl px-2 py-2 transition',
                          calendar.active ? 'sidebar-calendar-toggle--active' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        title={`${calendar.active ? 'Using' : 'Use'} ${calendar.label}`}
                      >
                        <button
                          type="button"
                          className="sidebar-calendar-use-button"
                          onClick={() => onUseCalendar?.(calendar)}
                        >
                          <span
                            className="sidebar-calendar-dot"
                            style={{ backgroundColor: calendar.color || '#64748b' }}
                          />
                          <span className="sidebar-calendar-label-wrap">
                            <span className="sidebar-calendar-label">{calendar.label}</span>
                            {calendar.active ? (
                              <span className="sidebar-calendar-active-badge">Using</span>
                            ) : null}
                          </span>
                        </button>
                        <div className="sidebar-calendar-actions">
                          <button
                            type="button"
                            className={[
                              'sidebar-calendar-check',
                              calendar.visible ? 'sidebar-calendar-check--active' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            style={{
                              '--calendar-color': calendar.color || '#64748b',
                            }}
                            onClick={() => onToggleCalendar?.(calendar)}
                            aria-label={`${calendar.visible ? 'Hide' : 'Show'} ${calendar.label}`}
                          >
                            {calendar.visible ? 'On' : 'Off'}
                          </button>
                          <span className="sidebar-calendar-count">{calendar.eventCount}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="m-0 text-xs app-text-soft">No imported calendars yet.</p>
                )}
              </section>
            ))}
          </div>

          {!hasConnectedAccounts ? (
            <p className="mt-2 text-xs app-text-soft">
              Use Local only, or connect an email account to import its calendars.
            </p>
          ) : importedCalendarCount === 0 ? (
            <p className="mt-2 text-xs app-text-soft">
              Import provider calendars from Settings once, then show or hide them here.
            </p>
          ) : null}
        </div>

        <div className="mt-5 text-[13px]">
          <div
            className="sidebar-panel-switch"
            role="tablist"
            aria-label="Sidebar panel"
          >
            <span
              className={[
                'sidebar-panel-switch-indicator',
                activeSidebarPanel === 'events' ? 'sidebar-panel-switch-indicator--right' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-hidden="true"
            />
            <button
              type="button"
              role="tab"
              aria-selected={activeSidebarPanel === 'filters'}
              className="sidebar-panel-tab"
              onClick={() => setActiveSidebarPanel('filters')}
            >
              <span>Filters</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeSidebarPanel === 'events'}
              className="sidebar-panel-tab"
              onClick={() => setActiveSidebarPanel('events')}
            >
              <span>Events</span>
              <span className="sidebar-panel-count">{visibleEvents.length}</span>
            </button>
          </div>

          <div className="sidebar-panel-viewport">
            <div
              className={[
                'sidebar-panel-track',
                activeSidebarPanel === 'events' ? 'sidebar-panel-track--events' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <section className="sidebar-panel-pane" aria-hidden={activeSidebarPanel !== 'filters'}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="font-semibold text-[var(--text-primary)]">Filters</span>
                  {hasActiveFilters ? (
                    <button
                      type="button"
                      onClick={onClearFilters}
                      className="text-xs font-medium app-text-soft transition hover:text-[var(--text-primary)]"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>

                <div className="sidebar-quick-filters">
                  <div className="mb-4 flex flex-wrap gap-1.5">
                    {quickFilterOptions.map((option) => {
                      const isActive = quickFilter === option.id;

                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => onQuickFilterChange?.(option.id)}
                          className={[
                            'rounded-full border px-2.5 py-1.5 text-xs font-medium transition',
                            isActive ? 'app-chip app-chip--active' : 'app-chip',
                          ].join(' ')}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>

                  <div className="space-y-2.5">
                    {tagFilters.length > 0 ? (
                      tagFilters.map((item) => {
                        const isActive = activeTagFilters.includes(item.filterId);

                        return (
                          <label
                            key={item.id}
                            className="flex cursor-pointer items-center gap-2"
                            onMouseDown={(event) => handleTagMouseDown(event, item)}
                            onAuxClick={(event) => handleTagAuxClick(event, item)}
                            title='Middle-click for rename or delete'
                          >
                            <input
                              type="checkbox"
                              checked={isActive}
                              onChange={() => onToggleTagFilter?.(item.filterId)}
                              className="sr-only"
                            />
                            <span
                              className="flex h-4 w-4 items-center justify-center rounded-[4px] text-[10px] font-bold text-white"
                              style={{ backgroundColor: item.color }}
                            >
                              {isActive ? 'x' : ''}
                            </span>
                            <span className="min-w-0 truncate text-[13px] text-[var(--text-primary)]">{item.label}</span>
                          </label>
                        );
                      })
                    ) : (
                      <p className="text-xs app-text-soft">Add tags to events to filter them here.</p>
                    )}
                  </div>
                </div>
              </section>

              <section className="sidebar-panel-pane" aria-hidden={activeSidebarPanel !== 'events'}>
                <div className="mb-3 flex items-center justify-between font-semibold text-[var(--text-primary)]">
                  <span>Visible events</span>
                  <span className="text-sm font-medium app-text-soft">{visibleEvents.length}</span>
                </div>

                <div className="sidebar-visible-events sidebar-visible-events--expanded space-y-3">
                  {visibleEvents.map((event) => (
                    <div key={event.id} className="sidebar-visible-events-item">
                      <button
                        type="button"
                        onClick={() => onSelectDate?.(new Date(event.startsAt))}
                        className="sidebar-visible-event-card w-full rounded-xl px-2.5 py-2.5 text-left transition"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: event.color || '#4f9d69' }}
                          />
                          <span className="min-w-0 truncate text-xs font-semibold text-[var(--text-primary)]">{event.title}</span>
                        </div>
                        <p className="mt-1.5 text-xs app-text-soft">
                          {new Date(event.startsAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })}{' '}
                          at{' '}
                          {new Intl.DateTimeFormat(undefined, {
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: preferences?.timeFormat === '12h',
                          }).format(new Date(event.startsAt))}
                        </p>
                      </button>
                    </div>
                  ))}
                  {visibleEvents.length === 0 ? (
                    <p className="text-xs app-text-soft">No events match the current filters.</p>
                  ) : null}
                </div>
              </section>
            </div>
          </div>
        </div>

        <div className="mt-auto pt-6 text-xs app-text-soft">Terms - Privacy</div>
      </div>
      {tagActionMenu ? (
        <div
          className="sidebar-context-menu fixed z-50 min-w-[180px] rounded-2xl p-2"
          style={{
            left: Math.min(tagActionMenu.x, window.innerWidth - 196),
            top: Math.min(tagActionMenu.y, window.innerHeight - 120),
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <p className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-[0.14em] app-text-soft">
            {tagActionMenu.tag.label}
          </p>
          <button
            type="button"
            className="sidebar-context-button flex w-full rounded-xl px-3 py-2 text-left text-sm transition"
            onClick={() => {
              onManageTag?.(tagActionMenu.tag, 'rename');
              setTagActionMenu(null);
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className="sidebar-context-button sidebar-context-button--danger flex w-full rounded-xl px-3 py-2 text-left text-sm transition"
            onClick={() => {
              onManageTag?.(tagActionMenu.tag, 'delete');
              setTagActionMenu(null);
            }}
          >
            Delete Fully
          </button>
          <div
            role="alert"
            className="sidebar-warning-card mx-1 mt-2 rounded-xl px-3 py-2.5"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em]">
              Warning
            </p>
            <p className="mt-1 text-xs leading-5">
              Deleting this tag removes it from every event across the app.
            </p>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
