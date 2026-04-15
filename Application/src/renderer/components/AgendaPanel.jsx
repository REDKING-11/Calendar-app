import React from 'react';

export default function AgendaPanel({ days, onCreateEvent }) {
  return (
    <section className="rounded-[28px] border border-slate-900/8 bg-white/70 p-7 shadow-[0_24px_70px_rgba(36,52,89,0.12)] backdrop-blur-md">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">This week</p>
          <h2 className="text-3xl font-semibold tracking-tight text-slate-900">Upcoming focus</h2>
        </div>
        <button
          type="button"
          onClick={() => onCreateEvent?.(new Date())}
          className="rounded-full bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          Add event
        </button>
      </div>

      <div className="mt-6 grid gap-4">
        {days.length > 0 ? (
          days.map((item, index) => (
            <article
              className="grid items-center gap-4 rounded-2xl border border-slate-900/6 bg-white/85 px-4 py-3 md:grid-cols-[72px_72px_1fr]"
              key={`${item.day}-${item.date}-${index}`}
            >
              <p className="m-0 font-semibold text-slate-500">{item.day}</p>
              <p className="m-0 text-3xl font-bold text-slate-900">{item.date}</p>
              <p className="m-0 text-slate-600">{item.focus}</p>
            </article>
          ))
        ) : (
          <article className="rounded-2xl border border-slate-900/6 bg-white/85 px-4 py-3 text-slate-600">
            <p>No events yet. Add one and it will be recorded locally with a syncable change entry.</p>
          </article>
        )}
      </div>
    </section>
  );
}
