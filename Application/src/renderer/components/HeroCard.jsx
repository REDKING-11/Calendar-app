import React from 'react';

export default function HeroCard({ activeEventCount, security }) {
  const vaultMode = security?.storage?.vault?.protectionMode || 'loading';
  const hostedStatus = security?.hosted?.connectionStatus || 'disconnected';

  return (
    <section className="hero-card flex flex-col justify-center p-10">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
        Secure local-first calendar
      </p>
      <h1 className="text-4xl font-semibold tracking-tight text-[var(--text-primary)] md:text-6xl md:leading-none">
        Each device owns its encrypted calendar
      </h1>
      <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--text-secondary)]">
        Events now live in a SQLite-backed local store with encrypted content, a signed append-only
        change log, and OS-protected key material. Hosted sync is optional, so the app can stay
        local-first or connect to your own backend when you want always-on availability.
      </p>
      <div className="mt-7 flex flex-wrap gap-3">
        <span className="app-pill">Events: {activeEventCount}</span>
        <span className="app-pill">Vault: {vaultMode}</span>
        <span className="app-pill">Hosted sync: {hostedStatus}</span>
      </div>
    </section>
  );
}
