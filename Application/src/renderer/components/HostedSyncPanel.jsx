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
      <span className="text-sm font-medium app-text-muted">{field.label}</span>
      <input
        type={isSecret ? 'password' : 'text'}
        value={value}
        onChange={(event) => onChange(field.key, event.target.value)}
        placeholder={field.defaultValue}
        className="app-input rounded-2xl px-4 py-3 text-sm"
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
    <section className="settings-card settings-card--full">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="settings-section-eyebrow">
            Optional hosted backend
          </p>
          <h3 className="settings-card-title">
            Self-hosted sync with SelfHdb
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 app-text-muted">
            The desktop app stays local-first. Hosted mode only adds account sign-in and sync
            against your own PHP backend.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="app-pill">
            Status: {hosted?.connectionStatus || 'disconnected'}
          </span>
          <span className="app-pill">
            Cursor: {hosted?.serverCursor || 0}
          </span>
        </div>
      </div>

      <div className="mt-5 grid gap-3 xl:grid-cols-2">
        <div className="settings-subcard">
          <h4 className="m-0 text-lg font-semibold text-[var(--text-primary)]">Connect this app</h4>
          <p className="mt-2 text-sm leading-6 app-text-muted">
            These fields are only for the app to reach your hosted API. The app never connects
            directly to MySQL.
          </p>

          <div className="mt-4 grid gap-3">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium app-text-muted">Backend URL</span>
              <input
                type="url"
                value={hostedUrl}
                onChange={(event) => onHostedUrlChange(event.target.value)}
                placeholder="https://calendar.example.com/selfhdb"
                className="app-input rounded-2xl px-4 py-3 text-sm"
              />
              <span className="text-xs leading-5 app-text-soft">
                Use the public URL where SelfHdb responds to <code>/v1/health</code>.
              </span>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium app-text-muted">Email</span>
              <input
                type="email"
                value={hostedEmail}
                onChange={(event) => onHostedEmailChange(event.target.value)}
                placeholder="you@example.com"
                className="app-input rounded-2xl px-4 py-3 text-sm"
              />
              <span className="text-xs leading-5 app-text-soft">
                This is the account you create or use on your SelfHdb server.
              </span>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium app-text-muted">Password</span>
              <input
                type="password"
                value={hostedPassword}
                onChange={(event) => onHostedPasswordChange(event.target.value)}
                placeholder="Enter your SelfHdb password"
                className="app-input rounded-2xl px-4 py-3 text-sm"
              />
              <span className="text-xs leading-5 app-text-soft">
                Stored only for the sign-in action. Session tokens stay local after login.
              </span>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium app-text-muted">Device name</span>
              <input
                type="text"
                value={hostedDeviceName}
                onChange={(event) => onHostedDeviceNameChange(event.target.value)}
                placeholder="Optional: Work laptop"
                className="app-input rounded-2xl px-4 py-3 text-sm"
              />
              <span className="text-xs leading-5 app-text-soft">
                Helpful when you later review trusted devices on the backend.
              </span>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onTestConnection}
              disabled={!canTestConnection}
              className="app-button app-button--secondary"
            >
              {busyAction === 'test-connection' ? 'Checking...' : 'Test connection'}
            </button>
            <button
              type="button"
              onClick={onRegister}
              disabled={!canAttemptAuth}
              className="app-button app-button--secondary"
            >
              {busyAction === 'register' ? 'Creating...' : 'Register'}
            </button>
            <button
              type="button"
              onClick={onSignIn}
              disabled={!canAttemptAuth}
              className="app-button app-button--primary"
            >
              {busyAction === 'login' ? 'Signing in...' : 'Sign in'}
            </button>
            <button
              type="button"
              onClick={onSyncNow}
              disabled={!isConnected || Boolean(busyAction)}
              className="app-button app-button--secondary"
            >
              {busyAction === 'sync' ? 'Syncing...' : 'Sync now'}
            </button>
            <button
              type="button"
              onClick={onDisconnect}
              disabled={(!hosted?.enabled && !isConnected) || Boolean(busyAction)}
              className="app-button app-button--secondary"
            >
              {busyAction === 'disconnect' ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
        </div>

        <div className="settings-subcard">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="m-0 text-lg font-semibold text-[var(--text-primary)]">SelfHdb .env maker</h4>
              <p className="mt-2 text-sm leading-6 app-text-muted">
                This builds the server-side environment file for your PHP host. It is not used by
                the client at runtime.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onExportEnv(envValues)}
              disabled={!canExportEnv}
              className="app-button app-button--primary"
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
        <div className="settings-subcard settings-subcard--compact">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] app-text-soft">
            Active URL
          </p>
          <p className="mt-2 break-all text-sm text-[var(--text-primary)]">
            {hosted?.baseUrl || 'Not configured'}
          </p>
        </div>
        <div className="settings-subcard settings-subcard--compact">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] app-text-soft">
            Signed in as
          </p>
          <p className="mt-2 text-sm text-[var(--text-primary)]">
            {hosted?.accountEmail || 'Not signed in'}
          </p>
        </div>
        <div className="settings-subcard settings-subcard--compact">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] app-text-soft">
            Last sync
          </p>
          <p className="mt-2 text-sm text-[var(--text-primary)]">{formatDateTime(hosted?.lastSyncedAt)}</p>
        </div>
        <div className="settings-subcard settings-subcard--compact">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] app-text-soft">
            Auth mode
          </p>
          <p className="mt-2 text-sm text-[var(--text-primary)]">
            {hosted?.authMode || hosted?.enabledProviders?.join(', ') || 'Not detected yet'}
          </p>
        </div>
      </div>

      <div className="settings-subcard mt-5">
        <h4 className="m-0 text-lg font-semibold text-[var(--text-primary)]">Quick setup tutorial</h4>
        <p className="mt-2 text-sm leading-6 app-text-muted">
          Built for normal PHP hosting and cPanel. These steps are enough for a first deployment.
        </p>
        <ol className="mt-4 ml-5 grid gap-2 text-sm leading-6 text-[var(--text-primary)]">
          {tutorialSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>

      {statusMessage ? (
        <p className="settings-feedback settings-feedback--warning">
          {statusMessage}
        </p>
      ) : null}

      {hosted?.lastError ? (
        <p className="settings-feedback settings-feedback--danger">
          {hosted.lastError}
        </p>
      ) : null}

      <p className="mt-4 text-xs leading-6 app-text-soft">
        HTTPS is expected for real deployments. Plain HTTP should only be used for localhost
        testing while you bring the backend up.
      </p>
    </section>
  );
}
