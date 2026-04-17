import React from 'react';

export default function HeroCard({
  platform,
  deviceId,
  changeCount,
  activeEventCount,
  security,
}) {
  const providerCount = security?.auth?.providers?.length || 0;
  const configuredProviders =
    security?.auth?.providers?.filter((provider) => provider.configured).length || 0;
  const connectedAccounts = security?.auth?.connectedAccounts?.length || 0;
  const trustedDeviceCount = security?.devices?.trustedDeviceCount || 0;
  const auditEventCount = security?.audit?.eventCount || 0;
  const vaultMode = security?.storage?.vault?.protectionMode || 'loading';
  const hostedStatus = security?.hosted?.connectionStatus || 'disconnected';
  const hostedCursor = security?.hosted?.serverCursor || 0;

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
        <span className="app-pill">Platform: {platform}</span>
        <span className="app-pill">Events: {activeEventCount}</span>
        <span className="app-pill">Changes: {changeCount}</span>
        <span className="app-pill">Device: {deviceId ? deviceId.slice(0, 12) : 'loading'}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        <span className="app-pill">Vault: {vaultMode}</span>
        <span className="app-pill">Trusted devices: {trustedDeviceCount}</span>
        <span className="app-pill">Audit events: {auditEventCount}</span>
        <span className="app-pill">Providers configured: {configuredProviders}/{providerCount}</span>
        <span className="app-pill">Connected accounts: {connectedAccounts}</span>
        <span className="app-pill">Hosted sync: {hostedStatus}</span>
        <span className="app-pill">Hosted cursor: {hostedCursor}</span>
      </div>
    </section>
  );
}
