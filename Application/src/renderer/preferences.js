import { useEffect, useMemo, useState } from 'react';

export const STORAGE_KEYS = {
  setupComplete: 'calendar-setup-complete',
  userName: 'calendar-user-name',
  userCountry: 'calendar-user-country',
  userTimeZone: 'calendar-user-timezone',
  notificationEmail: 'calendar-notification-email',
  hostedEmail: 'calendar-hosted-email',
  hostedDeviceName: 'calendar-hosted-device-name',
  themeMode: 'calendar-theme-mode',
  defaultView: 'calendar-settings-default-view',
  weekStartsOn: 'calendar-settings-week-start',
  timeFormat: 'calendar-settings-time-format',
  showCompletedTasks: 'calendar-settings-show-completed-tasks',
  defaultEventDuration: 'calendar-settings-default-event-duration',
  defaultTaskDuration: 'calendar-settings-default-task-duration',
  defaultQuickType: 'calendar-settings-default-quick-type',
  defaultQuickSendFrom: 'calendar-settings-default-quick-send-from',
  defaultQuickDuration: 'calendar-settings-default-quick-duration',
  lastGoogleInviteTarget: 'calendar-settings-last-google-invite-target',
  lastMicrosoftInviteTarget: 'calendar-settings-last-microsoft-invite-target',
};

export const DEFAULT_PREFERENCES = {
  themeMode: 'system',
  name: '',
  countryCode: '',
  timeZone: '',
  defaultView: 'month',
  weekStartsOn: 'auto',
  timeFormat: '12h',
  showCompletedTasks: true,
  defaultEventDuration: 60,
  defaultTaskDuration: 30,
  defaultQuickType: 'meeting',
  defaultQuickSendFrom: 'internal',
  defaultQuickDuration: 60,
  lastGoogleInviteTarget: null,
  lastMicrosoftInviteTarget: null,
  notificationEmail: '',
  hostedEmail: '',
  hostedDeviceName: '',
};

function getLocalStorage() {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage;
}

function readJsonPreference(storage, key, fallback = null) {
  const rawValue = storage?.getItem(key);
  if (!rawValue) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function getStoredPreferences() {
  const storage = getLocalStorage();
  const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const defaultThemeMode = storage?.getItem(STORAGE_KEYS.themeMode) || DEFAULT_PREFERENCES.themeMode;

  return {
    themeMode: defaultThemeMode,
    name: storage?.getItem(STORAGE_KEYS.userName) || DEFAULT_PREFERENCES.name,
    countryCode: storage?.getItem(STORAGE_KEYS.userCountry) || DEFAULT_PREFERENCES.countryCode,
    timeZone: storage?.getItem(STORAGE_KEYS.userTimeZone) || detectedTimeZone,
    defaultView: storage?.getItem(STORAGE_KEYS.defaultView) || DEFAULT_PREFERENCES.defaultView,
    weekStartsOn: storage?.getItem(STORAGE_KEYS.weekStartsOn) || DEFAULT_PREFERENCES.weekStartsOn,
    timeFormat: storage?.getItem(STORAGE_KEYS.timeFormat) || DEFAULT_PREFERENCES.timeFormat,
    showCompletedTasks:
      (storage?.getItem(STORAGE_KEYS.showCompletedTasks) ?? String(DEFAULT_PREFERENCES.showCompletedTasks)) ===
      'true',
    defaultEventDuration: Number(
      storage?.getItem(STORAGE_KEYS.defaultEventDuration) || DEFAULT_PREFERENCES.defaultEventDuration
    ),
    defaultTaskDuration: Number(
      storage?.getItem(STORAGE_KEYS.defaultTaskDuration) || DEFAULT_PREFERENCES.defaultTaskDuration
    ),
    defaultQuickType:
      storage?.getItem(STORAGE_KEYS.defaultQuickType) || DEFAULT_PREFERENCES.defaultQuickType,
    defaultQuickSendFrom:
      storage?.getItem(STORAGE_KEYS.defaultQuickSendFrom) ||
      DEFAULT_PREFERENCES.defaultQuickSendFrom,
    defaultQuickDuration: Number(
      storage?.getItem(STORAGE_KEYS.defaultQuickDuration) ||
        DEFAULT_PREFERENCES.defaultQuickDuration
    ),
    lastGoogleInviteTarget: readJsonPreference(
      storage,
      STORAGE_KEYS.lastGoogleInviteTarget,
      DEFAULT_PREFERENCES.lastGoogleInviteTarget
    ),
    lastMicrosoftInviteTarget: readJsonPreference(
      storage,
      STORAGE_KEYS.lastMicrosoftInviteTarget,
      DEFAULT_PREFERENCES.lastMicrosoftInviteTarget
    ),
    notificationEmail:
      storage?.getItem(STORAGE_KEYS.notificationEmail) || DEFAULT_PREFERENCES.notificationEmail,
    hostedEmail: storage?.getItem(STORAGE_KEYS.hostedEmail) || DEFAULT_PREFERENCES.hostedEmail,
    hostedDeviceName:
      storage?.getItem(STORAGE_KEYS.hostedDeviceName) || DEFAULT_PREFERENCES.hostedDeviceName,
  };
}

export function persistPreferences(preferences) {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }

  storage.setItem(STORAGE_KEYS.themeMode, preferences.themeMode);
  storage.setItem(STORAGE_KEYS.userName, preferences.name || '');
  storage.setItem(STORAGE_KEYS.userCountry, preferences.countryCode || '');
  storage.setItem(STORAGE_KEYS.userTimeZone, preferences.timeZone || '');
  storage.setItem(STORAGE_KEYS.defaultView, preferences.defaultView || DEFAULT_PREFERENCES.defaultView);
  storage.setItem(STORAGE_KEYS.weekStartsOn, preferences.weekStartsOn || DEFAULT_PREFERENCES.weekStartsOn);
  storage.setItem(STORAGE_KEYS.timeFormat, preferences.timeFormat || DEFAULT_PREFERENCES.timeFormat);
  storage.setItem(STORAGE_KEYS.showCompletedTasks, String(Boolean(preferences.showCompletedTasks)));
  storage.setItem(
    STORAGE_KEYS.defaultEventDuration,
    String(preferences.defaultEventDuration || DEFAULT_PREFERENCES.defaultEventDuration)
  );
  storage.setItem(
    STORAGE_KEYS.defaultTaskDuration,
    String(preferences.defaultTaskDuration || DEFAULT_PREFERENCES.defaultTaskDuration)
  );
  storage.setItem(
    STORAGE_KEYS.defaultQuickType,
    preferences.defaultQuickType || DEFAULT_PREFERENCES.defaultQuickType
  );
  storage.setItem(
    STORAGE_KEYS.defaultQuickSendFrom,
    preferences.defaultQuickSendFrom || DEFAULT_PREFERENCES.defaultQuickSendFrom
  );
  storage.setItem(
    STORAGE_KEYS.defaultQuickDuration,
    String(preferences.defaultQuickDuration || DEFAULT_PREFERENCES.defaultQuickDuration)
  );
  storage.setItem(
    STORAGE_KEYS.lastGoogleInviteTarget,
    JSON.stringify(preferences.lastGoogleInviteTarget || null)
  );
  storage.setItem(
    STORAGE_KEYS.lastMicrosoftInviteTarget,
    JSON.stringify(preferences.lastMicrosoftInviteTarget || null)
  );
  storage.setItem(STORAGE_KEYS.notificationEmail, preferences.notificationEmail || '');
  storage.setItem(STORAGE_KEYS.hostedEmail, preferences.hostedEmail || '');
  storage.setItem(STORAGE_KEYS.hostedDeviceName, preferences.hostedDeviceName || '');
  storage.setItem(STORAGE_KEYS.setupComplete, 'true');
}

function getSystemTheme() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveTheme(themeMode) {
  return themeMode === 'system' ? getSystemTheme() : themeMode;
}

export function useCalendarPreferences() {
  const [preferences, setPreferences] = useState(() => getStoredPreferences());
  const [systemTheme, setSystemTheme] = useState(() => getSystemTheme());

  useEffect(() => {
    const mediaQuery =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;

    if (!mediaQuery) {
      return undefined;
    }

    const handleChange = (event) => {
      setSystemTheme(event.matches ? 'dark' : 'light');
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    const handleStorage = (event) => {
      if (!event.key || !event.key.startsWith('calendar-')) {
        return;
      }

      setPreferences(getStoredPreferences());
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  useEffect(() => {
    persistPreferences(preferences);
  }, [preferences]);

  useEffect(() => {
    const resolvedTheme = preferences.themeMode === 'system' ? systemTheme : preferences.themeMode;
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.themeMode = preferences.themeMode;
  }, [preferences.themeMode, systemTheme]);

  const effectiveTheme = useMemo(
    () => (preferences.themeMode === 'system' ? systemTheme : preferences.themeMode),
    [preferences.themeMode, systemTheme]
  );

  return {
    preferences,
    setPreferences,
    effectiveTheme,
    systemTheme,
  };
}

export function updatePreference(setPreferences, patch) {
  setPreferences((current) => ({
    ...current,
    ...patch,
  }));
}
