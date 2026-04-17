import React from 'react';

export default function UpcomingPopover({ items, onClose, onSelectItem }) {
  return (
    <section className="upcoming-popover">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="settings-section-eyebrow">
            Quick view
          </p>
          <h2 className="m-0 text-2xl font-semibold text-[var(--text-primary)]">What&apos;s up next</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="app-button app-button--secondary"
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
              className="upcoming-item grid gap-1 rounded-2xl px-4 py-3 text-left transition"
              onClick={() => onSelectItem(item)}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold app-text-soft">
                  {item.day} {item.date}
                </span>
                <span className="text-sm app-text-soft">{item.time}</span>
              </div>
              <p className="m-0 text-base font-medium text-[var(--text-primary)]">{item.focus}</p>
            </button>
          ))
        ) : (
          <div className="upcoming-empty rounded-2xl px-4 py-3 app-text-muted">
            Nothing scheduled yet.
          </div>
        )}
      </div>
    </section>
  );
}
