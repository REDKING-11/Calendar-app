import React, { useEffect, useMemo, useState } from 'react';
const {
  SELF_HDB_ENV_FIELD_DEFINITIONS,
  createDefaultSelfHdbEnvValues,
} = require('../../shared/selfhdb-setup');

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

const tutorialSteps = [
  'Upload the SelfHdb folder to your hosting account and point the site or subfolder web root at SelfHdb/public.',
  'Use the .env maker below, save the exported .env file, and place it in the SelfHdb root folder next to config and public.',
  'Create a MySQL or MariaDB database in cPanel and import SelfHdb/database/schema.sql once.',
  'Open your hosted URL and check /v1/health. If it responds, the PHP API is live.',
  'Back in the app, enter the backend URL, email, password, and an optional device name, then register or sign in.',
];

function EnvField({ field, value, onChange }) {
  const isSecret = field.key.includes('PASSWORD') || field.key.includes('SECRET');

  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-medium text-slate-700">{field.label}</span>
      <input
        type={isSecret ? 'password' : 'text'}
        value={value}
        onChange={(event) => onChange(field.key, event.target.value)}
        placeholder={field.defaultValue}
        className="rounded-2xl border border-slate-900/12 bg-white px-4 py-3 text-sm text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] outline-none transition focus:border-slate-900/25"
      />
    </label>
  );
}

export default function HostedSyncPanel({
  hosted,
  hostedUrl,
  onHostedUrlChange,
  hostedEmail,
  onHostedEmailChange,
  hostedPassword,
  onHostedPasswordChange,
  hostedDeviceName,
  onHostedDeviceNameChange,
  onTestConnection,
  onRegister,
  onSignIn,
  onSyncNow,
  onDisconnect,
  onExportEnv,
  busyAction,
  statusMessage,
}) {
  const isConnected = hosted?.connectionStatus === 'connected';
  const canAttemptAuth =
    hostedUrl.trim().length > 0 &&
    hostedEmail.trim().length > 0 &&
    hostedPassword.trim().length > 0 &&
    !busyAction;
  const canTestConnection = hostedUrl.trim().length > 0 && !busyAction;
  const canExportEnv = !busyAction;
  const [envValues, setEnvValues] = useState(() => createDefaultSelfHdbEnvValues(hostedUrl));

  useEffect(() => {
    setEnvValues((current) => {
      if (current.APP_URL && current.APP_URL !== hostedUrl) {
        return current;
      }

      return {
        ...current,
        APP_URL: hostedUrl,
      };
    });
  }, [hostedUrl]);

  const envGroups = useMemo(
    () => [
      SELF_HDB_ENV_FIELD_DEFINITIONS.slice(0, 5),
      SELF_HDB_ENV_FIELD_DEFINITIONS.slice(5, 11),
      SELF_HDB_ENV_FIELD_DEFINITIONS.slice(11, 15),
      SELF_HDB_ENV_FIELD_DEFINITIONS.slice(15),
    ],
    []
  );

  const handleEnvFieldChange = (key, value) => {
    setEnvValues((current) => ({
      ...current,
      [key]: value,
    }));
  };

  return (
    <section className="mt-6 rounded-[28px] border border-slate-900/8 bg-white/78 p-6 shadow-[0_20px_60px_rgba(36,52,89,0.12)] backdrop-blur-md">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
            Optional hosted backend
          </p>
          <h3 className="m-0 text-2xl font-semibold tracking-tight text-slate-900">
            Self-hosted sync with SelfHdb
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
            The desktop app stays local-first. Hosted mode only adds account sign-in and sync
            against your own PHP backend.
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

      <div className="mt-5 grid gap-3 xl:grid-cols-2">
        <div className="rounded-[24px] border border-slate-900/8 bg-slate-50/80 p-5">
          <h4 className="m-0 text-lg font-semibold text-slate-900">Connect this app</h4>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            These fields are only for the app to reach your hosted API. The app never connects
            directly to MySQL.
          </p>

          <div className="mt-4 grid gap-3">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-slate-700">Backend URL</span>
              <input
                type="url"
                value={hostedUrl}
                onChange={(event) => onHostedUrlChange(event.target.value)}
                placeholder="https://calendar.example.com/selfhdb"
                className="rounded-2xl border border-slate-900/12 bg-white px-4 py-3 text-sm text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] outline-none transition focus:border-slate-900/25"
              />
              <span className="text-xs leading-5 text-slate-500">
                Use the public URL where SelfHdb responds to <code>/v1/health</code>.
              </span>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-slate-700">Email</span>
              <input
                type="email"
                value={hostedEmail}
                onChange={(event) => onHostedEmailChange(event.target.value)}
                placeholder="you@example.com"
                className="rounded-2xl border border-slate-900/12 bg-white px-4 py-3 text-sm text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] outline-none transition focus:border-slate-900/25"
              />
              <span className="text-xs leading-5 text-slate-500">
                This is the account you create or use on your SelfHdb server.
              </span>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-slate-700">Password</span>
              <input
                type="password"
                value={hostedPassword}
                onChange={(event) => onHostedPasswordChange(event.target.value)}
                placeholder="Enter your SelfHdb password"
                className="rounded-2xl border border-slate-900/12 bg-white px-4 py-3 text-sm text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] outline-none transition focus:border-slate-900/25"
              />
              <span className="text-xs leading-5 text-slate-500">
                Stored only for the sign-in action. Session tokens stay local after login.
              </span>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-slate-700">Device name</span>
              <input
                type="text"
                value={hostedDeviceName}
                onChange={(event) => onHostedDeviceNameChange(event.target.value)}
                placeholder="Optional: Work laptop"
                className="rounded-2xl border border-slate-900/12 bg-white px-4 py-3 text-sm text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] outline-none transition focus:border-slate-900/25"
              />
              <span className="text-xs leading-5 text-slate-500">
                Helpful when you later review trusted devices on the backend.
              </span>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onTestConnection}
              disabled={!canTestConnection}
              className="rounded-full border border-slate-900/12 bg-white px-4 py-3 text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busyAction === 'test-connection' ? 'Checking...' : 'Test connection'}
            </button>
            <button
              type="button"
              onClick={onRegister}
              disabled={!canAttemptAuth}
              className="rounded-full border border-slate-900/12 bg-white px-4 py-3 text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busyAction === 'register' ? 'Creating...' : 'Register'}
            </button>
            <button
              type="button"
              onClick={onSignIn}
              disabled={!canAttemptAuth}
              className="rounded-full border border-slate-900/12 bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busyAction === 'login' ? 'Signing in...' : 'Sign in'}
            </button>
            <button
              type="button"
              onClick={onSyncNow}
              disabled={!isConnected || Boolean(busyAction)}
              className="rounded-full border border-slate-900/12 bg-white px-4 py-3 text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busyAction === 'sync' ? 'Syncing...' : 'Sync now'}
            </button>
            <button
              type="button"
              onClick={onDisconnect}
              disabled={(!hosted?.enabled && !isConnected) || Boolean(busyAction)}
              className="rounded-full border border-slate-900/12 bg-white px-4 py-3 text-sm font-medium text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busyAction === 'disconnect' ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
        </div>

        <div className="rounded-[24px] border border-slate-900/8 bg-slate-50/80 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="m-0 text-lg font-semibold text-slate-900">SelfHdb .env maker</h4>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                This builds the server-side environment file for your PHP host. It is not used by
                the client at runtime.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onExportEnv(envValues)}
              disabled={!canExportEnv}
              className="rounded-full border border-slate-900/12 bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busyAction === 'export-env' ? 'Exporting...' : 'Export .env'}
            </button>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {envGroups.map((group, groupIndex) => (
              <div key={groupIndex} className="grid gap-3">
                {group.map((field) => (
                  <EnvField
                    key={field.key}
                    field={field}
                    value={envValues[field.key] || ''}
                    onChange={handleEnvFieldChange}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
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
            {hosted?.accountEmail || 'Not signed in'}
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
            Auth mode
          </p>
          <p className="mt-2 text-sm text-slate-700">
            {hosted?.authMode || hosted?.enabledProviders?.join(', ') || 'Not detected yet'}
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-[24px] border border-slate-900/8 bg-slate-50/80 p-5">
        <h4 className="m-0 text-lg font-semibold text-slate-900">Quick setup tutorial</h4>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Built for normal PHP hosting and cPanel. These steps are enough for a first deployment.
        </p>
        <ol className="mt-4 ml-5 grid gap-2 text-sm leading-6 text-slate-700">
          {tutorialSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
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
        HTTPS is expected for real deployments. Plain HTTP should only be used for localhost
        testing while you bring the backend up.
      </p>
    </section>
  );
}
