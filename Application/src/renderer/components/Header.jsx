import React from 'react';

export default function Header({
  regionRef,
  eventCount,
  onToggleUpcoming,
  onOpenAbout,
  onOpenSettings,
  timeZone,
}) {
  return (
    <section ref={regionRef} className="flex w-full min-w-0 flex-col gap-3" aria-label="Header controls">
      <div className="app-toolbar flex w-full flex-wrap items-center justify-between gap-3 rounded-3xl px-5 py-4">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">Calendar</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="app-pill">
            {eventCount} events
          </span>
          <button
            type="button"
            onClick={onToggleUpcoming}
            data-keyboard-focus="app-header-primary"
            className="app-button app-button--secondary"
          >
            Upcoming
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="app-button app-button--primary"
          >
            Settings
          </button>
          <button
            type="button"
            onClick={onOpenAbout}
            className="app-button app-button--secondary"
          >
            About this app
          </button>
          <span className="app-pill">
            Timezone: {timeZone}
          </span>
        </div>
      </div>
    </section>
  );
}
