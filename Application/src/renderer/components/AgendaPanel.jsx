import React from 'react';

export default function AgendaPanel({ days, onCreateEvent }) {
  return (
    <section className="app-panel rounded-[28px] p-7">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="settings-section-eyebrow">This week</p>
          <h2 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">Upcoming focus</h2>
        </div>
        <button
          type="button"
          onClick={() => onCreateEvent?.(new Date())}
          className="app-button app-button--primary"
        >
          Add event
        </button>
      </div>

      <div className="mt-6 grid gap-4">
        {days.length > 0 ? (
          days.map((item, index) => (
            <article
              className="app-subsurface grid items-center gap-4 rounded-2xl px-4 py-3 md:grid-cols-[72px_72px_1fr]"
              key={`${item.day}-${item.date}-${index}`}
            >
              <p className="m-0 font-semibold app-text-soft">{item.day}</p>
              <p className="m-0 text-3xl font-bold text-[var(--text-primary)]">{item.date}</p>
              <p className="m-0 app-text-muted">{item.focus}</p>
            </article>
          ))
        ) : (
          <article className="app-subsurface rounded-2xl px-4 py-3 app-text-muted">
            <p>No events yet. Add one and it will be recorded locally with a syncable change entry.</p>
          </article>
        )}
      </div>
    </section>
  );
}
