import React from 'react';

function formatDateTime(value) {
  if (!value) {
    return 'Not yet';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

export default function HostedSyncPanel({
  hosted,
  hostedUrl,
  onHostedUrlChange,
  onStartConnect,
  onPollAuth,
  onSyncNow,
  onDisconnect,
  busyAction,
  statusMessage,
}) {
  const enabledProviders = hosted?.enabledProviders || [];
  const isPending = hosted?.connectionStatus === 'pending_auth';
  const isConnected = hosted?.connectionStatus === 'connected';
  const canStart = hostedUrl.trim().length > 0 && !busyAction;

  return (
    <section className="mt-6 rounded-[28px] border border-slate-900/8 bg-white/78 p-6 shadow-[0_20px_60px_rgba(36,52,89,0.12)] backdrop-blur-md">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
            Optional hosted backend
          </p>
          <h3 className="m-0 text-2xl font-semibold tracking-tight text-slate-900">
            Keep your calendar online 24/7
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
            This stays opt-in. Your local encrypted store still works by itself, and hosted mode
            just adds signed push/pull sync against your own backend.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-slate-900/10 bg-white/90 px-3 py-2 text-sm text-slate-700">
            Status: {hosted?.connectionStatus || 'disconnected'}
          </span>
          <span className="rounded-full border border-slate-900/10 bg-white/90 px-3 py-2 text-sm text-slate-700">
            Cursor: {hosted?.serverCursor || 0}
          </span>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-slate-700">Backend URL</span>
          <input
            type="url"
            value={hostedUrl}
            onChange={(event) => onHostedUrlChange(event.target.value)}
            placeholder="https://calendar.example.com"
            className="rounded-2xl border border-slate-900/12 bg-white px-4 py-3 text-sm text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] outline-none transition focus:border-slate-900/25"
          />
        </label>

        <div className="flex flex-wrap items-end gap-2">
          <button
            type="button"
            onClick={() => onStartConnect('google')}
            disabled={!canStart}
            className="rounded-full border border-slate-900/12 bg-white px-4 py-3 text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busyAction === 'connect-google' ? 'Opening...' : 'Google sign-in'}
          </button>
          <button
            type="button"
            onClick={() => onStartConnect('microsoft')}
            disabled={!canStart}
            className="rounded-full border border-slate-900/12 bg-white px-4 py-3 text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busyAction === 'connect-microsoft' ? 'Opening...' : 'Microsoft sign-in'}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onPollAuth}
          disabled={!isPending || Boolean(busyAction)}
          className="rounded-full border border-slate-900/12 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busyAction === 'finish-auth' ? 'Checking...' : 'Finish sign-in'}
        </button>
        <button
          type="button"
          onClick={onSyncNow}
          disabled={!isConnected || Boolean(busyAction)}
          className="rounded-full border border-slate-900/12 bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busyAction === 'sync' ? 'Syncing...' : 'Sync now'}
        </button>
        <button
          type="button"
          onClick={onDisconnect}
          disabled={(!hosted?.enabled && !isConnected && !isPending) || Boolean(busyAction)}
          className="rounded-full border border-slate-900/12 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busyAction === 'disconnect' ? 'Disconnecting...' : 'Disconnect'}
        </button>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-900/8 bg-slate-50/80 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Active URL
          </p>
          <p className="mt-2 break-all text-sm text-slate-700">
            {hosted?.baseUrl || 'Not configured'}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-900/8 bg-slate-50/80 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Signed in as
          </p>
          <p className="mt-2 text-sm text-slate-700">
            {hosted?.accountEmail || hosted?.displayName || 'Not signed in'}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-900/8 bg-slate-50/80 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Last sync
          </p>
          <p className="mt-2 text-sm text-slate-700">{formatDateTime(hosted?.lastSyncedAt)}</p>
        </div>
        <div className="rounded-2xl border border-slate-900/8 bg-slate-50/80 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Backend providers
          </p>
          <p className="mt-2 text-sm text-slate-700">
            {enabledProviders.length > 0 ? enabledProviders.join(', ') : 'Not detected yet'}
          </p>
        </div>
      </div>

      {statusMessage ? (
        <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {statusMessage}
        </p>
      ) : null}

      {hosted?.lastError ? (
        <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {hosted.lastError}
        </p>
      ) : null}

      <p className="mt-4 text-xs leading-6 text-slate-500">
        HTTPS is expected for real deployments. Plain HTTP should only be used for local testing on
        localhost.
      </p>
    </section>
  );
}
