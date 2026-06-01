import React, { useEffect, useMemo, useState } from 'react';
import ConnectedAccountsPanel from './ConnectedAccountsPanel';
import HostedSyncPanel from './HostedSyncPanel';
import {
  detectCountryCode,
  getCountryTimezones,
  getDefaultCountryOptions,
  hasCountryTimezoneMapping,
  mergeCountryOptions,
} from '../setup-options';
import { updatePreference } from '../preferences';
import { isValidEmailAddress, normalizeEmailAddress } from '../eventDraft';

function ThemePreview({ label, themeClass, isActive, onClick, description }) {
  return (
    <button
      type="button"
      className={`theme-preview ${isActive ? 'theme-preview--active' : ''}`}
      onClick={onClick}
    >
      <div className={`theme-preview-swatch ${themeClass}`} />
      <div className="text-left">
        <strong className="block text-sm text-[var(--text-primary)]">{label}</strong>
        <span className="text-xs text-[var(--text-secondary)]">{description}</span>
      </div>
    </button>
  );
}

function SettingsCard({ eyebrow, title, description, children }) {
  return (
    <section className="settings-card">
      <p className="settings-section-eyebrow">{eyebrow}</p>
      <h2 className="settings-card-title">{title}</h2>
      {description ? <p className="settings-card-copy">{description}</p> : null}
      <div className="settings-card-content">{children}</div>
    </section>
  );
}

function AppInfoCard({ snapshot, effectiveTheme, preferences }) {
  return (
    <SettingsCard
      eyebrow="App info"
      title="Support and environment"
      description="A quick read-only summary of the current app state and configuration."
    >
      <div className="settings-info-list">
        <div className="settings-info-row">
          <span>Current theme</span>
          <strong>{effectiveTheme}</strong>
        </div>
        <div className="settings-info-row">
          <span>Default view</span>
          <strong>{preferences.defaultView}</strong>
        </div>
        <div className="settings-info-row">
          <span>Device</span>
          <strong>{snapshot?.deviceId || 'Loading'}</strong>
        </div>
        <div className="settings-info-row">
          <span>Active events</span>
          <strong>{snapshot?.stats?.activeEventCount || 0}</strong>
        </div>
        <div className="settings-info-row">
          <span>Stored changes</span>
          <strong>{snapshot?.stats?.changeCount || 0}</strong>
        </div>
        <div className="settings-info-row">
          <span>Hosted state</span>
          <strong>{snapshot?.security?.hosted?.connectionStatus || 'disconnected'}</strong>
        </div>
      </div>
    </SettingsCard>
  );
}

const SHARE_PRIVACY_OPTIONS = [
  { id: 'busy_only', label: 'Busy only' },
  { id: 'titles_only', label: 'Titles only' },
  { id: 'full_details', label: 'Full details' },
];

function HostedSharePanel({
  hosted,
  externalCalendarSources = [],
  onListShares,
  onCreateShare,
  onRevokeShare,
  onPublishShare,
}) {
  const [shares, setShares] = useState([]);
  const [draft, setDraft] = useState({
    name: 'Shared availability',
    privacyLevel: 'busy_only',
    calendarIds: [],
    dateFrom: '',
    dateTo: '',
    expiresAt: '',
  });
  const [busyAction, setBusyAction] = useState('');
  const [message, setMessage] = useState('');
  const hostedConnected = hosted?.connectionStatus === 'connected';
  const calendars = [
    { id: 'local', label: 'Local calendar', provider: 'local' },
    ...externalCalendarSources.map((source) => ({
      id: source.sourceId,
      label: source.displayName || source.remoteCalendarId || 'Provider calendar',
      provider: source.provider,
    })),
  ];

  const refreshShares = async () => {
    if (!hostedConnected || !onListShares) {
      return;
    }
    setBusyAction('list');
    setMessage('');
    try {
      const result = await onListShares();
      setShares(result?.shares || []);
    } catch (error) {
      setMessage(error?.message || 'Shared calendars could not be loaded.');
    } finally {
      setBusyAction('');
    }
  };

  useEffect(() => {
    refreshShares();
  }, [hostedConnected]);

  const toggleCalendar = (calendarId) => {
    setDraft((current) => {
      const selected = new Set(current.calendarIds);
      if (selected.has(calendarId)) {
        selected.delete(calendarId);
      } else {
        selected.add(calendarId);
      }
      return { ...current, calendarIds: Array.from(selected) };
    });
  };

  const buildShareInput = () => ({
    name: draft.name,
    privacyLevel: draft.privacyLevel,
    expiresAt: draft.expiresAt || null,
    scope: {
      calendarIds: draft.calendarIds,
      dateFrom: draft.dateFrom || null,
      dateTo: draft.dateTo || null,
      includePrivate: false,
    },
  });

  const handleCreate = async () => {
    setBusyAction('create');
    setMessage('');
    try {
      const share = await onCreateShare?.(buildShareInput());
      setShares((current) => [share, ...current]);
      setMessage(share?.url ? `Share link created: ${share.url}` : 'Share link created.');
    } catch (error) {
      setMessage(error?.message || 'Share link could not be created.');
    } finally {
      setBusyAction('');
    }
  };

  const handlePublish = async (share) => {
    setBusyAction(`publish:${share.id}`);
    setMessage('');
    try {
      const updated = await onPublishShare?.({
        shareId: share.id,
        privacyLevel: share.privacyLevel,
        scope: share.scope || {},
      });
      setShares((current) =>
        current.map((item) => (item.id === updated.id ? { ...updated, url: updated.url || item.url } : item))
      );
      setMessage('Shared calendar published.');
    } catch (error) {
      setMessage(error?.message || 'Shared calendar could not be published.');
    } finally {
      setBusyAction('');
    }
  };

  const handleRevoke = async (share) => {
    setBusyAction(`revoke:${share.id}`);
    setMessage('');
    try {
      const updated = await onRevokeShare?.(share.id);
      setShares((current) =>
        current.map((item) => (item.id === updated.id ? { ...updated, url: updated.url || item.url } : item))
      );
      setMessage('Share link revoked.');
    } catch (error) {
      setMessage(error?.message || 'Share link could not be revoked.');
    } finally {
      setBusyAction('');
    }
  };

  if (!hostedConnected) {
    return (
      <div className="settings-subcard">
        <p className="settings-stat-label">Hosted sharing</p>
        <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
          Sign in to SelfHdb hosted sync before creating public calendar view links.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="settings-subcard">
        <p className="settings-stat-label">New share link</p>
        <div className="settings-form-grid mt-3">
          <label className="settings-field">
            <span>Name</span>
            <input
              className="app-input"
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            />
          </label>
          <label className="settings-field">
            <span>Privacy</span>
            <select
              className="app-input"
              value={draft.privacyLevel}
              onChange={(event) =>
                setDraft((current) => ({ ...current, privacyLevel: event.target.value }))
              }
            >
              {SHARE_PRIVACY_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-field">
            <span>From</span>
            <input
              className="app-input"
              type="date"
              value={draft.dateFrom}
              onChange={(event) => setDraft((current) => ({ ...current, dateFrom: event.target.value }))}
            />
          </label>
          <label className="settings-field">
            <span>To</span>
            <input
              className="app-input"
              type="date"
              value={draft.dateTo}
              onChange={(event) => setDraft((current) => ({ ...current, dateTo: event.target.value }))}
            />
          </label>
          <label className="settings-field">
            <span>Expires</span>
            <input
              className="app-input"
              type="date"
              value={draft.expiresAt}
              onChange={(event) => setDraft((current) => ({ ...current, expiresAt: event.target.value }))}
            />
          </label>
        </div>
        <div className="share-calendar-picker">
          {calendars.map((calendar) => (
            <label key={calendar.id} className="settings-toggle settings-toggle--compact">
              <input
                type="checkbox"
                checked={draft.calendarIds.includes(calendar.id)}
                onChange={() => toggleCalendar(calendar.id)}
              />
              <span>{calendar.label}</span>
            </label>
          ))}
        </div>
        <p className="settings-field-copy">
          Leave all calendars unchecked to include every visible share-eligible calendar. Private/local-only events stay hidden.
        </p>
        <button
          type="button"
          className="app-button app-button--primary mt-3"
          disabled={busyAction === 'create'}
          onClick={handleCreate}
        >
          {busyAction === 'create' ? 'Creating...' : 'Create view link'}
        </button>
      </div>

      <div className="grid gap-2">
        {shares.map((share) => (
          <div key={share.id} className="settings-subcard">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="m-0 font-bold text-[var(--text-primary)]">{share.name}</p>
                <p className="notification-helper-copy m-0">
                  {share.privacyLevel} {share.revokedAt ? '- revoked' : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="app-button app-button--secondary"
                  disabled={Boolean(share.revokedAt) || busyAction === `publish:${share.id}`}
                  onClick={() => handlePublish(share)}
                >
                  {busyAction === `publish:${share.id}` ? 'Publishing...' : 'Publish now'}
                </button>
                <button
                  type="button"
                  className="app-button app-button--secondary"
                  disabled={Boolean(share.revokedAt) || busyAction === `revoke:${share.id}`}
                  onClick={() => handleRevoke(share)}
                >
                  {busyAction === `revoke:${share.id}` ? 'Revoking...' : 'Revoke'}
                </button>
              </div>
            </div>
            {share.url ? <p className="share-url">{share.url}</p> : null}
            <p className="notification-helper-copy m-0">
              Last published: {share.projectionUpdatedAt || 'not published yet'}
            </p>
          </div>
        ))}
        {shares.length === 0 ? (
          <p className="notification-helper-copy">No shared calendar links yet.</p>
        ) : null}
      </div>
      {message ? <p className="notification-helper-copy">{message}</p> : null}
    </div>
  );
}

function DeveloperDiagnosticsCard({ debugSnapshot }) {
  if (!debugSnapshot?.app?.developerMode) {
    return null;
  }

  const app = debugSnapshot.app;
  const ui = debugSnapshot.ui || {};
  const data = debugSnapshot.data || {};
  const integrations = debugSnapshot.integrations || {};
  const lastAppError = debugSnapshot.lastAppError || null;

  return (
    <SettingsCard
      eyebrow="Developer mode"
      title="Developer diagnostics"
      description="Hidden diagnostics for troubleshooting. Secrets and raw calendar content are not included."
    >
      <div className="settings-info-list">
        <div className="settings-info-row">
          <span>Window mode</span>
          <strong>{app.windowMode || 'unknown'}</strong>
        </div>
        <div className="settings-info-row">
          <span>Setup complete</span>
          <strong>{app.setupComplete ? 'yes' : 'no'}</strong>
        </div>
        <div className="settings-info-row">
          <span>Calendar view</span>
          <strong>{ui.calendarView || 'none'}</strong>
        </div>
        <div className="settings-info-row">
          <span>Events</span>
          <strong>{data.activeEvents || 0} active / {data.totalEvents || 0} total</strong>
        </div>
        <div className="settings-info-row">
          <span>Accounts</span>
          <strong>{integrations.connectedAccountCount || 0}</strong>
        </div>
        <div className="settings-info-row">
          <span>Hosted sync</span>
          <strong>{integrations.hostedSyncStatus || 'disconnected'}</strong>
        </div>
        <div className="settings-info-row">
          <span>Holiday preload</span>
          <strong>{integrations.holidayPreloadState?.status || 'idle'}</strong>
        </div>
        <div className="settings-info-row">
          <span>Last error</span>
          <strong>{lastAppError?.code || 'none'}</strong>
        </div>
      </div>
      {lastAppError?.message ? (
        <p className="settings-inline-warning mt-3">{lastAppError.message}</p>
      ) : null}
    </SettingsCard>
  );
}

function getImportFileName(filePath = '') {
  return String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || 'calendar file';
}

export default function SettingsWindow({
  snapshot,
  preferences,
  setPreferences,
  effectiveTheme,
  holidayPreloadState,
  onCountryChange,
  onImportHolidays,
  onImportCalendarFile,
  hosted,
  hostedUrl,
  onHostedUrlChange,
  hostedPassword,
  onHostedPasswordChange,
  onHostedTestConnection,
  onHostedRegister,
  onHostedSignIn,
  onSyncHostedNow,
  onDisconnectHostedSync,
  onExportHostedEnv,
  onListHostedShares,
  onCreateHostedShare,
  onRevokeHostedShare,
  onPublishHostedShare,
  hostedBusyAction,
  hostedStatusMessage,
  connectedAccounts = [],
  externalCalendarsByAccount = {},
  externalCalendarSources = [],
  externalCalendarBusyId = '',
  providers = [],
  oauthClientConfig = {},
  onConnectProvider,
  onSaveOAuthClientConfig,
  onLoadExternalCalendars,
  onImportExternalCalendar,
  onDisconnectAccount,
  onRevokeAccount,
  oauthBusyProvider = '',
  accountBusyId = '',
  oauthStatusMessage = '',
  debugSnapshot = null,
}) {
  const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const detectedCountryCode = detectCountryCode();
  const [notificationEmailMessage, setNotificationEmailMessage] = useState('');
  const [calendarImportMessage, setCalendarImportMessage] = useState('');
  const [isImportingCalendarFile, setIsImportingCalendarFile] = useState(false);
  const [countries, setCountries] = useState(() => getDefaultCountryOptions(detectedCountryCode));
  const allTimeZones = useMemo(() => {
    if (typeof Intl.supportedValuesOf === 'function') {
      return Intl.supportedValuesOf('timeZone');
    }

    return [detectedTimeZone];
  }, [detectedTimeZone]);

  useEffect(() => {
    let cancelled = false;

    const loadCountries = async () => {
      try {
        const nextCountries = await window.calendarApp.getHolidayCountries();
        if (!cancelled && Array.isArray(nextCountries)) {
          setCountries((current) => mergeCountryOptions(nextCountries, current));
        }
      } catch {
        // Keep defaults if loading fails.
      }
    };

    loadCountries();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    onCountryChange?.(preferences.countryCode);
  }, [preferences.countryCode, onCountryChange]);

  const filteredTimeZones = useMemo(
    () => getCountryTimezones(preferences.countryCode, allTimeZones),
    [allTimeZones, preferences.countryCode]
  );
  const hasMappedTimeZones = hasCountryTimezoneMapping(preferences.countryCode);

  const handleImportCalendarFile = async () => {
    if (!onImportCalendarFile) {
      setCalendarImportMessage('Calendar file import is not available in this window.');
      return;
    }

    setIsImportingCalendarFile(true);
    setCalendarImportMessage('');
    try {
      const result = await onImportCalendarFile();
      if (result?.canceled) {
        setCalendarImportMessage('');
        return;
      }

      const importedCount = Number(result?.importedCount || 0);
      const fileName = getImportFileName(result?.path);
      setCalendarImportMessage(
        `Imported ${importedCount} event${importedCount === 1 ? '' : 's'} from ${fileName}.`
      );
    } catch (error) {
      setCalendarImportMessage(error?.message || 'Calendar file could not be imported.');
    } finally {
      setIsImportingCalendarFile(false);
    }
  };

  return (
    <main className="settings-shell">
      <div className="settings-page-hero">
        <div>
          <p className="eyebrow">Preferences</p>
          <h1 className="settings-page-title">Calendar settings</h1>
          <p className="settings-page-copy">
            Personalize the app, choose the look and feel, configure calendar defaults, and manage
            your SelfHdb sync in one place.
          </p>
        </div>
        <button
          type="button"
          className="app-button app-button--secondary"
          onClick={() => window.calendarApp.closeCurrentWindow()}
        >
          Close
        </button>
      </div>

      <div className="settings-section-grid">
        <SettingsCard
          eyebrow="Appearance"
          title="Theme and visual style"
          description="Pick a permanent look or let the app follow your system theme automatically."
        >
          <div className="theme-preview-grid">
            <ThemePreview
              label="Light"
              themeClass="theme-preview-swatch--light"
              isActive={preferences.themeMode === 'light'}
              onClick={() => updatePreference(setPreferences, { themeMode: 'light' })}
              description="Blue and white moving gradient"
            />
            <ThemePreview
              label="Dark"
              themeClass="theme-preview-swatch--dark"
              isActive={preferences.themeMode === 'dark'}
              onClick={() => updatePreference(setPreferences, { themeMode: 'dark' })}
              description="Dark gray base with a red gradient glow"
            />
            <ThemePreview
              label="System"
              themeClass="theme-preview-swatch--system"
              isActive={preferences.themeMode === 'system'}
              onClick={() => updatePreference(setPreferences, { themeMode: 'system' })}
              description={`Currently following ${effectiveTheme}`}
            />
          </div>
          <label className="settings-toggle mt-5">
            <input
              type="checkbox"
              checked={preferences.backgroundMotion !== false}
              onChange={(event) =>
                updatePreference(setPreferences, { backgroundMotion: event.target.checked })
              }
            />
            <span>Animated background</span>
          </label>
        </SettingsCard>

        <SettingsCard
          eyebrow="Profile & region"
          title="Name, country, timezone, holidays"
          description="These values drive friendly labels, timezone behavior, and holiday importing."
        >
          <div className="settings-form-grid">
            <label className="settings-field">
              <span>Name</span>
              <input
                type="text"
                className="app-input"
                value={preferences.name}
                placeholder="Optional"
                onChange={(event) => updatePreference(setPreferences, { name: event.target.value })}
              />
            </label>
            <label className="settings-field">
              <span>Reminder recipient email</span>
              <input
                type="email"
                className="app-input"
                value={preferences.notificationEmail}
                placeholder="Optional"
                pattern="[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,63}"
                onChange={(event) => {
                  setNotificationEmailMessage('');
                  updatePreference(setPreferences, { notificationEmail: event.target.value });
                }}
                onBlur={(event) => {
                  const normalizedEmail = normalizeEmailAddress(event.target.value);
                  if (!normalizedEmail) {
                    setNotificationEmailMessage('');
                    updatePreference(setPreferences, { notificationEmail: '' });
                    return;
                  }

                  if (!isValidEmailAddress(normalizedEmail)) {
                    setNotificationEmailMessage(
                      'Enter a real email address, or leave this blank. It is optional.'
                    );
                    updatePreference(setPreferences, { notificationEmail: '' });
                    return;
                  }

                  setNotificationEmailMessage('');
                  updatePreference(setPreferences, { notificationEmail: normalizedEmail });
                }}
              />
              <small className="settings-field-copy">
                If you do not have a real email, leave this blank. It is optional.
              </small>
              {notificationEmailMessage ? (
                <small className="settings-inline-warning">{notificationEmailMessage}</small>
              ) : null}
            </label>
            <label className="settings-field">
              <span>Country</span>
              <select
                className="app-input"
                value={preferences.countryCode}
                onChange={(event) =>
                  updatePreference(setPreferences, { countryCode: event.target.value })
                }
              >
                <option value="">No country selected</option>
                {countries.map((country) => (
                  <option key={country.countryCode} value={country.countryCode}>
                    {country.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span>Timezone</span>
              <select
                className="app-input"
                value={preferences.timeZone}
                onChange={(event) =>
                  updatePreference(setPreferences, { timeZone: event.target.value })
                }
              >
                {filteredTimeZones.map((timeZone) => (
                  <option key={timeZone} value={timeZone}>
                    {timeZone}
                  </option>
                ))}
              </select>
            </label>
            <div className="settings-subcard">
              <p className="settings-stat-label">Holiday preload</p>
              <p className="settings-stat-value">
                {holidayPreloadState?.status === 'loading'
                  ? 'Preparing holiday data'
                  : holidayPreloadState?.status === 'ready'
                    ? 'Holiday data ready'
                    : holidayPreloadState?.status === 'error'
                      ? 'Holiday preload had an issue'
                      : 'Idle'}
              </p>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                {preferences.countryCode
                  ? hasMappedTimeZones
                    ? 'Timezone choices are filtered for the selected country.'
                    : 'This country uses the full timezone list because a local map is not available yet.'
                  : 'Pick a country to narrow timezones and prepare holiday imports.'}
              </p>
              <button
                type="button"
                className="app-button app-button--secondary mt-4"
                onClick={() =>
                  onImportHolidays?.({
                    countryCode: preferences.countryCode,
                    timeZone: preferences.timeZone,
                  })
                }
                disabled={!preferences.countryCode}
              >
                Import holidays now
              </button>
            </div>
          </div>
        </SettingsCard>

        <SettingsCard
          eyebrow="Accounts"
          title="Connected calendar accounts"
          description="Connect Google or Outlook only for online calendar features. A local file import does not need any account."
        >
          <ConnectedAccountsPanel
            connectedAccounts={connectedAccounts}
            externalCalendarsByAccount={externalCalendarsByAccount}
            externalCalendarSources={externalCalendarSources}
            externalCalendarBusyId={externalCalendarBusyId}
            providers={providers}
            oauthClientConfig={oauthClientConfig}
            onConnectProvider={onConnectProvider}
            onSaveOAuthClientConfig={onSaveOAuthClientConfig}
            onLoadExternalCalendars={onLoadExternalCalendars}
            onImportExternalCalendar={onImportExternalCalendar}
            onDisconnectAccount={onDisconnectAccount}
            onRevokeAccount={onRevokeAccount}
            oauthBusyProvider={oauthBusyProvider}
            accountBusyId={accountBusyId}
            oauthStatusMessage={oauthStatusMessage}
          />
        </SettingsCard>

        <SettingsCard
          eyebrow="Import"
          title="Calendar file import"
          description="Bring in a normal .ics calendar file or a Calendar App .json bundle from this computer. This does not sign in to Google, Outlook, Microsoft, or any online account."
        >
          <div className="settings-subcard">
            <p className="settings-stat-label">Local files only</p>
            <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
              Use this for exported calendars, downloaded .ics files, or Calendar App backups.
              Connected accounts are separate and only needed for online provider features.
            </p>
            <button
              type="button"
              className="app-button app-button--secondary mt-4"
              disabled={isImportingCalendarFile}
              onClick={handleImportCalendarFile}
            >
              {isImportingCalendarFile ? 'Importing calendar...' : 'Import calendar file'}
            </button>
            {calendarImportMessage ? (
              <p className="notification-helper-copy mt-3">{calendarImportMessage}</p>
            ) : null}
          </div>
        </SettingsCard>

        <SettingsCard
          eyebrow="Calendar preferences"
          title="How the calendar behaves"
          description="Choose the defaults the app should use when it opens and when you create new items."
        >
          <div className="settings-form-grid">
            <label className="settings-field">
              <span>Default view</span>
              <select
                className="app-input"
                value={preferences.defaultView}
                onChange={(event) =>
                  updatePreference(setPreferences, { defaultView: event.target.value })
                }
              >
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
                <option value="year">Year</option>
              </select>
            </label>
            <label className="settings-field">
              <span>Week starts on</span>
              <select
                className="app-input"
                value={preferences.weekStartsOn}
                onChange={(event) =>
                  updatePreference(setPreferences, { weekStartsOn: event.target.value })
                }
              >
                <option value="auto">Auto</option>
                <option value="monday">Monday</option>
                <option value="sunday">Sunday</option>
              </select>
            </label>
            <label className="settings-field">
              <span>Time format</span>
              <select
                className="app-input"
                value={preferences.timeFormat}
                onChange={(event) =>
                  updatePreference(setPreferences, { timeFormat: event.target.value })
                }
              >
                <option value="12h">12-hour</option>
                <option value="24h">24-hour</option>
              </select>
            </label>
            <label className="settings-field">
              <span>Calendar layout</span>
              <select
                className="app-input"
                value={preferences.calendarSplitMode || 'split'}
                onChange={(event) =>
                  updatePreference(setPreferences, { calendarSplitMode: event.target.value })
                }
              >
                <option value="split">Split visible calendars</option>
                <option value="combined">Combine calendars</option>
              </select>
              <small className="settings-field-copy">
                Split layout places visible calendars into side-by-side lanes for clearer busy views.
              </small>
            </label>
            <label className="settings-field">
              <span>Default event duration</span>
              <select
                className="app-input"
                value={preferences.defaultEventDuration}
                onChange={(event) =>
                  updatePreference(setPreferences, {
                    defaultEventDuration: Number(event.target.value),
                  })
                }
              >
                <option value="30">30 minutes</option>
                <option value="60">60 minutes</option>
                <option value="90">90 minutes</option>
                <option value="120">120 minutes</option>
              </select>
            </label>
            <label className="settings-field">
              <span>Default task duration</span>
              <select
                className="app-input"
                value={preferences.defaultTaskDuration}
                onChange={(event) =>
                  updatePreference(setPreferences, {
                    defaultTaskDuration: Number(event.target.value),
                  })
                }
              >
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="45">45 minutes</option>
                <option value="60">60 minutes</option>
              </select>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={preferences.showCompletedTasks}
                onChange={(event) =>
                  updatePreference(setPreferences, {
                    showCompletedTasks: event.target.checked,
                  })
                }
              />
              <span>Show completed tasks in calendar views</span>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={preferences.autoSaveToSelectedProviderCalendar !== false}
                onChange={(event) =>
                  updatePreference(setPreferences, {
                    autoSaveToSelectedProviderCalendar: event.target.checked,
                  })
                }
              />
              <span>Automatically save new events to the selected Google/Outlook calendar</span>
            </label>
            <p className="settings-field-copy m-0">
              When the sidebar Using calendar is Google or Outlook, new events are created on that
              provider calendar. Local calendar still saves locally.
            </p>
          </div>
        </SettingsCard>

        <HostedSyncPanel
          hosted={hosted}
          hostedUrl={hostedUrl}
          onHostedUrlChange={onHostedUrlChange}
          hostedEmail={preferences.hostedEmail}
          onHostedEmailChange={(value) => updatePreference(setPreferences, { hostedEmail: value })}
          hostedPassword={hostedPassword}
          onHostedPasswordChange={onHostedPasswordChange}
          hostedDeviceName={preferences.hostedDeviceName}
          onHostedDeviceNameChange={(value) =>
            updatePreference(setPreferences, { hostedDeviceName: value })
          }
          onTestConnection={onHostedTestConnection}
          onRegister={onHostedRegister}
          onSignIn={onHostedSignIn}
          onSyncNow={onSyncHostedNow}
          onDisconnect={onDisconnectHostedSync}
          onExportEnv={onExportHostedEnv}
          busyAction={hostedBusyAction}
          statusMessage={hostedStatusMessage}
        />

        <SettingsCard
          eyebrow="Sharing"
          title="Shared calendar view links"
          description="Create revocable hosted links that show a privacy-filtered generated calendar."
        >
          <HostedSharePanel
            hosted={hosted}
            externalCalendarSources={externalCalendarSources}
            onListShares={onListHostedShares}
            onCreateShare={onCreateHostedShare}
            onRevokeShare={onRevokeHostedShare}
            onPublishShare={onPublishHostedShare}
          />
        </SettingsCard>

        <AppInfoCard
          snapshot={snapshot}
          effectiveTheme={effectiveTheme}
          preferences={preferences}
        />

        <DeveloperDiagnosticsCard debugSnapshot={debugSnapshot} />
      </div>
    </main>
  );
}
