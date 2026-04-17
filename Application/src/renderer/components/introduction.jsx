import React, { useEffect, useMemo, useState } from 'react';
import {
  detectCountryCode,
  getCountryTimezones,
  getDefaultCountryOptions,
  hasCountryTimezoneMapping,
  mergeCountryOptions,
} from '../setup-options';

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

    setIsSaving(true);
    setStatusMessage('');

    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('calendar-user-country', nextCountryCode);
        window.localStorage.setItem('calendar-user-timezone', nextTimeZone);
        window.localStorage.setItem('calendar-user-name', nextName);
      }

      const saveResult = await onSavePreferences?.({
        countryCode: nextCountryCode,
        timeZone: nextTimeZone,
        name: nextName,
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
          ? 'flex min-h-screen min-h-dvh w-full items-center justify-center p-6'
          : 'flex w-full flex-col gap-3'
      }
    >
      <div
        className={
          isOnboarding
            ? 'w-full max-w-4xl rounded-[36px] border border-slate-900/8 bg-white/78 p-8 shadow-[0_36px_90px_rgba(36,52,89,0.16)] backdrop-blur-xl md:p-10'
            : 'w-full'
        }
      >
        {isOnboarding ? (
          <div className="mb-8 flex flex-col gap-4">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-amber-700">
              First launch setup
            </p>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-slate-950 md:text-5xl">
              Start with the basics, then adjust anything later.
            </h1>
            <p className="max-w-3xl text-base leading-7 text-slate-600 md:text-lg">
              Everything here is optional. Country helps us narrow timezone choices and prepare
              public holidays in the background. Timezone helps the calendar show the right local
              time and week start. You can change any of this later from Quick setup.
            </p>
          </div>
        ) : (
          <div className="mb-4 flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-slate-900">Quick setup</h2>
            <p className="text-sm text-slate-600">
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
              : 'grid gap-4 rounded-[24px] border border-slate-900/8 bg-white/70 p-5 shadow-[0_18px_50px_rgba(36,52,89,0.10)] backdrop-blur-md md:grid-cols-[1.1fr_1fr_0.9fr_auto]'
          }
        >
          <div className="grid gap-2">
            <label htmlFor="countryCode" className="text-sm font-medium text-slate-700">
              Country
            </label>
            <select
              id="countryCode"
              name="countryCode"
              value={formData.countryCode}
              onChange={handleChange}
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            >
              <option value="">No country selected</option>
              {countries.map((country) => (
                <option key={country.countryCode} value={country.countryCode}>
                  {country.name}
                </option>
              ))}
            </select>
            <p className="text-sm leading-6 text-slate-500">
              Optional. Picking a country lets us narrow timezone options and prepare default
              public holidays for you.
            </p>
            {backgroundStatusMessage ? (
              <p
                className={`text-sm ${
                  preloadState.status === 'error' ? 'text-amber-700' : 'text-slate-600'
                }`}
              >
                {backgroundStatusMessage}
              </p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <label htmlFor="timeZone" className="text-sm font-medium text-slate-700">
              Timezone
            </label>
            <select
              id="timeZone"
              name="timeZone"
              value={formData.timeZone}
              onChange={handleChange}
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            >
              <option value="">Use detected system timezone</option>
              {filteredTimeZones.map((timeZone) => (
                <option key={timeZone} value={timeZone}>
                  {timeZone}
                </option>
              ))}
            </select>
            <p className="text-sm leading-6 text-slate-500">
              Optional. Timezone keeps event times and week boundaries aligned with how you want
              the calendar to behave.
            </p>
            <p className="text-sm text-slate-500">
              {formData.countryCode
                ? hasMappedTimeZones
                  ? 'Showing timezones commonly used for the selected country.'
                  : 'We do not have a local timezone map for this country yet, so the full list is shown.'
                : 'Choose a country first if you want a shorter timezone list.'}
            </p>
            {fieldMessage ? <p className="text-sm text-amber-700">{fieldMessage}</p> : null}
          </div>

          <div className="grid gap-2">
            <label htmlFor="name" className="text-sm font-medium text-slate-700">
              Name
            </label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="Optional"
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            />
            <p className="text-sm leading-6 text-slate-500">
              Optional. This personalizes a few friendly parts of the app.
            </p>
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
              className="rounded-full bg-slate-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-wait disabled:opacity-80"
            >
              {isSaving ? 'Saving...' : isOnboarding ? 'Finish setup' : 'Save'}
            </button>
            {isOnboarding ? (
              <button
                type="button"
                onClick={handleSkip}
                className="rounded-full border border-slate-900/12 bg-white/85 px-5 py-3 text-sm font-medium text-slate-700 transition hover:bg-white"
              >
                Skip for now
              </button>
            ) : null}
          </div>
        </form>

        {statusMessage ? (
          <p className="mt-4 px-1 text-sm text-amber-700">{statusMessage}</p>
        ) : null}
      </div>
    </section>
  );
}
