import React from 'react';

export default function UpcomingPopover({ items, onClose, onSelectItem }) {
  return (
    <section className="upcoming-popover">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
            Quick view
          </p>
          <h2 className="m-0 text-2xl font-semibold text-slate-900">What&apos;s up next</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-slate-900/12 bg-white/85 px-3 py-2 text-sm text-slate-700 transition hover:bg-white"
        >
          Close
        </button>
      </div>

      <div className="grid gap-3">
        {items.length > 0 ? (
          items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="grid gap-1 rounded-2xl border border-slate-900/6 bg-white/90 px-4 py-3 text-left transition hover:bg-white"
              onClick={() => onSelectItem(item)}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-slate-500">
                  {item.day} {item.date}
                </span>
                <span className="text-sm text-slate-500">{item.time}</span>
              </div>
              <p className="m-0 text-base font-medium text-slate-900">{item.focus}</p>
            </button>
          ))
        ) : (
          <div className="rounded-2xl border border-slate-900/6 bg-white/90 px-4 py-3 text-slate-600">
            Nothing scheduled yet.
          </div>
        )}
      </div>
    </section>
  );
}
