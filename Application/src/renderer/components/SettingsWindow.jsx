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

export default function SettingsWindow({
  snapshot,
  preferences,
  setPreferences,
  effectiveTheme,
  holidayPreloadState,
  onCountryChange,
  onImportHolidays,
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
  hostedBusyAction,
  hostedStatusMessage,
  connectedAccounts = [],
  providers = [],
  oauthClientConfig = {},
  onConnectProvider,
  onSaveOAuthClientConfig,
  onDisconnectAccount,
  onRevokeAccount,
  oauthBusyProvider = '',
  accountBusyId = '',
  oauthStatusMessage = '',
}) {
  const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const detectedCountryCode = detectCountryCode();
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
                onChange={(event) =>
                  updatePreference(setPreferences, { notificationEmail: event.target.value })
                }
              />
              <small className="settings-field-copy">
                Optional. One extra recipient for reminders, not a sending account.
              </small>
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
          description="Use Google and Outlook accounts for imports, reminders, and provider-backed event invites."
        >
          <ConnectedAccountsPanel
            connectedAccounts={connectedAccounts}
            providers={providers}
            oauthClientConfig={oauthClientConfig}
            onConnectProvider={onConnectProvider}
            onSaveOAuthClientConfig={onSaveOAuthClientConfig}
            onDisconnectAccount={onDisconnectAccount}
            onRevokeAccount={onRevokeAccount}
            oauthBusyProvider={oauthBusyProvider}
            accountBusyId={accountBusyId}
            oauthStatusMessage={oauthStatusMessage}
          />
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

        <AppInfoCard
          snapshot={snapshot}
          effectiveTheme={effectiveTheme}
          preferences={preferences}
        />
      </div>
    </main>
  );
}
