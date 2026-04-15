import React from 'react';

export default function HeroCard({
  platform,
  deviceId,
  changeCount,
  activeEventCount,
}) {
  return (
    <section className="flex flex-col justify-center rounded-[28px] border border-slate-900/8 bg-white/70 p-10 shadow-[0_24px_70px_rgba(36,52,89,0.12)] backdrop-blur-md">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
        Local-first calendar foundation
      </p>
      <h1 className="text-4xl font-semibold tracking-tight text-slate-900 md:text-6xl md:leading-none">
        Each device owns its calendar
      </h1>
      <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600">
        Events now live in a local store beside an append-only change log.
        That gives us the right base for peer sync, pairing, and relay support later.
      </p>
      <div className="mt-7 flex flex-wrap gap-3">
        <span className="rounded-2xl border border-slate-900/6 bg-white/85 px-4 py-3 text-sm text-slate-700">Platform: {platform}</span>
        <span className="rounded-2xl border border-slate-900/6 bg-white/85 px-4 py-3 text-sm text-slate-700">Events: {activeEventCount}</span>
        <span className="rounded-2xl border border-slate-900/6 bg-white/85 px-4 py-3 text-sm text-slate-700">Changes: {changeCount}</span>
        <span className="rounded-2xl border border-slate-900/6 bg-white/85 px-4 py-3 text-sm text-slate-700">Device: {deviceId ? deviceId.slice(0, 12) : 'loading'}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        <span className="rounded-2xl border border-slate-900/6 bg-white/85 px-4 py-3 text-sm text-slate-700">Offline-first state</span>
        <span className="rounded-2xl border border-slate-900/6 bg-white/85 px-4 py-3 text-sm text-slate-700">Append-only sync log</span>
        <span className="rounded-2xl border border-slate-900/6 bg-white/85 px-4 py-3 text-sm text-slate-700">Peer sync ready</span>
      </div>
    </section>
  );
}
