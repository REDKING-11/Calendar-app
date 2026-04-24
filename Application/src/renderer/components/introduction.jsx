import React, { useEffect, useMemo, useState } from 'react';
import ConnectedAccountsPanel from './ConnectedAccountsPanel';
import {
  detectCountryCode,
  getCountryTimezones,
  getDefaultCountryOptions,
  hasCountryTimezoneMapping,
  mergeCountryOptions,
} from '../setup-options';
import { isValidEmailAddress, normalizeEmailAddress } from '../eventDraft';

function getBackgroundStatusMessage(preloadState, activeCountryCode, activeCountryName) {
  if (!activeCountryCode || preloadState?.countryCode !== activeCountryCode) {
    return '';
  }

  const countryName = activeCountryName || activeCountryCode;

  if (preloadState.status === 'loading') {
    return `Preparing holidays for ${countryName} in the background.`;
  }

  if (preloadState.status === 'ready') {
    return `Holiday data for ${countryName} is ready.`;
  }

  if (preloadState.status === 'error') {
    return `We could not prepare holidays for ${countryName} right now, but you can still save your setup.`;
  }

  return '';
}

export default function Introduction({
  isOpen,
  onOpenChange,
  onSavePreferences,
  onSkip,
  onCountryChange,
  preloadState = { status: 'idle', countryCode: '' },
  variant = 'panel',
  connectedAccounts = [],
  externalCalendarsByAccount = {},
  externalCalendarSources = [],
  externalCalendarBusyId = '',
  providers = [],
  oauthClientConfig = {},
  onConnectProvider,
  onSaveOAuthClientConfig,
  onDisconnectAccount,
  onRevokeAccount,
  onLoadExternalCalendars,
  onImportExternalCalendar,
  oauthBusyProvider = '',
  accountBusyId = '',
  oauthStatusMessage = '',
}) {
  const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const detectedCountryCode = detectCountryCode();
  const isOnboarding = variant === 'onboarding';

  const allTimeZones = useMemo(() => {
    if (typeof Intl.supportedValuesOf === 'function') {
      return Intl.supportedValuesOf('timeZone');
    }

    return [detectedTimeZone];
  }, [detectedTimeZone]);

  const [countries, setCountries] = useState(() =>
    getDefaultCountryOptions(detectedCountryCode)
  );
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [fieldMessage, setFieldMessage] = useState('');
  const [formData, setFormData] = useState(() => ({
    countryCode:
      typeof window !== 'undefined'
        ? window.localStorage.getItem('calendar-user-country') || detectedCountryCode
        : detectedCountryCode,
    timeZone:
      typeof window !== 'undefined'
        ? window.localStorage.getItem('calendar-user-timezone') || detectedTimeZone
        : detectedTimeZone,
    name:
      typeof window !== 'undefined'
        ? window.localStorage.getItem('calendar-user-name') || ''
        : '',
    notificationEmail:
      typeof window !== 'undefined'
        ? window.localStorage.getItem('calendar-notification-email') || ''
        : '',
  }));

  const filteredTimeZones = useMemo(
    () => getCountryTimezones(formData.countryCode, allTimeZones),
    [allTimeZones, formData.countryCode]
  );
  const selectedCountry = useMemo(
    () => countries.find((country) => country.countryCode === formData.countryCode) || null,
    [countries, formData.countryCode]
  );
  const backgroundStatusMessage = useMemo(
    () =>
      getBackgroundStatusMessage(
        preloadState,
        formData.countryCode,
        selectedCountry?.name
      ),
    [formData.countryCode, preloadState, selectedCountry]
  );
  const hasMappedTimeZones = hasCountryTimezoneMapping(formData.countryCode);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let cancelled = false;

    const loadCountries = async () => {
      try {
        const nextCountries = await window.calendarApp.getHolidayCountries();
        if (!cancelled && Array.isArray(nextCountries)) {
          setCountries((current) => mergeCountryOptions(nextCountries, current));
        }
      } catch {
        // Keep the local country list if holiday lookup is unavailable.
      }
    };

    loadCountries();

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') {
      return;
    }

    setFormData({
      countryCode: window.localStorage.getItem('calendar-user-country') || detectedCountryCode,
      timeZone: window.localStorage.getItem('calendar-user-timezone') || detectedTimeZone,
      name: window.localStorage.getItem('calendar-user-name') || '',
      notificationEmail: window.localStorage.getItem('calendar-notification-email') || '',
    });
    setStatusMessage('');
    setFieldMessage('');
  }, [detectedCountryCode, detectedTimeZone, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    onCountryChange?.(formData.countryCode);
  }, [formData.countryCode, isOpen]);

  useEffect(() => {
    if (!formData.timeZone || filteredTimeZones.includes(formData.timeZone)) {
      return;
    }

    setFormData((current) => ({
      ...current,
      timeZone: '',
    }));
    setFieldMessage('Timezone cleared because it does not match the selected country.');
  }, [filteredTimeZones, formData.timeZone]);

  function handleChange(event) {
    const { name, value } = event.target;

    setStatusMessage('');
    if (name !== 'timeZone') {
      setFieldMessage('');
    }

    setFormData((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const nextCountryCode = formData.countryCode;
    const nextTimeZone = formData.timeZone;
    const nextName = formData.name.trim();
    const nextNotificationEmail = normalizeEmailAddress(formData.notificationEmail);

    setIsSaving(true);
    setStatusMessage('');
    setFieldMessage('');

    if (nextNotificationEmail && !isValidEmailAddress(nextNotificationEmail)) {
      setIsSaving(false);
      setStatusMessage(
        'Enter a real email address, or leave the field blank. It is optional.'
      );
      return;
    }

    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('calendar-user-country', nextCountryCode);
        window.localStorage.setItem('calendar-user-timezone', nextTimeZone);
        window.localStorage.setItem('calendar-user-name', nextName);
        window.localStorage.setItem('calendar-notification-email', nextNotificationEmail);
      }

      const saveResult = await onSavePreferences?.({
        countryCode: nextCountryCode,
        timeZone: nextTimeZone,
        name: nextName,
        notificationEmail: nextNotificationEmail,
      });

      if (saveResult?.warning) {
        setStatusMessage(saveResult.warning);
      }

      onOpenChange?.(false);
    } catch (error) {
      setStatusMessage(error?.message || 'Setup could not be saved.');
    } finally {
      setIsSaving(false);
    }
  }

  function handleSkip() {
    setStatusMessage('');
    setFieldMessage('');
    onSkip?.();
  }

  if (!isOpen) {
    return null;
  }

  return (
    <section
      className={
        isOnboarding
          ? 'intro-onboarding-shell min-h-screen min-h-dvh w-full overflow-y-auto p-6'
          : 'flex w-full flex-col gap-3'
      }
    >
      <div
        className={
          isOnboarding
            ? 'intro-surface w-full max-w-4xl rounded-[36px] p-8 md:p-10'
            : 'w-full'
        }
      >
        {isOnboarding ? (
          <div className="mb-8 flex flex-col gap-4">
            <p className="settings-section-eyebrow">
              First launch setup
            </p>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-[var(--text-primary)] md:text-5xl">
              Start with the basics, then adjust anything later.
            </h1>
            <p className="max-w-3xl text-base leading-7 app-text-muted md:text-lg">
              Everything here is optional. Country helps us narrow timezone choices and prepare
              public holidays in the background. Timezone helps the calendar show the right local
              time and week start. You can change any of this later from Settings.
            </p>
          </div>
        ) : (
          <div className="mb-4 flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Getting started</h2>
            <p className="text-sm app-text-muted">
              Everything is optional. Country narrows timezone choices and prepares public
              holidays. Timezone controls how your calendar is shown.
            </p>
          </div>
        )}

        <form
          onSubmit={handleSubmit}
          className={
            isOnboarding
              ? 'grid gap-5 md:grid-cols-[1.15fr_1fr] xl:grid-cols-[1.15fr_1fr_0.9fr]'
              : 'intro-form-surface grid gap-4 rounded-[24px] p-5 md:grid-cols-[1.1fr_1fr_0.9fr_auto]'
          }
        >
          <div className="grid gap-2">
            <label htmlFor="countryCode" className="text-sm font-medium app-text-muted">
              Country
            </label>
            <select
              id="countryCode"
              name="countryCode"
              value={formData.countryCode}
              onChange={handleChange}
              className="app-input rounded-xl px-4 py-3"
            >
              <option value="">No country selected</option>
              {countries.map((country) => (
                <option key={country.countryCode} value={country.countryCode}>
                  {country.name}
                </option>
              ))}
            </select>
            <p className="text-sm leading-6 app-text-soft">
              Optional. Picking a country lets us narrow timezone options and prepare default
              public holidays for you.
            </p>
            {backgroundStatusMessage ? (
              <p
                className={`text-sm ${preloadState.status === 'error' ? 'settings-inline-warning' : 'app-text-muted'}`}
              >
                {backgroundStatusMessage}
              </p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <label htmlFor="timeZone" className="text-sm font-medium app-text-muted">
              Timezone
            </label>
            <select
              id="timeZone"
              name="timeZone"
              value={formData.timeZone}
              onChange={handleChange}
              className="app-input rounded-xl px-4 py-3"
            >
              <option value="">Use detected system timezone</option>
              {filteredTimeZones.map((timeZone) => (
                <option key={timeZone} value={timeZone}>
                  {timeZone}
                </option>
              ))}
            </select>
            <p className="text-sm leading-6 app-text-soft">
              Optional. Timezone keeps event times and week boundaries aligned with how you want
              the calendar to behave.
            </p>
            <p className="text-sm app-text-soft">
              {formData.countryCode
                ? hasMappedTimeZones
                  ? 'Showing timezones commonly used for the selected country.'
                  : 'We do not have a local timezone map for this country yet, so the full list is shown.'
                : 'Choose a country first if you want a shorter timezone list.'}
            </p>
            {fieldMessage ? <p className="text-sm settings-inline-warning">{fieldMessage}</p> : null}
          </div>

          <div className="grid gap-2">
            <label htmlFor="name" className="text-sm font-medium app-text-muted">
              Name
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="Optional"
              className="app-input rounded-xl px-4 py-3"
            />
            <p className="text-sm leading-6 app-text-soft">
              Optional. This personalizes a few friendly parts of the app.
            </p>
          </div>

          <div className="grid gap-2">
            <label htmlFor="notificationEmail" className="text-sm font-medium app-text-muted">
              Reminder recipient email
            </label>
            <input
              type="email"
              id="notificationEmail"
              name="notificationEmail"
              value={formData.notificationEmail}
              onChange={handleChange}
              placeholder="Optional"
              pattern="[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,63}"
              className="app-input rounded-xl px-4 py-3"
            />
            <p className="text-sm leading-6 app-text-soft">
              If you do not have a real email, leave this blank. It is optional.
            </p>
          </div>

          <div className={isOnboarding ? 'xl:col-span-3 md:col-span-2' : 'md:col-span-4'}>
            <ConnectedAccountsPanel
              connectedAccounts={connectedAccounts}
              externalCalendarsByAccount={externalCalendarsByAccount}
              externalCalendarSources={externalCalendarSources}
              externalCalendarBusyId={externalCalendarBusyId}
              providers={providers}
              oauthClientConfig={oauthClientConfig}
              onConnectProvider={onConnectProvider}
              onSaveOAuthClientConfig={onSaveOAuthClientConfig}
              onDisconnectAccount={onDisconnectAccount}
              onRevokeAccount={onRevokeAccount}
              onLoadExternalCalendars={onLoadExternalCalendars}
              onImportExternalCalendar={onImportExternalCalendar}
              oauthBusyProvider={oauthBusyProvider}
              accountBusyId={accountBusyId}
              oauthStatusMessage={oauthStatusMessage}
              compact
            />
          </div>

          <div
            className={
              isOnboarding
                ? 'flex flex-col justify-end gap-3 md:col-span-2 xl:col-span-1'
                : 'flex items-end justify-end'
            }
          >
            <button
              type="submit"
              disabled={isSaving}
              className="app-button app-button--primary disabled:cursor-wait disabled:opacity-80"
            >
              {isSaving ? 'Saving...' : isOnboarding ? 'Finish setup' : 'Save'}
            </button>
            {isOnboarding ? (
              <button
                type="button"
                onClick={handleSkip}
                className="app-button app-button--secondary"
              >
                Skip for now
              </button>
            ) : null}
          </div>
        </form>

        {statusMessage ? (
          <p className="settings-feedback settings-feedback--warning">{statusMessage}</p>
        ) : null}
      </div>
    </section>
  );
}
