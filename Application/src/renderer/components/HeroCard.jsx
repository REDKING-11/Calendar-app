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
    <section className="flex flex-col justify-center rounded-[28px] border border-slate-900/8 bg-white/70 p-10 shadow-[0_24px_70px_rgba(36,52,89,0.12)] backdrop-blur-md">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
        Secure local-first calendar
      </p>
      <h1 className="text-4xl font-semibold tracking-tight text-slate-900 md:text-6xl md:leading-none">
        Each device owns its encrypted calendar
      </h1>
      <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600">
        Events now live in a SQLite-backed local store with encrypted content, a signed append-only
        change log, and OS-protected key material. Hosted sync is optional, so the app can stay
        local-first or connect to your own backend when you want always-on availability.
      </p>
      <div className="mt-7 flex flex-wrap gap-3">
        <span className="rounded-2xl border border-slate-900/6 bg-white/85 px-4 py-3 text-sm text-slate-700">Platform: {platform}</span>
        <span className="rounded-2xl border border-slate-900/6 bg-white/85 px-4 py-3 text-sm text-slate-700">Events: {activeEventCount}</span>
        <span className="rounded-2xl border border-slate-900/6 bg-white/85 px-4 py-3 text-sm text-slate-700">Changes: {changeCount}</span>
        <span className="rounded-2xl border border-slate-900/6 bg-white/85 px-4 py-3 text-sm text-slate-700">Device: {deviceId ? deviceId.slice(0, 12) : 'loading'}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        <span className="rounded-2xl border border-slate-900/6 bg-white/85 px-4 py-3 text-sm text-slate-700">Vault: {vaultMode}</span>
        <span className="rounded-2xl border border-slate-900/6 bg-white/85 px-4 py-3 text-sm text-slate-700">Trusted devices: {trustedDeviceCount}</span>
        <span className="rounded-2xl border border-slate-900/6 bg-white/85 px-4 py-3 text-sm text-slate-700">Audit events: {auditEventCount}</span>
        <span className="rounded-2xl border border-slate-900/6 bg-white/85 px-4 py-3 text-sm text-slate-700">Providers configured: {configuredProviders}/{providerCount}</span>
        <span className="rounded-2xl border border-slate-900/6 bg-white/85 px-4 py-3 text-sm text-slate-700">Connected accounts: {connectedAccounts}</span>
        <span className="rounded-2xl border border-slate-900/6 bg-white/85 px-4 py-3 text-sm text-slate-700">Hosted sync: {hostedStatus}</span>
        <span className="rounded-2xl border border-slate-900/6 bg-white/85 px-4 py-3 text-sm text-slate-700">Hosted cursor: {hostedCursor}</span>
      </div>
    </section>
  );
}
