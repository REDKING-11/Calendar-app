import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import AboutDrawer from './components/AboutDrawer';
import CalendarViewport from './components/CalendarViewport';
import DebugPanel from './components/DebugPanel';
import EventComposerDrawer from './components/EventComposerDrawer';
import Header from './components/Header';
import Introduction from './components/introduction';
import QuickEventPopover from './components/QuickEventPopover';
import SettingsWindow from './components/SettingsWindow';
import Sidebar from './components/Sidebar';
import UpcomingPopover from './components/UpcomingPopover';
import {
  buildEventDateIndex,
  getDateKey,
  getMonthKey,
  isSameDay,
  startOfWeek,
} from './components/calendar-helpers';
import {
  addMinutesToDate,
  ALL_DAY_DURATION_MINUTES,
  applyCalendarContextToDraft,
  buildEventPayloadFromDraft,
  createNotificationDraft,
  createDraftEventFromEvent,
  createEmptyDraftEvent,
  DEFAULT_NOTIFICATION_REMINDER_MINUTES,
  EVENT_TITLE_MAX_LENGTH,
  extractInviteeEmails,
  formatDateForInput,
  formatTimeForInput,
  getDraftDurationMinutes,
  getDraftEndDate,
  getDraftStartDate,
  isValidEmailAddress,
  normalizeEmailAddress,
  isDraftEventValid,
  normalizeTimedDurationMinutes,
  normalizeNotificationDrafts,
  normalizeNotificationRecipients,
  normalizeReminderMinutesBeforeStart,
  scopeToInviteProvider,
  setDraftAllDay,
  syncDraftNotificationFields,
  setDraftDuration,
  setDraftEndTime,
  setDraftStartTime,
} from './eventDraft';
import {
  promoteComposerStateToDrawer,
  shouldPromoteQuickCreateDraft,
  shouldPromoteQuickEditDraft,
} from './composerRouting';
import { shouldFallbackActiveCalendarContext } from './calendarContextPersistence';
import {
  getExternalCalendarDeleteResultMessage,
  isExternalCalendarSourcePresent,
} from './externalCalendarDeletion';
import {
  focusFirstAvailable,
  getRegionShortcutTarget,
  isEditableTarget,
} from './keyboardNavigation';
import { STORAGE_KEYS, useCalendarPreferences, updatePreference } from './preferences';
import {
  buildDebugSnapshot,
  isDeveloperShortcut,
  recordAppError,
} from './debug-tools';
import './styles.css';

const HOLIDAY_PRELOAD_STATUS = {
  idle: 'idle',
  loading: 'loading',
  ready: 'ready',
  error: 'error',
};

const EMPTY_COMPOSER_STATE = {
  variant: null,
  mode: 'create',
  anchorPoint: null,
};
const LOCAL_CALENDAR_VISIBILITY_KEY = 'calendar-local-calendar-visible';
const ACTIVE_CALENDAR_CONTEXT_KEY = 'calendar-active-calendar-context';
const PROVIDER_LIVE_REFRESH_INTERVAL_MS = 90 * 1000;

function getWindowMode() {
  const params = new URLSearchParams(window.location.search);
  return params.get('window') || 'main';
}

function buildSettingsWindowFeatures() {
  return [
    'popup=yes',
    'width=980',
    'height=900',
    'left=120',
    'top=80',
    'resizable=yes',
    'scrollbars=yes',
  ].join(',');
}

function getHolidaySeedYears() {
  const currentYear = new Date().getFullYear();
  return [currentYear, currentYear + 1];
}

function getVisibleEventsForView(events, calendarView, selectedDate, timeZone, weekStartsOn, eventDateIndex = null) {
  if (!selectedDate) {
    return events;
  }

  if (calendarView === 'day') {
    return eventDateIndex?.byDay?.get(getDateKey(selectedDate)) || [];
  }

  if (calendarView === 'week') {
    const weekStart = startOfWeek(selectedDate, timeZone, weekStartsOn);
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + index);
      return eventDateIndex?.byDay?.get(getDateKey(day)) || [];
    }).flat();
  }

  if (calendarView === 'month') {
    return eventDateIndex?.byMonth?.get(getMonthKey(selectedDate)) || [];
  }

  if (calendarView === 'year') {
    return eventDateIndex?.byYear?.get(String(selectedDate.getFullYear())) || [];
  }

  return events;
}

function collectAvailableTags(events = [], snapshotTags = []) {
  const tags = new Map();

  for (const tag of snapshotTags) {
    if (!tag?.label) {
      continue;
    }

    tags.set(tag.label.toLowerCase(), {
      id: tag.id || tag.label,
      label: tag.label,
      color: tag.color || '#475569',
    });
  }

  for (const event of events) {
    for (const tag of event.tags || []) {
      if (!tag?.label) {
        continue;
      }

      const key = tag.label.toLowerCase();
      if (!tags.has(key)) {
        tags.set(key, {
          id: tag.id || tag.label,
          label: tag.label,
          color: tag.color || '#475569',
        });
      }
    }
  }

  return Array.from(tags.values()).sort((left, right) =>
    left.label.localeCompare(right.label)
  );
}

function getQuickComposerDefaults(preferences) {
  return {
    type: preferences.defaultQuickType,
    scope: preferences.defaultQuickSendFrom,
  };
}

function getQuickComposerDuration(preferences) {
  return normalizeTimedDurationMinutes(
    preferences.defaultQuickDuration,
    preferences.defaultEventDuration
  );
}

function collectKnownNotificationEmails(preferences, connectedAccounts = []) {
  const knownEmails = new Set();

  for (const account of connectedAccounts) {
    const normalizedEmail = normalizeEmailAddress(account?.email);
    if (normalizedEmail && isValidEmailAddress(normalizedEmail)) {
      knownEmails.add(normalizedEmail);
    }
  }

  for (const value of [preferences.notificationEmail, preferences.hostedEmail]) {
    const normalizedEmail = normalizeEmailAddress(value);
    if (normalizedEmail && isValidEmailAddress(normalizedEmail)) {
      knownEmails.add(normalizedEmail);
    }
  }

  return Array.from(knownEmails);
}

function getEventSourceIds(event = {}) {
  return (event.externalProviderLinks || [])
    .map((link) => String(link?.sourceId || '').trim())
    .filter(Boolean);
}

function getEventPrimarySourceId(event = {}) {
  return getEventSourceIds(event)[0] || '';
}

function isLocalCalendarEvent(event = {}) {
  return getEventSourceIds(event).length === 0;
}

function getAccountTitle(account = {}) {
  return account.email || account.displayName || 'Connected account';
}

function buildSidebarCalendarGroups({
  connectedAccounts = [],
  externalCalendarSources = [],
  events = [],
  isLocalCalendarVisible = true,
  activeCalendarContextId = 'local',
}) {
  const sourceEventCounts = new Map();
  let localEventCount = 0;

  for (const event of events) {
    const sourceIds = getEventSourceIds(event);
    if (sourceIds.length === 0) {
      localEventCount += 1;
      continue;
    }

    for (const sourceId of sourceIds) {
      sourceEventCounts.set(sourceId, (sourceEventCounts.get(sourceId) || 0) + 1);
    }
  }

  const groupsByAccount = new Map(
    connectedAccounts.map((account) => [
      account.accountId,
      {
        id: account.accountId,
        provider: account.provider,
        title: getAccountTitle(account),
        status: account.status || '',
        calendars: [],
      },
    ])
  );

  for (const source of externalCalendarSources) {
    const group =
      groupsByAccount.get(source.accountId) || {
        id: source.accountId || source.provider || 'external',
        provider: source.provider,
        title: source.displayName || source.provider || 'External calendars',
        status: '',
        calendars: [],
      };

    group.calendars.push({
      id: source.sourceId,
      sourceId: source.sourceId,
      label: source.displayName || source.remoteCalendarId || 'Calendar',
      provider: source.provider,
      color: source.provider === 'microsoft' ? '#4d8cf5' : '#4f9d69',
      visible: source.selected !== false,
      eventCount: sourceEventCounts.get(source.sourceId) || 0,
      active: activeCalendarContextId === source.sourceId,
    });
    groupsByAccount.set(group.id, group);
  }

  return [
    {
      id: 'local',
      provider: 'local',
      title: 'This device',
      status: 'local',
      calendars: [
        {
          id: 'local',
          sourceId: '',
          label: 'Local calendar',
          provider: 'local',
          color: '#64748b',
          visible: isLocalCalendarVisible,
          eventCount: localEventCount,
          active: activeCalendarContextId === 'local',
        },
      ],
    },
    ...Array.from(groupsByAccount.values()).map((group) => ({
      ...group,
      calendars: group.calendars.sort((left, right) => left.label.localeCompare(right.label)),
    })),
  ];
}

function getScopeForCalendarProvider(provider = '') {
  if (provider === 'google') {
    return 'work';
  }
  if (provider === 'microsoft') {
    return 'personal';
  }
  return 'internal';
}

function findCalendarContext(contextId = 'local', externalCalendarSources = []) {
  if (!contextId || contextId === 'local') {
    return {
      id: 'local',
      provider: 'local',
      scope: 'internal',
      accountId: '',
      calendarId: '',
      label: 'Local calendar',
    };
  }

  const source = externalCalendarSources.find((item) => item.sourceId === contextId);
  if (!source) {
    return {
      id: 'local',
      provider: 'local',
      scope: 'internal',
      accountId: '',
      calendarId: '',
      label: 'Local calendar',
    };
  }

  return {
    id: source.sourceId,
    provider: source.provider,
    scope: getScopeForCalendarProvider(source.provider),
    accountId: source.accountId || '',
    calendarId: source.remoteCalendarId || '',
    label: source.displayName || source.remoteCalendarId || 'Provider calendar',
  };
}

function getEligibleSenderAccount(scope = 'internal', connectedAccounts = []) {
  const sendCapableAccounts = (connectedAccounts || []).filter((account) => account?.emailSendCapable);
  if (scope === 'work') {
    return sendCapableAccounts.find((account) => account.provider === 'google') || null;
  }

  if (scope === 'personal') {
    return sendCapableAccounts.find((account) => account.provider === 'microsoft') || null;
  }

  return sendCapableAccounts[0] || null;
}

function getDefaultNotificationRecipient(scope, connectedAccounts, knownNotificationEmails, preferences) {
  const senderAccount = getEligibleSenderAccount(scope, connectedAccounts);
  if (senderAccount?.email) {
    const normalizedEmail = normalizeEmailAddress(senderAccount.email);
    return isValidEmailAddress(normalizedEmail) ? normalizedEmail : '';
  }

  const preferredEmail = normalizeEmailAddress(preferences.notificationEmail);
  if (preferredEmail && isValidEmailAddress(preferredEmail)) {
    return preferredEmail;
  }

  const hostedEmail = normalizeEmailAddress(preferences.hostedEmail);
  if (hostedEmail && isValidEmailAddress(hostedEmail)) {
    return hostedEmail;
  }

  return knownNotificationEmails[0] || '';
}

function getLastInviteTargetForProvider(provider, preferences) {
  if (provider === 'google') {
    return preferences.lastGoogleInviteTarget || null;
  }
  if (provider === 'microsoft') {
    return preferences.lastMicrosoftInviteTarget || null;
  }
  return null;
}

function getInviteTargetPreferencePatch(provider, target) {
  const normalizedTarget = target
    ? {
        accountId: target.accountId || '',
        calendarId: target.calendarId || '',
      }
    : null;

  if (provider === 'google') {
    return { lastGoogleInviteTarget: normalizedTarget };
  }
  if (provider === 'microsoft') {
    return { lastMicrosoftInviteTarget: normalizedTarget };
  }
  return {};
}

function createDraftForDate(date, preferences) {
  return createEmptyDraftEvent(
    date,
    getQuickComposerDuration(preferences),
    getQuickComposerDefaults(preferences)
  );
}

async function openSettingsExperience() {
  const result = await window.calendarApp.openSettingsWindow();
  if (result?.opened) {
    return result;
  }

  const settingsUrl = `${window.location.origin}${window.location.pathname}?window=settings`;
  const popup = window.open(settingsUrl, '_blank', buildSettingsWindowFeatures());

  if (!popup) {
    window.location.search = '?window=settings';
  }

  return {
    opened: Boolean(popup),
    reused: false,
    fallbackRequired: true,
  };
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function findDraftConflicts(events, draftEvent, activeEventId, fallbackDuration) {
  if (!draftEvent?.date || !draftEvent?.time) {
    return [];
  }

  const startsAt = getDraftStartDate(draftEvent);
  const endsAt = getDraftEndDate(draftEvent, fallbackDuration);

  return (events || [])
    .filter((event) => event.id !== activeEventId)
    .filter((event) =>
      rangesOverlap(startsAt, endsAt, new Date(event.startsAt), new Date(event.endsAt))
    )
    .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt));
}

function summarizeConflicts(conflicts = []) {
  const focusConflicts = conflicts.filter((event) => event.type === 'focus');

  return {
    hasConflicts: conflicts.length > 0,
    total: conflicts.length,
    focusCount: focusConflicts.length,
    items: conflicts.map((event) => ({
      id: event.id,
      title: event.title,
      type: event.type,
    })),
  };
}

function alignToNextHalfHour(date) {
  const nextDate = new Date(date);
  const minuteRemainder = nextDate.getMinutes() % 30;
  const minuteStep = minuteRemainder === 0 ? 30 : 30 - minuteRemainder;
  nextDate.setMinutes(nextDate.getMinutes() + minuteStep, 0, 0);
  return nextDate;
}

function findFreeSlotForDraft(events, draftEvent, activeEventId, fallbackDuration) {
  if (!draftEvent?.date || !draftEvent?.time) {
    return null;
  }

  const durationMinutes = getDraftDurationMinutes(draftEvent, fallbackDuration);
  const searchStart = alignToNextHalfHour(getDraftStartDate(draftEvent));
  const searchEnd = addMinutesToDate(searchStart, 7 * 24 * 60);

  for (
    let candidateStart = new Date(searchStart);
    candidateStart < searchEnd;
    candidateStart = addMinutesToDate(candidateStart, 30)
  ) {
    const candidateEnd = addMinutesToDate(candidateStart, durationMinutes);
    const hasConflict = (events || [])
      .filter((event) => event.id !== activeEventId)
      .some((event) =>
        rangesOverlap(candidateStart, candidateEnd, new Date(event.startsAt), new Date(event.endsAt))
      );

    if (!hasConflict) {
      return {
        start: candidateStart,
        end: candidateEnd,
        durationMinutes,
      };
    }
  }

  return null;
}

function App() {
  const windowMode = getWindowMode();
  const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { preferences, setPreferences, effectiveTheme } = useCalendarPreferences();
  const [snapshot, setSnapshot] = useState(null);
  const [draftEvent, setDraftEvent] = useState(() => createDraftForDate(new Date(), preferences));
  const [composerState, setComposerState] = useState(EMPTY_COMPOSER_STATE);
  const [activeEvent, setActiveEvent] = useState(null);
  const [calendarView, setCalendarView] = useState(preferences.defaultView);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [searchQuery, setSearchQuery] = useState('');
  const [quickFilter, setQuickFilter] = useState('all');
  const [activeTagFilters, setActiveTagFilters] = useState([]);
  const [isLocalCalendarVisible, setIsLocalCalendarVisible] = useState(() => {
    if (typeof window === 'undefined') {
      return true;
    }

    return window.localStorage.getItem(LOCAL_CALENDAR_VISIBILITY_KEY) !== 'false';
  });
  const [activeCalendarContextId, setActiveCalendarContextId] = useState(() => {
    if (typeof window === 'undefined') {
      return 'local';
    }

    return window.localStorage.getItem(ACTIVE_CALENDAR_CONTEXT_KEY) || 'local';
  });
  const [isUpcomingOpen, setIsUpcomingOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isDebugPanelOpen, setIsDebugPanelOpen] = useState(false);
  const [isDebugSetupOpen, setIsDebugSetupOpen] = useState(false);
  const [debugStatusMessage, setDebugStatusMessage] = useState('');
  const [lastAppError, setLastAppError] = useState(null);
  const [isSetupComplete, setIsSetupComplete] = useState(() => {
    if (typeof window === 'undefined') {
      return true;
    }

    const persistedSetupComplete = window.localStorage.getItem(STORAGE_KEYS.setupComplete);
    if (persistedSetupComplete !== null) {
      return persistedSetupComplete === 'true';
    }

    return Boolean(
      window.localStorage.getItem(STORAGE_KEYS.userCountry) ||
        window.localStorage.getItem(STORAGE_KEYS.userTimeZone) ||
        window.localStorage.getItem(STORAGE_KEYS.userName)
    );
  });
  const [holidayPreloadState, setHolidayPreloadState] = useState({
    countryCode: '',
    status: HOLIDAY_PRELOAD_STATUS.idle,
  });
  const [hostedUrl, setHostedUrl] = useState('');
  const [hostedPassword, setHostedPassword] = useState('');
  const [hostedInviteKey, setHostedInviteKey] = useState('');
  const [hostedBusyAction, setHostedBusyAction] = useState('');
  const [hostedStatusMessage, setHostedStatusMessage] = useState('');
  const [oauthBusyProvider, setOAuthBusyProvider] = useState('');
  const [oauthStatusMessage, setOAuthStatusMessage] = useState('');
  const [accountBusyId, setAccountBusyId] = useState('');
  const [externalCalendarsByAccount, setExternalCalendarsByAccount] = useState({});
  const [externalCalendarBusyId, setExternalCalendarBusyId] = useState('');
  const [calendarDeleteBusyId, setCalendarDeleteBusyId] = useState('');
  const [composerStatusMessage, setComposerStatusMessage] = useState('');
  const [pendingInviteConfirmation, setPendingInviteConfirmation] = useState(null);
  const snapshotRef = useRef(null);
  const holidayPreloadRequestRef = useRef(0);
  const quickPopoverRef = useRef(null);
  const sidebarRegionRef = useRef(null);
  const appHeaderRegionRef = useRef(null);
  const calendarHeaderRegionRef = useRef(null);
  const calendarViewRegionRef = useRef(null);
  const oauthPollingRef = useRef(null);
  const oauthPollingDeadlineRef = useRef(0);
  const providerLiveRefreshInFlightRef = useRef(false);
  const debugStatusTimerRef = useRef(null);

  const rememberAppError = (error, source = 'app') => {
    const nextError = recordAppError(error, source);
    setLastAppError(nextError);
    return nextError;
  };

  const showDebugStatus = (message) => {
    setDebugStatusMessage(message);
    if (debugStatusTimerRef.current) {
      window.clearTimeout(debugStatusTimerRef.current);
    }
    debugStatusTimerRef.current = window.setTimeout(() => {
      setDebugStatusMessage('');
      debugStatusTimerRef.current = null;
    }, 2400);
  };

  const refreshSnapshot = async () => {
    const nextSnapshot = await window.calendarApp.getSnapshot();
    snapshotRef.current = nextSnapshot;
    setSnapshot(nextSnapshot);
    return nextSnapshot;
  };

  const stopOAuthPolling = () => {
    if (oauthPollingRef.current) {
      window.clearInterval(oauthPollingRef.current);
      oauthPollingRef.current = null;
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadSnapshot = async () => {
      const nextSnapshot = await window.calendarApp.getSnapshot();
      if (!cancelled) {
        snapshotRef.current = nextSnapshot;
        setSnapshot(nextSnapshot);
      }
    };

    loadSnapshot();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => () => stopOAuthPolling(), []);

  useEffect(
    () => () => {
      if (debugStatusTimerRef.current) {
        window.clearTimeout(debugStatusTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    const handleDeveloperShortcut = (keyboardEvent) => {
      if (!isDeveloperShortcut(keyboardEvent) || isEditableTarget(keyboardEvent.target)) {
        return;
      }

      keyboardEvent.preventDefault();
      updatePreference(setPreferences, {
        developerMode: preferences.developerMode !== true,
      });
      setIsDebugPanelOpen(preferences.developerMode !== true);
      showDebugStatus(
        preferences.developerMode === true ? 'Developer mode disabled.' : 'Developer mode enabled.'
      );
    };

    window.addEventListener('keydown', handleDeveloperShortcut);
    return () => window.removeEventListener('keydown', handleDeveloperShortcut);
  }, [preferences.developerMode, setPreferences]);

  useEffect(() => {
    if (preferences.developerMode === true) {
      return;
    }

    setIsDebugPanelOpen(false);
    setIsDebugSetupOpen(false);
  }, [preferences.developerMode]);

  useEffect(() => {
    if (!hostedUrl && snapshot?.security?.hosted?.baseUrl) {
      setHostedUrl(snapshot.security.hosted.baseUrl);
    }
  }, [snapshot?.security?.hosted?.baseUrl, hostedUrl]);

  useEffect(() => {
    setCalendarView(preferences.defaultView);
  }, [preferences.defaultView]);

  const allEvents = snapshot?.events || [];
  const externalCalendarSources = snapshot?.externalCalendarSources || [];
  const connectedAccounts = snapshot?.security?.auth?.connectedAccounts || [];
  const notificationProviders = snapshot?.security?.auth?.providers || [];
  const oauthClientConfig = snapshot?.security?.auth?.clientConfig || {};
  const knownNotificationEmails = useMemo(
    () => collectKnownNotificationEmails(preferences, connectedAccounts),
    [connectedAccounts, preferences.notificationEmail, preferences.hostedEmail]
  );
  const visibleExternalSourceIds = useMemo(
    () =>
      new Set(
        externalCalendarSources
          .filter((source) => source.selected !== false)
          .map((source) => source.sourceId)
      ),
    [externalCalendarSources]
  );
  const providerLiveSourceSignature = useMemo(
    () =>
      externalCalendarSources
        .filter(
          (source) =>
            source?.sourceId &&
            source.selected !== false &&
            (source.provider === 'google' || source.provider === 'microsoft')
        )
        .map((source) => source.sourceId)
        .sort()
        .join('|'),
    [externalCalendarSources]
  );
  const sidebarCalendarGroups = useMemo(
    () =>
      buildSidebarCalendarGroups({
        connectedAccounts,
        externalCalendarSources,
        events: allEvents,
        isLocalCalendarVisible,
        activeCalendarContextId,
      }),
    [activeCalendarContextId, allEvents, connectedAccounts, externalCalendarSources, isLocalCalendarVisible]
  );
  const activeCalendarContext = useMemo(
    () => findCalendarContext(activeCalendarContextId, externalCalendarSources),
    [activeCalendarContextId, externalCalendarSources]
  );

  useEffect(() => {
    if (shouldFallbackActiveCalendarContext({
      snapshotLoaded: Boolean(snapshot),
      activeCalendarContextId,
      externalCalendarSources,
    })) {
      setActiveCalendarContextId('local');
      window.localStorage.setItem(ACTIVE_CALENDAR_CONTEXT_KEY, 'local');
    }
  }, [activeCalendarContextId, externalCalendarSources, snapshot]);

  useEffect(() => {
    if (windowMode !== 'main' || preferences.providerLiveUpdatesBeta !== true) {
      return undefined;
    }

    if (!providerLiveSourceSignature || !window.calendarApp?.refreshExternalSource) {
      return undefined;
    }

    let cancelled = false;

    const refreshLiveSources = async ({ announceIdle = false } = {}) => {
      if (providerLiveRefreshInFlightRef.current) {
        return;
      }

      providerLiveRefreshInFlightRef.current = true;
      let createdCount = 0;
      let updatedCount = 0;
      let removedCount = 0;

      try {
        const refreshableSources = (snapshotRef.current?.externalCalendarSources || []).filter(
          (source) =>
            source?.sourceId &&
            source.selected !== false &&
            (source.provider === 'google' || source.provider === 'microsoft')
        );

        for (const source of refreshableSources) {
          if (cancelled) {
            return;
          }

          const result = await window.calendarApp.refreshExternalSource({
            sourceId: source.sourceId,
          });
          if (result?.snapshot) {
            snapshotRef.current = result.snapshot;
            setSnapshot(result.snapshot);
          }
          createdCount += Number(result?.createdCount || 0);
          updatedCount += Number(result?.updatedCount || 0);
          removedCount += Number(result?.removedCount || 0);
        }

        const changedCount = createdCount + updatedCount + removedCount;
        if (changedCount > 0) {
          setOAuthStatusMessage(
            `Live provider update applied ${changedCount} change${
              changedCount === 1 ? '' : 's'
            } (${createdCount} new, ${updatedCount} updated, ${removedCount} removed).`
          );
        } else if (announceIdle) {
          setOAuthStatusMessage('Live provider updates are on. No provider changes found.');
        }
      } catch (error) {
        rememberAppError(error, 'provider-live-refresh');
        setOAuthStatusMessage(error?.message || 'Live provider update failed.');
      } finally {
        providerLiveRefreshInFlightRef.current = false;
      }
    };

    refreshLiveSources({ announceIdle: true });
    const intervalId = window.setInterval(
      () => refreshLiveSources(),
      PROVIDER_LIVE_REFRESH_INTERVAL_MS
    );

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    preferences.providerLiveUpdatesBeta,
    providerLiveSourceSignature,
    windowMode,
  ]);

  const clearHolidayPreload = () => {
    holidayPreloadRequestRef.current += 1;
    setHolidayPreloadState({
      countryCode: '',
      status: HOLIDAY_PRELOAD_STATUS.idle,
    });
  };

  const prepareHolidayPreload = async (countryCode) => {
    if (!countryCode) {
      clearHolidayPreload();
      return null;
    }

    const requestId = holidayPreloadRequestRef.current + 1;
    holidayPreloadRequestRef.current = requestId;
    setHolidayPreloadState({
      countryCode,
      status: HOLIDAY_PRELOAD_STATUS.loading,
    });

    try {
      const preloadResult = await window.calendarApp.preloadHolidays({
        countryCode,
        years: getHolidaySeedYears(),
        timeZone: preferences.timeZone || detectedTimeZone,
      });

      if (holidayPreloadRequestRef.current !== requestId) {
        return preloadResult;
      }

      setHolidayPreloadState({
        countryCode,
        status:
          preloadResult?.status === HOLIDAY_PRELOAD_STATUS.error
            ? HOLIDAY_PRELOAD_STATUS.error
            : HOLIDAY_PRELOAD_STATUS.ready,
      });

      return preloadResult;
    } catch (error) {
      rememberAppError(error, 'holiday-preload');
      if (holidayPreloadRequestRef.current !== requestId) {
        return null;
      }

      setHolidayPreloadState({
        countryCode,
        status: HOLIDAY_PRELOAD_STATUS.error,
      });
      return null;
    }
  };

  const importHolidayPreferences = async ({ countryCode, timeZone, name, notificationEmail }) => {
    const nextTimeZone = timeZone || detectedTimeZone;
    updatePreference(setPreferences, {
      countryCode: countryCode || '',
      timeZone: nextTimeZone,
      name: typeof name === 'string' ? name : preferences.name,
      notificationEmail:
        typeof notificationEmail === 'string'
          ? notificationEmail.trim()
          : preferences.notificationEmail,
    });
    setIsSetupComplete(true);
    window.localStorage.setItem(STORAGE_KEYS.setupComplete, 'true');

    if (!countryCode) {
      return { warning: '' };
    }

    try {
      const result = await window.calendarApp.importHolidays({
        countryCode,
        years: getHolidaySeedYears(),
        timeZone: nextTimeZone,
      });

      if (result?.snapshot) {
        snapshotRef.current = result.snapshot;
        setSnapshot(result.snapshot);
      }

      return {
        warning: result?.warning || '',
      };
    } catch (error) {
      rememberAppError(error, 'holiday-import');
      setHolidayPreloadState({
        countryCode,
        status: HOLIDAY_PRELOAD_STATUS.error,
      });
      return {
        warning: 'Settings were saved, but holidays could not be imported right now.',
      };
    }
  };

  const handleImportCalendarFile = async () => {
    try {
      const result = await window.calendarApp.importDataFromFilePicker();
      if (result?.snapshot) {
        snapshotRef.current = result.snapshot;
        setSnapshot(result.snapshot);
      }
      return result;
    } catch (error) {
      rememberAppError(error, 'calendar-file-import');
      throw error;
    }
  };

  const handleSkipSetup = () => {
    setIsSetupComplete(true);
    window.localStorage.setItem(STORAGE_KEYS.setupComplete, 'true');
  };

  const availableTags = useMemo(
    () => collectAvailableTags(allEvents, snapshot?.tags || []),
    [allEvents, snapshot?.tags]
  );
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const events = useMemo(
    () => {
      const now = new Date();
      const weekStart = startOfWeek(now, preferences.timeZone, preferences.weekStartsOn);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

      return allEvents.filter((event) => {
        const primarySourceId = getEventPrimarySourceId(event);
        if (!primarySourceId && !isLocalCalendarVisible) {
          return false;
        }
        if (primarySourceId && !visibleExternalSourceIds.has(primarySourceId)) {
          return false;
        }

        if (!preferences.showCompletedTasks && event.completed) {
          return false;
        }

        const eventStart = new Date(event.startsAt);
        const matchesSearch =
          !normalizedSearchQuery ||
          event.title.toLowerCase().includes(normalizedSearchQuery) ||
          (event.tags || []).some((tag) =>
            tag.label.toLowerCase().includes(normalizedSearchQuery)
          ) ||
          (event.location || '').toLowerCase().includes(normalizedSearchQuery) ||
          (event.people || []).some((person) =>
            person.toLowerCase().includes(normalizedSearchQuery)
          );
        const matchesQuickFilter =
          quickFilter === 'all' ||
          (quickFilter === 'today' && isSameDay(eventStart, now)) ||
          (quickFilter === 'week' &&
            eventStart >= weekStart &&
            eventStart < weekEnd) ||
          (quickFilter === 'month' &&
            eventStart >= monthStart &&
            eventStart < monthEnd);
        const matchesTags =
          activeTagFilters.length === 0 ||
          activeTagFilters.every((filterId) =>
            (event.tags || []).some((tag) => tag.label === filterId)
          );

        return matchesSearch && matchesQuickFilter && matchesTags;
      });
    },
    [
      allEvents,
      isLocalCalendarVisible,
      visibleExternalSourceIds,
      normalizedSearchQuery,
      quickFilter,
      activeTagFilters,
      preferences.showCompletedTasks,
      preferences.timeZone,
      preferences.weekStartsOn,
    ]
  );
  const eventDateIndex = useMemo(() => buildEventDateIndex(events), [events]);
  const todayEvents = useMemo(
    () =>
      [...(eventDateIndex.byDay.get(getDateKey(new Date())) || [])].sort(
        (left, right) => new Date(left.startsAt) - new Date(right.startsAt)
      ),
    [eventDateIndex]
  );
  const visibleEvents = useMemo(
    () =>
      getVisibleEventsForView(
        events,
        calendarView,
        selectedDate,
        preferences.timeZone,
        preferences.weekStartsOn,
        eventDateIndex
      ),
    [events, calendarView, selectedDate, preferences.timeZone, preferences.weekStartsOn, eventDateIndex]
  );

  const upcomingDays = useMemo(
    () =>
      events.slice(0, 5).map((event) => {
        const startsAt = new Date(event.startsAt);
        return {
          id: event.id,
          day: startsAt.toLocaleDateString(undefined, { weekday: 'short' }),
          date: startsAt.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          }),
          time: new Intl.DateTimeFormat(undefined, {
            hour: 'numeric',
            minute: '2-digit',
            hour12: preferences.timeFormat === '12h',
          }).format(startsAt),
          focus: event.title,
          startsAt,
        };
      }),
    [events, preferences.timeFormat]
  );

  const conflictSummary = useMemo(
    () =>
      summarizeConflicts(
        findDraftConflicts(
          events,
          draftEvent,
          activeEvent?.id,
          preferences.defaultEventDuration
        )
      ),
    [events, draftEvent, activeEvent?.id, preferences.defaultEventDuration]
  );
  const shouldBuildDebugSnapshot =
    preferences.developerMode === true && (isDebugPanelOpen || windowMode === 'settings');
  const debugSnapshot = useMemo(
    () =>
      shouldBuildDebugSnapshot
        ? buildDebugSnapshot({
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
            oauthPollingActive: Boolean(oauthPollingRef.current),
            externalCalendarsByAccount,
            composerState,
            isUpcomingOpen,
            isAboutOpen,
            lastAppError,
          })
        : null,
    [
      shouldBuildDebugSnapshot,
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
      externalCalendarsByAccount,
      composerState,
      isUpcomingOpen,
      isAboutOpen,
      lastAppError,
    ]
  );

  const closeComposer = () => {
    setComposerState(EMPTY_COMPOSER_STATE);
    setActiveEvent(null);
    setComposerStatusMessage('');
    setPendingInviteConfirmation(null);
  };

  const applyInviteDefaultsToDraft = (draft) => {
    const provider = scopeToInviteProvider(draft.scope);
    const lastTarget = getLastInviteTargetForProvider(provider, preferences);
    if (!provider || draft.inviteTargetAccountId || !lastTarget?.accountId) {
      return draft;
    }

    return {
      ...draft,
      inviteTargetProvider: provider,
      inviteTargetAccountId: lastTarget.accountId,
      inviteTargetCalendarId: lastTarget.calendarId || '',
    };
  };

  const createContextDraftForDate = (date) =>
    applyInviteDefaultsToDraft(
      applyCalendarContextToDraft(createDraftForDate(date, preferences), activeCalendarContext, {
        autoSaveToProvider: preferences.autoSaveToSelectedProviderCalendar !== false,
      })
    );

  const openQuickComposer = ({ date = new Date(), anchorPoint = null, eventToEdit = null } = {}) => {
    setIsAboutOpen(false);
    setIsUpcomingOpen(false);
    setComposerStatusMessage('');
    setPendingInviteConfirmation(null);
    if (eventToEdit) {
      setActiveEvent(eventToEdit);
      setSelectedDate(new Date(eventToEdit.startsAt));
      setDraftEvent(createDraftEventFromEvent(eventToEdit));
      setComposerState({
        variant: 'quick',
        mode: 'edit',
        anchorPoint,
      });
      return;
    }

    setActiveEvent(null);
    setSelectedDate(date);
    setDraftEvent(createContextDraftForDate(date));
    setComposerState({
      variant: 'quick',
      mode: 'create',
      anchorPoint,
    });
  };

  const openDrawerComposer = ({ date = new Date(), eventToEdit = null } = {}) => {
    setIsAboutOpen(false);
    setIsUpcomingOpen(false);
    setComposerStatusMessage('');
    setPendingInviteConfirmation(null);
    if (eventToEdit) {
      setActiveEvent(eventToEdit);
      setSelectedDate(new Date(eventToEdit.startsAt));
      setDraftEvent(applyInviteDefaultsToDraft(createDraftEventFromEvent(eventToEdit)));
      setComposerState({
        variant: 'drawer',
        mode: 'edit',
        anchorPoint: null,
      });
      return;
    }

    setActiveEvent(null);
    setSelectedDate(date);
    setDraftEvent(createContextDraftForDate(date));
    setComposerState({
      variant: 'drawer',
      mode: 'create',
      anchorPoint: null,
    });
  };

  const handleCreateEventRequest = (request = {}) => {
    const nextDate =
      request?.date instanceof Date ? request.date : request?.date ? new Date(request.date) : new Date();

    if (request?.openInDrawer) {
      if (
        shouldPromoteQuickCreateDraft({
          composerState,
          activeEvent,
          draftEvent,
          requestDate: nextDate,
        })
      ) {
        setComposerState((current) => promoteComposerStateToDrawer(current));
        return;
      }

      openDrawerComposer({ date: nextDate });
      return;
    }

    openQuickComposer({
      date: nextDate,
      anchorPoint: request?.anchorPoint || null,
    });
  };

  const handleSelectCalendarEvent = ({ event, anchorPoint, openInDrawer = false }) => {
    if (!event) {
      return;
    }

    if (
      openInDrawer &&
      shouldPromoteQuickEditDraft({
        composerState,
        activeEvent,
        requestEvent: event,
      })
    ) {
      setComposerState((current) => promoteComposerStateToDrawer(current));
      return;
    }

    if (openInDrawer) {
      openDrawerComposer({ eventToEdit: event });
      return;
    }

    openQuickComposer({
      eventToEdit: event,
      anchorPoint,
    });
  };

  const handleDraftFieldChange = (name, value) => {
    setDraftEvent((current) => {
      const normalizedValue =
        name === 'title'
          ? String(value ?? '')
              .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
              .replace(/[<>]/g, '')
              .slice(0, EVENT_TITLE_MAX_LENGTH)
          : value;
      const nextDraft = {
        ...current,
        [name]: normalizedValue,
      };

      if (name === 'notifications') {
        nextDraft.notifications = normalizeNotificationDrafts(value);
        return syncDraftNotificationFields(nextDraft);
      }

      if (
        name === 'reminderMinutesBeforeStart' ||
        name === 'desktopNotificationEnabled' ||
        name === 'emailNotificationEnabled' ||
        name === 'emailNotificationRecipients'
      ) {
        const notifications =
          normalizeNotificationDrafts(current.notifications).length > 0
            ? normalizeNotificationDrafts(current.notifications)
            : [
                createNotificationDraft({
                  reminderMinutesBeforeStart:
                    current.reminderMinutesBeforeStart || null,
                  desktopNotificationEnabled: current.desktopNotificationEnabled,
                  emailNotificationEnabled: current.emailNotificationEnabled,
                  emailNotificationRecipients: current.emailNotificationRecipients,
                }),
              ];
        const primaryNotification = {
          ...notifications[0],
        };

        if (name === 'reminderMinutesBeforeStart') {
          primaryNotification.reminderMinutesBeforeStart = normalizeReminderMinutesBeforeStart(value);
        }

        if (name === 'desktopNotificationEnabled') {
          primaryNotification.desktopNotificationEnabled = Boolean(value);
          if (
            primaryNotification.desktopNotificationEnabled &&
            !primaryNotification.reminderMinutesBeforeStart
          ) {
            primaryNotification.reminderMinutesBeforeStart = DEFAULT_NOTIFICATION_REMINDER_MINUTES;
          }
        }

        if (name === 'emailNotificationEnabled') {
          primaryNotification.emailNotificationEnabled = Boolean(value);
          if (primaryNotification.emailNotificationEnabled) {
            if (!primaryNotification.reminderMinutesBeforeStart) {
              primaryNotification.reminderMinutesBeforeStart = DEFAULT_NOTIFICATION_REMINDER_MINUTES;
            }
            if (primaryNotification.emailNotificationRecipients.length === 0) {
              const defaultRecipient = getDefaultNotificationRecipient(
                nextDraft.scope,
                connectedAccounts,
                knownNotificationEmails,
                preferences
              );
              primaryNotification.emailNotificationRecipients = defaultRecipient
                ? [defaultRecipient]
                : [];
            }
          }
        }

        if (name === 'emailNotificationRecipients') {
          primaryNotification.emailNotificationRecipients = normalizeNotificationRecipients(value);
        }

        nextDraft.notifications = [primaryNotification, ...notifications.slice(1)];
        return syncDraftNotificationFields(nextDraft);
      }

      if (name === 'time') {
        return setDraftStartTime(current, normalizedValue, preferences.defaultEventDuration);
      }

      if (name === 'endTime') {
        return setDraftEndTime(current, normalizedValue, preferences.defaultEventDuration);
      }

      if (name === 'scope') {
        const inviteProvider = scopeToInviteProvider(value);
        nextDraft.inviteTargetProvider = inviteProvider;
        if (!inviteProvider) {
          nextDraft.inviteTargetAccountId = '';
          nextDraft.inviteTargetCalendarId = '';
          nextDraft.inviteDeliveryMode = 'local_only';
        } else if (current.inviteTargetProvider !== inviteProvider) {
          const lastTarget = getLastInviteTargetForProvider(inviteProvider, preferences);
          nextDraft.inviteTargetAccountId = lastTarget?.accountId || '';
          nextDraft.inviteTargetCalendarId = lastTarget?.calendarId || '';
        }

        const notifications = normalizeNotificationDrafts(current.notifications);
        if (notifications.length > 0) {
          nextDraft.notifications = notifications.map((notification) => {
            if (
              notification.emailNotificationEnabled &&
              notification.emailNotificationRecipients.length === 0
            ) {
              const defaultRecipient = getDefaultNotificationRecipient(
                value,
                connectedAccounts,
                knownNotificationEmails,
                preferences
              );
              return {
                ...notification,
                emailNotificationRecipients: defaultRecipient ? [defaultRecipient] : [],
              };
            }

            return notification;
          });
          return syncDraftNotificationFields(nextDraft);
        }
      }

      return nextDraft;
    });
  };

  const handleSelectDuration = (durationMinutes) => {
    setDraftEvent((current) => setDraftDuration(current, durationMinutes));
  };

  const handleSelectAllDay = () => {
    setDraftEvent((current) => setDraftAllDay(current));
  };

  const handleToggleTagFilter = (filterId) => {
    setActiveTagFilters((current) =>
      current.includes(filterId)
        ? current.filter((item) => item !== filterId)
        : [...current, filterId]
    );
  };

  const handleManageTag = async (tag, action) => {
    if (!tag?.id || !action) {
      return;
    }

    if (action === 'rename') {
      const nextLabel = window.prompt(`Rename "${tag.label}" to:`, tag.label);
      if (nextLabel === null) {
        return;
      }

      const trimmedLabel = nextLabel.trim();
      if (!trimmedLabel || trimmedLabel.toLowerCase() === tag.label.toLowerCase()) {
        return;
      }

      const nextSnapshot = await window.calendarApp.renameTag({
        tagId: tag.id,
        label: trimmedLabel,
      });
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
      setActiveTagFilters((current) =>
        current.map((item) =>
          item.toLowerCase() === tag.label.toLowerCase() ? trimmedLabel : item
        )
      );
      return;
    }

    if (action === 'delete') {
      const shouldDelete = window.confirm(
        `Delete "${tag.label}" from the whole system? This removes it from every event.`
      );
      if (!shouldDelete) {
        return;
      }

      const nextSnapshot = await window.calendarApp.deleteTag(tag.id);
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
      setActiveTagFilters((current) =>
        current.filter((item) => item.toLowerCase() !== tag.label.toLowerCase())
      );
    }
  };

  const handleFindFreeSlot = () => {
    setDraftEvent((current) => {
      const nextSlot = findFreeSlotForDraft(
        events,
        current,
        activeEvent?.id,
        preferences.defaultEventDuration
      );

      if (!nextSlot) {
        return current;
      }

      return {
        ...current,
        date: formatDateForInput(nextSlot.start),
        time: formatTimeForInput(nextSlot.start),
        endTime: formatTimeForInput(nextSlot.end),
        durationMinutes: nextSlot.durationMinutes,
      };
    });
  };

  const handleLoadExternalCalendars = async (accountId, options = {}) => {
    if (!accountId) {
      return [];
    }

    const existingState = externalCalendarsByAccount[accountId];
    const force = options?.force === true;
    if (existingState?.status === 'loading') {
      return existingState.items || [];
    }
    if (!force && existingState?.status === 'ready') {
      return existingState.items || [];
    }

    setExternalCalendarsByAccount((current) => ({
      ...current,
      [accountId]: {
        status: 'loading',
        items: current[accountId]?.items || [],
        error: '',
      },
    }));

    try {
      const calendars = await window.calendarApp.listExternalCalendars({ accountId });
      const items = Array.isArray(calendars) ? calendars : [];
      setExternalCalendarsByAccount((current) => ({
        ...current,
        [accountId]: {
          status: 'ready',
          items,
          error: '',
        },
      }));
      return items;
    } catch (error) {
      rememberAppError(error, 'external-calendar-list');
      setExternalCalendarsByAccount((current) => ({
        ...current,
        [accountId]: {
          status: 'error',
          items: current[accountId]?.items || [],
          error: error?.message || 'Could not load calendars for this account.',
        },
      }));
      return existingState?.items || [];
    }
  };

  const handleImportExternalCalendar = async ({ accountId, remoteCalendarId } = {}) => {
    if (!accountId || !remoteCalendarId) {
      throw new Error('Choose a connected account and calendar to import.');
    }

    const busyId = `${accountId}:${remoteCalendarId}`;
    setExternalCalendarBusyId(busyId);
    setOAuthStatusMessage('');
    try {
      const result = await window.calendarApp.importExternalCalendar({
        accountId,
        remoteCalendarId,
      });
      if (result?.snapshot) {
        snapshotRef.current = result.snapshot;
        setSnapshot(result.snapshot);
      } else {
        await refreshSnapshot();
      }
      const importedCount = Number(result?.createdCount || 0) + Number(result?.updatedCount || 0);
      setOAuthStatusMessage(
        `Imported ${importedCount} event${importedCount === 1 ? '' : 's'} from ${
          result?.source?.displayName || 'calendar'
        }.`
      );
      await handleLoadExternalCalendars(accountId, { force: true });
      return result;
    } catch (error) {
      rememberAppError(error, 'external-calendar-import');
      setOAuthStatusMessage(error?.message || 'Calendar could not be imported.');
      throw error;
    } finally {
      setExternalCalendarBusyId('');
    }
  };

  const handleToggleLocalCalendar = (visible) => {
    setIsLocalCalendarVisible(Boolean(visible));
    window.localStorage.setItem(LOCAL_CALENDAR_VISIBILITY_KEY, visible ? 'true' : 'false');
  };

  const handleToggleExternalCalendarSource = async (sourceId, visible) => {
    if (!sourceId) {
      return;
    }

    try {
      const nextSnapshot = await window.calendarApp.setExternalCalendarSourceSelected({
        sourceId,
        selected: Boolean(visible),
      });
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
    } catch (error) {
      rememberAppError(error, 'external-calendar-visibility');
      setOAuthStatusMessage(error?.message || 'Calendar visibility could not be updated.');
    }
  };

  const handleDeleteExternalCalendarSource = async (calendar) => {
    if (calendar?.provider === 'local') {
      return;
    }

    if (!calendar?.sourceId) {
      showDebugStatus('This imported calendar is missing its source id, so it cannot be deleted yet.');
      return;
    }

    if (typeof window.calendarApp?.deleteExternalCalendarSource !== 'function') {
      const message = 'Restart Calendar App to finish loading the imported-calendar delete feature.';
      showDebugStatus(message);
      window.alert?.(`${message} The delete bridge is not loaded in this running window yet.`);
      return;
    }

    const shouldDelete = window.confirm(
      `Delete imported calendar "${calendar.label}" and remove its ${calendar.eventCount || 0} imported event${
        calendar.eventCount === 1 ? '' : 's'
      } from Calendar App?\n\nThis does not delete the calendar itself from Google/Outlook.`
    );
    if (!shouldDelete) {
      return;
    }

    setCalendarDeleteBusyId(calendar.sourceId);
    try {
      const result = await window.calendarApp.deleteExternalCalendarSource({
        sourceId: calendar.sourceId,
        deleteEvents: true,
      });
      const refreshedSnapshot = await refreshSnapshot();

      if (activeCalendarContextId === calendar.sourceId) {
        setActiveCalendarContextId('local');
        window.localStorage.setItem(ACTIVE_CALENDAR_CONTEXT_KEY, 'local');
      }

      if (isExternalCalendarSourcePresent(refreshedSnapshot, calendar.sourceId)) {
        const message = `Tried to delete "${calendar.label}", but it is still present after refresh. Restart Calendar App and try again.`;
        setOAuthStatusMessage(message);
        showDebugStatus(message);
        return;
      }

      const message = getExternalCalendarDeleteResultMessage({
        label: calendar.label,
        deletedEventCount: result?.deletedEventCount || 0,
      });
      setOAuthStatusMessage(message);
      showDebugStatus(message);
    } catch (error) {
      rememberAppError(error, 'external-calendar-delete');
      const message = error?.message || 'Imported calendar could not be deleted.';
      setOAuthStatusMessage(message);
      showDebugStatus(message);
      window.alert?.(message);
    } finally {
      setCalendarDeleteBusyId('');
    }
  };

  const handleUseSidebarCalendar = (calendar) => {
    const nextContextId = calendar?.provider === 'local' ? 'local' : calendar?.sourceId;
    if (!nextContextId) {
      return;
    }

    setActiveCalendarContextId(nextContextId);
    window.localStorage.setItem(ACTIVE_CALENDAR_CONTEXT_KEY, nextContextId);

    if (composerState.mode === 'create') {
      const nextContext = findCalendarContext(nextContextId, externalCalendarSources);
      setDraftEvent((current) =>
        applyInviteDefaultsToDraft(
          applyCalendarContextToDraft(current, nextContext, {
            autoSaveToProvider: preferences.autoSaveToSelectedProviderCalendar !== false,
          })
        )
      );
    }
  };

  const handleToggleSidebarCalendar = async (calendar) => {
    if (!calendar) {
      return;
    }

    const nextVisible = !calendar.visible;
    if (calendar.provider === 'local') {
      handleToggleLocalCalendar(nextVisible);
      return;
    }

    await handleToggleExternalCalendarSource(calendar.sourceId, nextVisible);
  };

  const persistQuickComposerDefaults = () => {
    const draftDuration = getDraftDurationMinutes(
      draftEvent,
      preferences.defaultEventDuration
    );
    const nextQuickDuration =
      draftEvent.isAllDay || draftDuration >= ALL_DAY_DURATION_MINUTES
        ? getQuickComposerDuration(preferences)
        : normalizeTimedDurationMinutes(draftDuration, preferences.defaultEventDuration);

    updatePreference(setPreferences, {
      defaultQuickType: draftEvent.type,
      defaultQuickSendFrom: draftEvent.scope,
      defaultQuickDuration: nextQuickDuration,
    });
  };

  const commitEventSave = async (payload) => {
    setComposerStatusMessage('');
    try {
      const nextSnapshot =
        composerState.mode === 'edit' && activeEvent
          ? await window.calendarApp.updateEvent({
              id: activeEvent.id,
              ...payload,
            })
          : await window.calendarApp.createEvent(payload);

      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
      persistQuickComposerDefaults();
      if (payload.inviteDeliveryMode === 'provider_invite' && payload.inviteTargetProvider) {
        updatePreference(
          setPreferences,
          getInviteTargetPreferencePatch(payload.inviteTargetProvider, {
            accountId: payload.inviteTargetAccountId,
            calendarId: payload.inviteTargetCalendarId,
          })
        );
      }
      setSelectedDate(new Date(payload.startsAt));
      closeComposer();
    } catch (error) {
      rememberAppError(error, composerState.mode === 'edit' ? 'event-update' : 'event-create');
      setComposerStatusMessage(error?.message || 'The event could not be saved.');
      setPendingInviteConfirmation(null);
    }
  };

  const handleSaveEvent = async (event) => {
    event.preventDefault();

    if (!isDraftEventValid(draftEvent)) {
      return;
    }

    const payload = buildEventPayloadFromDraft(draftEvent, preferences.defaultEventDuration);
    const inviteEmails = extractInviteeEmails(payload.inviteRecipients);

    if (
      payload.inviteDeliveryMode === 'provider_invite' &&
      payload.syncPolicy === 'internal_only'
    ) {
      setComposerStatusMessage(
        'Local events stay inside Calendar App. Choose a Google or Outlook calendar before saving to a provider.'
      );
      return;
    }

    if (
      payload.inviteDeliveryMode === 'provider_invite' &&
      (!payload.inviteTargetAccountId || !payload.inviteTargetCalendarId)
    ) {
      setComposerStatusMessage('Choose the account and calendar to save this event to, or save locally only.');
      setComposerState((current) => promoteComposerStateToDrawer(current));
      return;
    }

    if (payload.inviteDeliveryMode === 'provider_invite' && inviteEmails.length > 0) {
      setPendingInviteConfirmation({
        payload,
        inviteEmails,
      });
      return;
    }

    await commitEventSave(payload);
  };

  const handleDeleteEvent = async (eventToDelete = activeEvent) => {
    if (!eventToDelete) {
      return;
    }

    const hasOutboundLink = (eventToDelete.externalProviderLinks || []).some(
      (link) => String(link?.mode || '').toLowerCase() === 'outbound'
    );
    const hasImportedProviderLink = (eventToDelete.externalProviderLinks || []).some(
      (link) => String(link?.mode || '').toLowerCase() === 'imported'
    );
    if (hasOutboundLink) {
      const shouldDelete = window.confirm(
        'Delete this event and cancel/remove its provider invite too?'
      );
      if (!shouldDelete) {
        return;
      }
    }

    const shouldDeleteImportedProvider =
      preferences.providerLiveUpdatesBeta === true && hasImportedProviderLink;
    if (shouldDeleteImportedProvider) {
      const shouldDeleteRemote = window.confirm(
        'Beta live updates are on. Delete this imported event from Google/Outlook too? This removes it from the provider calendar, not only Calendar App.'
      );
      if (!shouldDeleteRemote) {
        return;
      }
    }

    try {
      const nextSnapshot = await window.calendarApp.deleteEvent(eventToDelete.id, {
        deleteImportedProvider: shouldDeleteImportedProvider,
      });
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
      closeComposer();
    } catch (error) {
      rememberAppError(error, 'event-delete');
      setComposerStatusMessage(error?.message || 'The event could not be deleted.');
    }
  };

  const handleHostedAction = async (actionKey, action, successMessage) => {
    setHostedBusyAction(actionKey);
    setHostedStatusMessage('');

    try {
      const result = await action();
      const nextSnapshot = result?.snapshot || result;

      if (nextSnapshot?.security) {
        setSnapshot(nextSnapshot);
      }

      const nextBaseUrl = nextSnapshot?.security?.hosted?.baseUrl;
      if (nextBaseUrl) {
        setHostedUrl(nextBaseUrl);
      }
      if (successMessage) {
        setHostedStatusMessage(successMessage);
      }
      return result;
    } catch (error) {
      rememberAppError(error, `hosted-${actionKey}`);
      const fallbackMessage =
        error?.message || 'The hosted backend action could not be completed.';
      setHostedStatusMessage(fallbackMessage);
      try {
        await refreshSnapshot();
      } catch {
        // Keep current UI state if refresh fails.
      }
      return null;
    } finally {
      setHostedBusyAction('');
    }
  };

  const runHostedShareAction = async (action) => {
    const nextSnapshot = await action();
    snapshotRef.current = nextSnapshot;
    setSnapshot(nextSnapshot);
    return nextSnapshot?.hostedResult || {};
  };

  const buildHostedCredentials = () => ({
    baseUrl: hostedUrl,
    email: preferences.hostedEmail,
    password: hostedPassword,
    displayName: preferences.name,
    inviteKey: hostedInviteKey,
    deviceName: preferences.hostedDeviceName,
  });

  const handleStartOAuthConnect = async (provider) => {
    const providerLabel = provider === 'google' ? 'Google' : provider === 'microsoft' ? 'Outlook' : provider;
    const knownProviderAccounts = new Map(
      connectedAccounts
        .filter((account) => account.provider === provider)
        .map((account) => [account.accountId, account.updatedAt || ''])
    );
    stopOAuthPolling();
    setOAuthBusyProvider(provider);
    setOAuthStatusMessage(`Opening ${providerLabel} sign-in in your browser...`);

    try {
      await window.calendarApp.startOAuthConnect(provider, 'write');
      setOAuthStatusMessage(`Finish ${providerLabel} sign-in in the browser. We'll refresh here automatically.`);
      oauthPollingDeadlineRef.current = Date.now() + 3 * 60 * 1000;
      oauthPollingRef.current = window.setInterval(async () => {
        try {
          const nextSnapshot = await refreshSnapshot();
          const matchedAccount = (nextSnapshot?.security?.auth?.connectedAccounts || []).find(
            (account) =>
              account.provider === provider &&
              account.status === 'connected' &&
              account.canWrite &&
              account.writeScopeGranted &&
              (!knownProviderAccounts.has(account.accountId) ||
                knownProviderAccounts.get(account.accountId) !== (account.updatedAt || ''))
          );

          if (matchedAccount) {
            stopOAuthPolling();
            setOAuthBusyProvider('');
            setOAuthStatusMessage(`${providerLabel} is ready for calendar invites and reminders.`);
            return;
          }

          if (Date.now() > oauthPollingDeadlineRef.current) {
            stopOAuthPolling();
            setOAuthBusyProvider('');
            setOAuthStatusMessage(
              `${providerLabel} sign-in is still pending. You can keep the browser flow open and try again from notifications later.`
            );
          }
        } catch (error) {
          rememberAppError(error, 'oauth-polling-refresh');
          // Keep waiting for the browser callback to complete.
        }
      }, 3000);
    } catch (error) {
      rememberAppError(error, `oauth-start-${provider}`);
      stopOAuthPolling();
      setOAuthBusyProvider('');
      setOAuthStatusMessage(error?.message || `${providerLabel} sign-in could not be started.`);
    }
  };

  const handleSaveOAuthClientConfig = async (clientConfigDraft) => {
    setOAuthStatusMessage('');
    let result;
    try {
      result = await window.calendarApp.updateOAuthClientConfig(clientConfigDraft);
    } catch (error) {
      rememberAppError(error, 'oauth-config-save');
      throw error;
    }
    if (result?.security) {
      setSnapshot((current) => {
        const nextSnapshot = {
          ...(current || {}),
          security: result.security,
        };
        snapshotRef.current = nextSnapshot;
        return nextSnapshot;
      });
    } else {
      await refreshSnapshot();
    }
    setOAuthStatusMessage('Connection setup saved.');
    return result;
  };

  const handleOpenConnectionSettings = async () => {
    setOAuthStatusMessage('Opening Settings for Google and Outlook connections...');
    try {
      await openSettingsExperience();
      setOAuthStatusMessage('Use Settings to configure and connect Google or Outlook accounts.');
    } catch (error) {
      rememberAppError(error, 'open-settings');
      setOAuthStatusMessage(error?.message || 'Settings could not be opened.');
    }
  };

  const handleDisconnectAccount = async (accountId) => {
    if (!accountId) {
      return;
    }

    setAccountBusyId(accountId);
    setOAuthStatusMessage('');
    try {
      const result = await window.calendarApp.disconnectAccount(accountId);
      if (result?.security) {
        setSnapshot((current) => {
          const nextSnapshot = {
            ...(current || {}),
            security: result.security,
          };
          snapshotRef.current = nextSnapshot;
          return nextSnapshot;
        });
      } else {
        await refreshSnapshot();
      }
      setOAuthStatusMessage('Account disconnected locally.');
    } catch (error) {
      rememberAppError(error, 'account-disconnect');
      setOAuthStatusMessage(error?.message || 'The account could not be disconnected.');
    } finally {
      setAccountBusyId('');
    }
  };

  const handleRevokeAccount = async (accountId) => {
    if (!accountId) {
      return;
    }

    const shouldRevoke = window.confirm(
      'Revoke this account connection? This removes local tokens and asks the provider to revoke access when supported.'
    );
    if (!shouldRevoke) {
      return;
    }

    setAccountBusyId(accountId);
    setOAuthStatusMessage('');
    try {
      const result = await window.calendarApp.revokeAccount(accountId);
      if (result?.security) {
        setSnapshot((current) => {
          const nextSnapshot = {
            ...(current || {}),
            security: result.security,
          };
          snapshotRef.current = nextSnapshot;
          return nextSnapshot;
        });
      } else {
        await refreshSnapshot();
      }
      setOAuthStatusMessage('Account revoked.');
    } catch (error) {
      rememberAppError(error, 'account-revoke');
      setOAuthStatusMessage(error?.message || 'The account could not be revoked.');
    } finally {
      setAccountBusyId('');
    }
  };

  const handleDebugOpenSetup = () => {
    closeComposer();
    setIsUpcomingOpen(false);
    setIsAboutOpen(false);
    setIsDebugSetupOpen(true);
    setIsDebugPanelOpen(false);
  };

  const handleDebugOpenSettings = async () => {
    try {
      await openSettingsExperience();
    } catch (error) {
      rememberAppError(error, 'debug-open-settings');
      showDebugStatus(error?.message || 'Settings could not be opened.');
    }
  };

  const handleDebugRefreshSnapshot = async () => {
    try {
      await refreshSnapshot();
      showDebugStatus('Snapshot refreshed.');
    } catch (error) {
      rememberAppError(error, 'debug-refresh-snapshot');
      showDebugStatus(error?.message || 'Snapshot refresh failed.');
    }
  };

  const handleDebugOpenComposer = () => {
    setIsDebugPanelOpen(false);
    openDrawerComposer({ date: selectedDate || new Date() });
  };

  const handleDebugOpenUpcoming = () => {
    setIsDebugPanelOpen(false);
    setIsAboutOpen(false);
    closeComposer();
    setIsUpcomingOpen(true);
  };

  const handleDebugOpenAbout = () => {
    setIsDebugPanelOpen(false);
    closeComposer();
    setIsUpcomingOpen(false);
    setIsAboutOpen(true);
  };

  useEffect(() => {
    if (composerState.variant !== 'quick') {
      return undefined;
    }

    const handlePointerDown = (pointerEvent) => {
      if (!quickPopoverRef.current?.contains(pointerEvent.target)) {
        closeComposer();
      }
    };

    const handleEscape = (keyboardEvent) => {
      if (keyboardEvent.key === 'Escape') {
        closeComposer();
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [composerState.variant, activeEvent]);

  useEffect(() => {
    if (windowMode !== 'main') {
      return undefined;
    }

    const handleRegionShortcut = (keyboardEvent) => {
      const targetRegion = getRegionShortcutTarget(keyboardEvent);
      if (!targetRegion) {
        return;
      }

      const hasBlockingDialog =
        composerState.variant === 'drawer' ||
        isAboutOpen ||
        Boolean(pendingInviteConfirmation);

      if (hasBlockingDialog) {
        return;
      }

      keyboardEvent.preventDefault();

      if (targetRegion === 'sidebar') {
        focusFirstAvailable(
          sidebarRegionRef.current,
          '[data-keyboard-focus="sidebar-primary"], [data-keyboard-focus="sidebar-search"]'
        );
        return;
      }

      if (targetRegion === 'header') {
        const focusedCalendarHeader = focusFirstAvailable(
          calendarHeaderRegionRef.current,
          '[data-keyboard-focus="calendar-header-primary"], .calendar-view-toggle, button'
        );

        if (!focusedCalendarHeader) {
          focusFirstAvailable(
            appHeaderRegionRef.current,
            '[data-keyboard-focus="app-header-primary"], button'
          );
        }
        return;
      }

      if (targetRegion === 'view') {
        focusFirstAvailable(
          calendarViewRegionRef.current,
          '[data-calendar-focus="active"], [data-calendar-focus="today"], [data-calendar-focus="first"], button'
        );
      }
    };

    window.addEventListener('keydown', handleRegionShortcut);
    return () => window.removeEventListener('keydown', handleRegionShortcut);
  }, [composerState.variant, isAboutOpen, pendingInviteConfirmation, windowMode]);

  if (!isSetupComplete && windowMode === 'main') {
    return (
      <Introduction
        isOpen
        variant="onboarding"
        preloadState={holidayPreloadState}
        onCountryChange={prepareHolidayPreload}
        onOpenChange={() => {}}
        onSavePreferences={importHolidayPreferences}
        onSkip={handleSkipSetup}
        connectedAccounts={connectedAccounts}
        externalCalendarsByAccount={externalCalendarsByAccount}
        externalCalendarSources={externalCalendarSources}
        externalCalendarBusyId={externalCalendarBusyId}
        providers={notificationProviders}
        oauthClientConfig={oauthClientConfig}
        onConnectProvider={handleStartOAuthConnect}
        onSaveOAuthClientConfig={handleSaveOAuthClientConfig}
        onLoadExternalCalendars={handleLoadExternalCalendars}
        onImportExternalCalendar={handleImportExternalCalendar}
        onDisconnectAccount={handleDisconnectAccount}
        onRevokeAccount={handleRevokeAccount}
        oauthBusyProvider={oauthBusyProvider}
        accountBusyId={accountBusyId}
        oauthStatusMessage={oauthStatusMessage}
      />
    );
  }

  if (windowMode === 'settings') {
    return (
      <>
        <div className="app-background-layer" aria-hidden="true" />
        <SettingsWindow
          snapshot={snapshot}
          preferences={preferences}
          setPreferences={setPreferences}
          effectiveTheme={effectiveTheme}
          holidayPreloadState={holidayPreloadState}
          onCountryChange={prepareHolidayPreload}
          onImportHolidays={importHolidayPreferences}
          onImportCalendarFile={handleImportCalendarFile}
          hosted={snapshot?.security?.hosted}
          hostedUrl={hostedUrl}
          onHostedUrlChange={setHostedUrl}
          hostedPassword={hostedPassword}
          onHostedPasswordChange={setHostedPassword}
          hostedInviteKey={hostedInviteKey}
          onHostedInviteKeyChange={setHostedInviteKey}
          onHostedTestConnection={() =>
            handleHostedAction(
              'test-connection',
              () => window.calendarApp.testHostedConnection(hostedUrl),
              'Hosted backend is reachable and supports SelfHdb password sign-in.'
            )
          }
          onHostedRegister={() =>
            handleHostedAction(
              'register',
              () => window.calendarApp.registerHostedAccount(buildHostedCredentials()),
              'Hosted account created and this device is now connected.'
            ).then((result) => {
              if (result) {
                setHostedPassword('');
                setHostedInviteKey('');
              }
            })
          }
          onHostedSignIn={() =>
            handleHostedAction(
              'login',
              () => window.calendarApp.loginHostedAccount(buildHostedCredentials()),
              'Hosted sign-in completed.'
            ).then((result) => {
              if (result) {
                setHostedPassword('');
              }
            })
          }
          onSyncHostedNow={() =>
            handleHostedAction(
              'sync',
              () => window.calendarApp.syncHostedNow(),
              'Hosted sync completed.'
            )
          }
          onDisconnectHostedSync={() =>
            handleHostedAction(
              'disconnect',
              () => window.calendarApp.disconnectHostedSync(),
              'Hosted backend disconnected on this device.'
            )
          }
          onExportHostedEnv={(values) =>
            handleHostedAction(
              'export-env',
              () =>
                window.calendarApp.exportHostedEnv({
                  ...values,
                  APP_URL: values?.APP_URL || hostedUrl,
                }),
              ''
            ).then((result) => {
              if (result?.canceled) {
                setHostedStatusMessage('SelfHdb .env export was cancelled.');
                return;
              }

              if (result?.filePath) {
                setHostedStatusMessage(`SelfHdb .env exported to ${result.filePath}.`);
              }
            })
          }
          onListHostedShares={() => runHostedShareAction(() => window.calendarApp.listHostedShares())}
          onCreateHostedShare={(input) =>
            runHostedShareAction(() => window.calendarApp.createHostedShare(input))
          }
          onRevokeHostedShare={(shareId) =>
            runHostedShareAction(() => window.calendarApp.revokeHostedShare(shareId))
          }
          onRotateHostedShareToken={(shareId) =>
            runHostedShareAction(() => window.calendarApp.rotateHostedShareToken(shareId))
          }
          onUpdateHostedShareRecipients={(input) =>
            runHostedShareAction(() => window.calendarApp.updateHostedShareRecipients(input))
          }
          onPublishHostedShare={(input) =>
            runHostedShareAction(() => window.calendarApp.publishHostedShare(input))
          }
          hostedBusyAction={hostedBusyAction}
          hostedStatusMessage={hostedStatusMessage}
          connectedAccounts={connectedAccounts}
          externalCalendarsByAccount={externalCalendarsByAccount}
          externalCalendarSources={externalCalendarSources}
          externalCalendarBusyId={externalCalendarBusyId}
          providers={notificationProviders}
          oauthClientConfig={oauthClientConfig}
          onConnectProvider={handleStartOAuthConnect}
          onSaveOAuthClientConfig={handleSaveOAuthClientConfig}
          onLoadExternalCalendars={handleLoadExternalCalendars}
          onImportExternalCalendar={handleImportExternalCalendar}
          onDisconnectAccount={handleDisconnectAccount}
          onRevokeAccount={handleRevokeAccount}
          oauthBusyProvider={oauthBusyProvider}
          accountBusyId={accountBusyId}
          oauthStatusMessage={oauthStatusMessage}
          debugSnapshot={debugSnapshot}
        />
        {debugStatusMessage ? (
          <div className="debug-toast" role="status">
            {debugStatusMessage}
          </div>
        ) : null}
      </>
    );
  }

  const isDrawerOpen = composerState.variant === 'drawer';
  const isQuickComposerOpen = composerState.variant === 'quick';

  return (
    <>
      <div className="app-background-layer" aria-hidden="true" />
      <div className="app-shell overflow-hidden">
        <Sidebar
          regionRef={sidebarRegionRef}
          availableTags={availableTags}
          events={events}
          eventDateIndex={eventDateIndex}
          visibleEvents={visibleEvents}
          calendarGroups={sidebarCalendarGroups}
          connectedAccounts={connectedAccounts}
          externalCalendarSources={externalCalendarSources}
          preferences={preferences}
          timeZone={preferences.timeZone}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          onCreateEvent={handleCreateEventRequest}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          quickFilter={quickFilter}
          onQuickFilterChange={setQuickFilter}
          activeTagFilters={activeTagFilters}
          onToggleTagFilter={handleToggleTagFilter}
          onManageTag={handleManageTag}
          onToggleCalendar={handleToggleSidebarCalendar}
          onUseCalendar={handleUseSidebarCalendar}
          onDeleteCalendar={handleDeleteExternalCalendarSource}
          calendarDeleteBusyId={calendarDeleteBusyId}
          onClearFilters={() => {
            setSearchQuery('');
            setQuickFilter('all');
            setActiveTagFilters([]);
          }}
        />

        <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-hidden">
          <Header
            regionRef={appHeaderRegionRef}
            eventCount={snapshot?.stats?.activeEventCount || 0}
            calendarView={calendarView}
            selectedDate={selectedDate}
            preferences={preferences}
            onToggleUpcoming={() => setIsUpcomingOpen((current) => !current)}
            onOpenDebug={() => setIsDebugPanelOpen((current) => !current)}
            onOpenAbout={() => setIsAboutOpen(true)}
            onOpenSettings={() => {
              void openSettingsExperience();
            }}
            developerMode={preferences.developerMode === true}
            timeZone={preferences.timeZone}
          />

          <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
            {isUpcomingOpen ? (
              <UpcomingPopover
                items={upcomingDays}
                onClose={() => setIsUpcomingOpen(false)}
                onSelectItem={(item) => {
                  setSelectedDate(item.startsAt);
                  closeComposer();
                  setIsUpcomingOpen(false);
                }}
              />
            ) : null}

            <CalendarViewport
              regionRef={calendarViewRegionRef}
              headerRef={calendarHeaderRegionRef}
              calendarView={calendarView}
              events={events}
              eventDateIndex={eventDateIndex}
              externalCalendarSources={externalCalendarSources}
              todayEvents={todayEvents}
              preferences={preferences}
              selectedDate={selectedDate}
              timeZone={preferences.timeZone}
              onSelectDate={setSelectedDate}
              onCreateEvent={handleCreateEventRequest}
              onSelectEvent={handleSelectCalendarEvent}
              onChangeView={setCalendarView}
              onSelectMonth={(date) => {
                setSelectedDate(date);
                setCalendarView('month');
              }}
            />
          </main>
        </div>
      </div>

      {debugStatusMessage ? (
        <div className="debug-toast" role="status">
          {debugStatusMessage}
        </div>
      ) : null}

      {preferences.developerMode === true && isDebugPanelOpen ? (
        <DebugPanel
          debugSnapshot={debugSnapshot}
          onOpenSetup={handleDebugOpenSetup}
          onOpenSettings={handleDebugOpenSettings}
          onOpenAbout={handleDebugOpenAbout}
          onOpenComposer={handleDebugOpenComposer}
          onOpenUpcoming={handleDebugOpenUpcoming}
          onRefreshSnapshot={handleDebugRefreshSnapshot}
        />
      ) : null}

      {preferences.developerMode === true && isDebugSetupOpen ? (
        <div className="debug-setup-overlay" role="presentation">
          <div className="debug-setup-panel">
            <Introduction
              isOpen
              variant="onboarding"
              preloadState={holidayPreloadState}
              onCountryChange={prepareHolidayPreload}
              onOpenChange={() => setIsDebugSetupOpen(false)}
              onSavePreferences={async (values) => {
                const result = await importHolidayPreferences(values);
                setIsDebugSetupOpen(false);
                return result;
              }}
              onSkip={() => setIsDebugSetupOpen(false)}
              connectedAccounts={connectedAccounts}
              providers={notificationProviders}
              oauthClientConfig={oauthClientConfig}
              externalCalendarsByAccount={externalCalendarsByAccount}
              externalCalendarSources={externalCalendarSources}
              externalCalendarBusyId={externalCalendarBusyId}
              onConnectProvider={handleStartOAuthConnect}
              onSaveOAuthClientConfig={handleSaveOAuthClientConfig}
              onLoadExternalCalendars={handleLoadExternalCalendars}
              onImportExternalCalendar={handleImportExternalCalendar}
              onDisconnectAccount={handleDisconnectAccount}
              onRevokeAccount={handleRevokeAccount}
              oauthBusyProvider={oauthBusyProvider}
              accountBusyId={accountBusyId}
              oauthStatusMessage={oauthStatusMessage}
            />
          </div>
        </div>
      ) : null}

      <QuickEventPopover
        isOpen={isQuickComposerOpen}
        mode={composerState.mode}
        anchorPoint={composerState.anchorPoint}
        draftEvent={draftEvent}
        preferences={preferences}
        onClose={closeComposer}
        onFieldChange={handleDraftFieldChange}
        onSelectDuration={handleSelectDuration}
        onSelectAllDay={handleSelectAllDay}
        conflictSummary={conflictSummary}
        onOpenFullDetails={() => setComposerState((current) => promoteComposerStateToDrawer(current))}
        knownNotificationEmails={knownNotificationEmails}
        connectedAccounts={connectedAccounts}
        externalCalendarSources={externalCalendarSources}
        providers={notificationProviders}
        onConnectProvider={handleStartOAuthConnect}
        onOpenConnectionSettings={handleOpenConnectionSettings}
        oauthBusyProvider={oauthBusyProvider}
        oauthStatusMessage={oauthStatusMessage}
        composerStatusMessage={composerStatusMessage}
        onSubmit={handleSaveEvent}
        popoverRef={quickPopoverRef}
      />

      <div
        className={`event-drawer-overlay ${isDrawerOpen || isAboutOpen ? 'event-drawer-overlay--open' : ''}`}
        onClick={() => {
          closeComposer();
          setIsAboutOpen(false);
          setIsUpcomingOpen(false);
        }}
        aria-hidden={!isDrawerOpen && !isAboutOpen}
      />

      <EventComposerDrawer
        isOpen={isDrawerOpen}
        mode={composerState.mode}
        draftEvent={draftEvent}
        preferences={preferences}
        onClose={closeComposer}
        onFieldChange={handleDraftFieldChange}
        onSelectDuration={handleSelectDuration}
        onSelectAllDay={handleSelectAllDay}
        onFindFreeSlot={handleFindFreeSlot}
        conflictSummary={conflictSummary}
        knownNotificationEmails={knownNotificationEmails}
        connectedAccounts={connectedAccounts}
        providers={notificationProviders}
        externalCalendarsByAccount={externalCalendarsByAccount}
        onLoadExternalCalendars={handleLoadExternalCalendars}
        onConnectProvider={handleStartOAuthConnect}
        onOpenConnectionSettings={handleOpenConnectionSettings}
        oauthBusyProvider={oauthBusyProvider}
        oauthStatusMessage={oauthStatusMessage}
        composerStatusMessage={composerStatusMessage}
        onDelete={() => handleDeleteEvent(activeEvent)}
        onSubmit={handleSaveEvent}
      />

      {pendingInviteConfirmation ? (
        <div className="invite-confirmation-overlay" role="presentation">
          <section
            className="invite-confirmation-dialog app-subsurface"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-confirmation-title"
          >
            <p className="settings-section-eyebrow">Confirm invite delivery</p>
            <h2 id="invite-confirmation-title" className="invite-confirmation-title">
              Send calendar invites?
            </h2>
            <p className="invite-confirmation-copy">
              {pendingInviteConfirmation.inviteEmails.length} guest email
              {pendingInviteConfirmation.inviteEmails.length === 1 ? '' : 's'} can receive a real
              calendar invite through your selected account. You can also save this event locally only.
            </p>
            <div className="invite-confirmation-recipients">
              {pendingInviteConfirmation.inviteEmails.map((email) => (
                <span key={email}>{email}</span>
              ))}
            </div>
            {composerStatusMessage ? (
              <p className="settings-inline-warning">{composerStatusMessage}</p>
            ) : null}
            <div className="invite-confirmation-actions">
              <button
                type="button"
                className="app-button app-button--secondary"
                onClick={() => setPendingInviteConfirmation(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="app-button app-button--secondary"
                onClick={() =>
                  commitEventSave({
                    ...pendingInviteConfirmation.payload,
                    inviteDeliveryMode: 'local_only',
                    lastInviteError: '',
                  })
                }
              >
                Save locally only
              </button>
              <button
                type="button"
                className="app-button app-button--primary"
                onClick={() => commitEventSave(pendingInviteConfirmation.payload)}
              >
                Save and send invites
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <AboutDrawer
        isOpen={isAboutOpen}
        onClose={() => setIsAboutOpen(false)}
        platform={window.calendarApp.platform}
        deviceId={snapshot?.deviceId}
        changeCount={snapshot?.stats?.changeCount || 0}
        activeEventCount={snapshot?.stats?.activeEventCount || 0}
        security={snapshot?.security}
      />
    </>
  );
}

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<App />);
