import React from 'react';
import HeroCard from './HeroCard';

export default function AboutDrawer({
  isOpen,
  onClose,
  platform,
  deviceId,
  changeCount,
  activeEventCount,
}) {
  return (
    <aside className={`about-drawer ${isOpen ? 'about-drawer--open' : ''}`} aria-hidden={!isOpen}>
      <section className="h-full overflow-auto rounded-l-[28px] border-l border-slate-900/8 bg-white/92 p-6 shadow-[0_24px_70px_rgba(36,52,89,0.18)] backdrop-blur-xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
              Learn more
            </p>
            <h2 className="m-0 text-3xl font-semibold tracking-tight text-slate-900">
              About this app
            </h2>
          </div>
          <button
            type="button"
            className="rounded-full border border-slate-900/12 bg-white/85 px-4 py-2.5 text-slate-800 transition hover:bg-white"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <HeroCard
          platform={platform}
          deviceId={deviceId}
          changeCount={changeCount}
          activeEventCount={activeEventCount}
        />
      </section>
    </aside>
  );
}
