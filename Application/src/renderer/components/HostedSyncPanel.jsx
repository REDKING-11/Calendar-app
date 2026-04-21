import React, { useEffect, useMemo, useState } from 'react';
const {
  SELF_HDB_ENV_FIELD_DEFINITIONS,
  createDefaultSelfHdbEnvValues,
} = require('../../shared/selfhdb-setup');

const tutorialSteps = [
  'Upload the backend folder to your hosting account and point the site or subfolder web root at its public folder.',
  'Create a MySQL or MariaDB database and database user in cPanel, then put those cPanel MySQL credentials in the .env maker below.',
  'Save the exported .env file and place it in the backend root folder next to config and public.',
  'Import database/schema.sql once through phpMyAdmin or your host database tool.',
  'Open the hosted backend URL in a browser and check /v1/health when you want to verify the PHP API.',
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
  hostedUrl,
  onExportEnv,
  busyAction,
}) {
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
            cPanel / PHP backend
          </p>
          <h3 className="settings-card-title">
            Hosting .env maker
          </h3>
          <p className="mt-3 max-w-2xl text-sm leading-6 app-text-muted">
            Build the server-side environment file for your PHP host. Put your cPanel MySQL host,
            database name, username, and password here. The desktop app does not connect directly
            to MySQL.
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

      <div className="mt-5 grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
        {envGroups.map((group, groupIndex) => (
          <div key={groupIndex} className="settings-subcard grid gap-3">
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

      <div className="settings-subcard mt-5">
        <h4 className="m-0 text-lg font-semibold text-[var(--text-primary)]">Quick setup tutorial</h4>
        <p className="mt-2 text-sm leading-6 app-text-muted">
          Built for normal PHP hosting and cPanel. These steps only cover generating the server
          config file.
        </p>
        <ol className="mt-4 ml-5 grid gap-2 text-sm leading-6 text-[var(--text-primary)]">
          {tutorialSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>

      <p className="mt-4 text-xs leading-6 app-text-soft">
        HTTPS is expected for real deployments. Plain HTTP should only be used for localhost
        testing while you bring the backend up.
      </p>
    </section>
  );
}
