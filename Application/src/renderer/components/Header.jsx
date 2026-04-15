import React from 'react';

export default function Header({
  eventCount,
  onToggleUpcoming,
  onOpenAbout,
  timeZone,
  onToggleSetup,
  isSetupOpen,
}) {
  return (
    <section className="mx-auto flex w-full max-w-[1800px] flex-col gap-3 px-6 pt-6 xl:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-slate-900/8 bg-white/70 px-5 py-4 shadow-[0_18px_50px_rgba(36,52,89,0.10)] backdrop-blur-md">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
            Workspace
          </p>
          <h1 className="text-xl font-semibold text-slate-900">
            Calendar
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-slate-900/10 bg-white/85 px-3 py-2 text-sm text-slate-600">
            {eventCount} events
          </span>
          <button
            type="button"
            onClick={onToggleUpcoming}
            className="rounded-full border border-slate-900/12 bg-white/85 px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-white"
          >
            Upcoming
          </button>
          <button
            type="button"
            onClick={onOpenAbout}
            className="rounded-full border border-slate-900/12 bg-white/85 px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-white"
          >
            About this app
          </button>
          <span className="rounded-full border border-slate-900/10 bg-white/85 px-3 py-2 text-sm text-slate-600">
            Timezone: {timeZone}
          </span>
          <button
            type="button"
            onClick={onToggleSetup}
            className="rounded-full border border-slate-900/12 bg-white/85 px-4 py-2 text-sm font-medium text-slate-800 transition hover:bg-white"
          >
            {isSetupOpen ? 'Hide setup' : 'Quick setup'}
          </button>
        </div>
      </div>
    </section>
  );
}
