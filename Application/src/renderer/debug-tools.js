import { parseCodedErrorMessage } from '../shared/app-errors';

export { parseCodedErrorMessage };

const SENSITIVE_KEY_PATTERN = /password|token|secret|private|key|credential/i;

function safeDate(value) {
  if (!value) {
    return '';
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

export function isDeveloperShortcut(event) {
  return Boolean(
    event &&
      !event.defaultPrevented &&
      event.ctrlKey &&
      event.altKey &&
      !event.metaKey &&
      !event.shiftKey &&
      String(event.key || '').toLowerCase() === 'd'
  );
}

export function recordAppError(error, source = 'app') {
  const parsed = parseCodedErrorMessage(error?.message || error);
  return {
    code: parsed.code || error?.code || 'APP-500',
    message: parsed.message || String(error?.message || error || 'Unexpected app error.'),
    source,
    timestamp: new Date().toISOString(),
  };
}

function redactObject(value, depth = 0) {
  if (depth > 6) {
    return '[Max depth]';
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactObject(item, depth + 1));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : redactObject(entry, depth + 1),
    ])
  );
}

export function buildDebugSnapshot({
  windowMode,
  isSetupComplete,
  preferences,
  effectiveTheme,
  calendarView,
  selectedDate,
  snapshot,
  visibleEvents,
  availableTags,
  connectedAccounts,
  hostedBusyAction,
  holidayPreloadState,
  oauthBusyProvider,
  oauthPollingActive,
  externalCalendarsByAccount,
  composerState,
  isUpcomingOpen,
  isAboutOpen,
  lastAppError,
}) {
  const externalCalendarStates = Object.fromEntries(
    Object.entries(externalCalendarsByAccount || {}).map(([accountId, state]) => [
      accountId,
      {
        status: state?.status || 'idle',
        itemCount: Array.isArray(state?.items) ? state.items.length : 0,
        error: state?.error || '',
      },
    ])
  );

  return redactObject({
    capturedAt: new Date().toISOString(),
    app: {
      windowMode,
      developerMode: preferences?.developerMode === true,
      setupComplete: Boolean(isSetupComplete),
      theme: effectiveTheme,
      themeMode: preferences?.themeMode,
      backgroundMotion: preferences?.backgroundMotion !== false,
    },
    ui: {
      calendarView,
      selectedDate: safeDate(selectedDate),
      visibleEventCount: visibleEvents?.length || 0,
      tagCount: availableTags?.length || 0,
      setupOverlayOpen: composerState?.variant === 'debug-setup',
      composer: composerState,
      upcomingOpen: Boolean(isUpcomingOpen),
      aboutOpen: Boolean(isAboutOpen),
    },
    data: {
      totalEvents: snapshot?.events?.length || 0,
      activeEvents: snapshot?.stats?.activeEventCount || 0,
      storedChanges: snapshot?.stats?.changeCount || 0,
      tags: snapshot?.tags?.length || 0,
      externalSources: snapshot?.externalCalendarSources?.length || 0,
      externalLinks: snapshot?.externalEventLinks?.length || 0,
    },
    integrations: {
      connectedAccountCount: connectedAccounts?.length || 0,
      hostedSyncStatus: snapshot?.security?.hosted?.connectionStatus || 'disconnected',
      hostedBusyAction,
      holidayPreloadState,
      oauthBusyProvider,
      oauthPollingActive: Boolean(oauthPollingActive),
      externalCalendarStates,
    },
    lastAppError,
  });
}
