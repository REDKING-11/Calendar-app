import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import AboutDrawer from './components/AboutDrawer';
import CalendarViewport from './components/CalendarViewport';
import EventComposerDrawer from './components/EventComposerDrawer';
import Header from './components/Header';
import Introduction from './components/introduction';
import QuickEventPopover from './components/QuickEventPopover';
import SettingsWindow from './components/SettingsWindow';
import Sidebar from './components/Sidebar';
import UpcomingPopover from './components/UpcomingPopover';
import {
  endOfMonth,
  endOfWeek,
  isSameDay,
  startOfMonth,
  startOfWeek,
} from './components/calendar-helpers';
import {
  addMinutesToDate,
  buildEventPayloadFromDraft,
  createNotificationDraft,
  createDraftEventFromEvent,
  createEmptyDraftEvent,
  DEFAULT_NOTIFICATION_REMINDER_MINUTES,
  formatDateForInput,
  formatTimeForInput,
  getDraftDurationMinutes,
  getDraftEndDate,
  getDraftStartDate,
  isDraftEventValid,
  normalizeNotificationDrafts,
  normalizeNotificationRecipients,
  normalizeReminderMinutesBeforeStart,
  syncDraftNotificationFields,
  setDraftDuration,
} from './eventDraft';
import {
  promoteComposerStateToDrawer,
  shouldPromoteQuickCreateDraft,
  shouldPromoteQuickEditDraft,
} from './composerRouting';
import { STORAGE_KEYS, useCalendarPreferences, updatePreference } from './preferences';
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

function getVisibleEventsForView(events, calendarView, selectedDate, timeZone, weekStartsOn) {
  if (!selectedDate) {
    return events;
  }

  if (calendarView === 'day') {
    return events.filter((event) => isSameDay(new Date(event.startsAt), selectedDate));
  }

  if (calendarView === 'week') {
    const weekStart = startOfWeek(selectedDate, timeZone, weekStartsOn);
    const weekEnd = endOfWeek(selectedDate, timeZone, weekStartsOn);
    return events.filter((event) => {
      const startsAt = new Date(event.startsAt);
      return startsAt >= weekStart && startsAt < weekEnd;
    });
  }

  if (calendarView === 'month') {
    const monthStart = startOfMonth(selectedDate);
    const monthEnd = endOfMonth(selectedDate);
    return events.filter((event) => {
      const startsAt = new Date(event.startsAt);
      return startsAt >= monthStart && startsAt < monthEnd;
    });
  }

  if (calendarView === 'year') {
    const year = selectedDate.getFullYear();
    return events.filter((event) => new Date(event.startsAt).getFullYear() === year);
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

function collectKnownNotificationEmails(preferences, connectedAccounts = []) {
  const knownEmails = new Set();

  for (const account of connectedAccounts) {
    const normalizedEmail = String(account?.email || '').trim().toLowerCase();
    if (normalizedEmail) {
      knownEmails.add(normalizedEmail);
    }
  }

  for (const value of [preferences.notificationEmail, preferences.hostedEmail]) {
    const normalizedEmail = String(value || '').trim().toLowerCase();
    if (normalizedEmail) {
      knownEmails.add(normalizedEmail);
    }
  }

  return Array.from(knownEmails);
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
    return String(senderAccount.email).trim().toLowerCase();
  }

  const preferredEmail = String(preferences.notificationEmail || '').trim().toLowerCase();
  if (preferredEmail) {
    return preferredEmail;
  }

  const hostedEmail = String(preferences.hostedEmail || '').trim().toLowerCase();
  if (hostedEmail) {
    return hostedEmail;
  }

  return knownNotificationEmails[0] || '';
}

function createDraftForDate(date, preferences) {
  return createEmptyDraftEvent(
    date,
    preferences.defaultQuickDuration || preferences.defaultEventDuration,
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
  const [isUpcomingOpen, setIsUpcomingOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
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
  const [hostedBusyAction, setHostedBusyAction] = useState('');
  const [hostedStatusMessage, setHostedStatusMessage] = useState('');
  const [oauthBusyProvider, setOAuthBusyProvider] = useState('');
  const [oauthStatusMessage, setOAuthStatusMessage] = useState('');
  const snapshotRef = useRef(null);
  const holidayPreloadRequestRef = useRef(0);
  const quickPopoverRef = useRef(null);
  const oauthPollingRef = useRef(null);
  const oauthPollingDeadlineRef = useRef(0);

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

  useEffect(() => {
    if (!hostedUrl && snapshot?.security?.hosted?.baseUrl) {
      setHostedUrl(snapshot.security.hosted.baseUrl);
    }
  }, [snapshot?.security?.hosted?.baseUrl, hostedUrl]);

  useEffect(() => {
    setCalendarView(preferences.defaultView);
  }, [preferences.defaultView]);

  const allEvents = snapshot?.events || [];
  const connectedAccounts = snapshot?.security?.auth?.connectedAccounts || [];
  const notificationProviders = snapshot?.security?.auth?.providers || [];
  const knownNotificationEmails = useMemo(
    () => collectKnownNotificationEmails(preferences, connectedAccounts),
    [connectedAccounts, preferences.notificationEmail, preferences.hostedEmail]
  );

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
    } catch {
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
    } catch {
      setHolidayPreloadState({
        countryCode,
        status: HOLIDAY_PRELOAD_STATUS.error,
      });
      return {
        warning: 'Settings were saved, but holidays could not be imported right now.',
      };
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
    () =>
      allEvents.filter((event) => {
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
          (quickFilter === 'today' && isSameDay(eventStart, new Date())) ||
          (quickFilter === 'week' &&
            eventStart >= startOfWeek(new Date(), preferences.timeZone, preferences.weekStartsOn) &&
            eventStart < endOfWeek(new Date(), preferences.timeZone, preferences.weekStartsOn)) ||
          (quickFilter === 'month' &&
            eventStart >= startOfMonth(new Date()) &&
            eventStart < endOfMonth(new Date()));
        const matchesTags =
          activeTagFilters.length === 0 ||
          activeTagFilters.every((filterId) =>
            (event.tags || []).some((tag) => tag.label === filterId)
          );

        return matchesSearch && matchesQuickFilter && matchesTags;
      }),
    [
      allEvents,
      normalizedSearchQuery,
      quickFilter,
      activeTagFilters,
      preferences.showCompletedTasks,
      preferences.timeZone,
      preferences.weekStartsOn,
    ]
  );
  const visibleEvents = useMemo(
    () =>
      getVisibleEventsForView(
        events,
        calendarView,
        selectedDate,
        preferences.timeZone,
        preferences.weekStartsOn
      ),
    [events, calendarView, selectedDate, preferences.timeZone, preferences.weekStartsOn]
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

  const closeComposer = () => {
    setComposerState(EMPTY_COMPOSER_STATE);
    setActiveEvent(null);
  };

  const openQuickComposer = ({ date = new Date(), anchorPoint = null, eventToEdit = null } = {}) => {
    setIsAboutOpen(false);
    setIsUpcomingOpen(false);
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
    setDraftEvent(createDraftForDate(date, preferences));
    setComposerState({
      variant: 'quick',
      mode: 'create',
      anchorPoint,
    });
  };

  const openDrawerComposer = ({ date = new Date(), eventToEdit = null } = {}) => {
    setIsAboutOpen(false);
    setIsUpcomingOpen(false);
    if (eventToEdit) {
      setActiveEvent(eventToEdit);
      setSelectedDate(new Date(eventToEdit.startsAt));
      setDraftEvent(createDraftEventFromEvent(eventToEdit));
      setComposerState({
        variant: 'drawer',
        mode: 'edit',
        anchorPoint: null,
      });
      return;
    }

    setActiveEvent(null);
    setSelectedDate(date);
    setDraftEvent(createDraftForDate(date, preferences));
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
      const nextDraft = {
        ...current,
        [name]: value,
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
        const durationMinutes = getDraftDurationMinutes(current, preferences.defaultEventDuration);
        nextDraft.durationMinutes = durationMinutes;
        nextDraft.endTime = formatTimeForInput(
          addMinutesToDate(new Date(`${current.date}T${value}:00`), durationMinutes)
        );
      }

      if (name === 'endTime') {
        const nextDuration = getDraftDurationMinutes(
          {
            ...current,
            endTime: value,
          },
          preferences.defaultEventDuration
        );
        nextDraft.durationMinutes = nextDuration;
      }

      if (name === 'scope') {
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

  const persistQuickComposerDefaults = () => {
    updatePreference(setPreferences, {
      defaultQuickType: draftEvent.type,
      defaultQuickSendFrom: draftEvent.scope,
      defaultQuickDuration: getDraftDurationMinutes(
        draftEvent,
        preferences.defaultEventDuration
      ),
    });
  };

  const handleSaveEvent = async (event) => {
    event.preventDefault();

    if (!isDraftEventValid(draftEvent)) {
      return;
    }

    const payload = buildEventPayloadFromDraft(draftEvent, preferences.defaultEventDuration);

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
    setSelectedDate(new Date(payload.startsAt));
    closeComposer();
  };

  const handleDeleteEvent = async (eventToDelete = activeEvent) => {
    if (!eventToDelete) {
      return;
    }

    const nextSnapshot = await window.calendarApp.deleteEvent(eventToDelete.id);
    snapshotRef.current = nextSnapshot;
    setSnapshot(nextSnapshot);
    closeComposer();
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

  const buildHostedCredentials = () => ({
    baseUrl: hostedUrl,
    email: preferences.hostedEmail,
    password: hostedPassword,
    deviceName: preferences.hostedDeviceName,
  });

  const handleStartOAuthConnect = async (provider) => {
    const providerLabel = provider === 'google' ? 'Google' : provider === 'microsoft' ? 'Microsoft' : provider;
    stopOAuthPolling();
    setOAuthBusyProvider(provider);
    setOAuthStatusMessage(`Finish ${providerLabel} sign-in in the browser. We'll refresh here automatically.`);

    try {
      await window.calendarApp.startOAuthConnect(provider, 'write');
      oauthPollingDeadlineRef.current = Date.now() + 3 * 60 * 1000;
      oauthPollingRef.current = window.setInterval(async () => {
        try {
          const nextSnapshot = await refreshSnapshot();
          const matchedAccount = (nextSnapshot?.security?.auth?.connectedAccounts || []).find(
            (account) => account.provider === provider && account.emailSendCapable
          );

          if (matchedAccount) {
            stopOAuthPolling();
            setOAuthBusyProvider('');
            setOAuthStatusMessage(`${providerLabel} is ready for email reminders.`);
            return;
          }

          if (Date.now() > oauthPollingDeadlineRef.current) {
            stopOAuthPolling();
            setOAuthBusyProvider('');
            setOAuthStatusMessage(
              `${providerLabel} sign-in is still pending. You can keep the browser flow open and try again from notifications later.`
            );
          }
        } catch {
          // Keep waiting for the browser callback to complete.
        }
      }, 3000);
    } catch (error) {
      stopOAuthPolling();
      setOAuthBusyProvider('');
      setOAuthStatusMessage(error?.message || `${providerLabel} sign-in could not be started.`);
    }
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
          hosted={snapshot?.security?.hosted}
          hostedUrl={hostedUrl}
          onHostedUrlChange={setHostedUrl}
          hostedPassword={hostedPassword}
          onHostedPasswordChange={setHostedPassword}
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
          hostedBusyAction={hostedBusyAction}
          hostedStatusMessage={hostedStatusMessage}
        />
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
          availableTags={availableTags}
          events={events}
          visibleEvents={visibleEvents}
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
          onClearFilters={() => {
            setSearchQuery('');
            setQuickFilter('all');
            setActiveTagFilters([]);
          }}
        />

        <div className="flex min-h-0 min-w-0 flex-col gap-4 overflow-hidden">
          <Header
            eventCount={snapshot?.stats?.activeEventCount || 0}
            onToggleUpcoming={() => setIsUpcomingOpen((current) => !current)}
            onOpenAbout={() => setIsAboutOpen(true)}
            onOpenSettings={() => {
              void openSettingsExperience();
            }}
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
              calendarView={calendarView}
              events={events}
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

      <QuickEventPopover
        isOpen={isQuickComposerOpen}
        mode={composerState.mode}
        anchorPoint={composerState.anchorPoint}
        draftEvent={draftEvent}
        preferences={preferences}
        onClose={closeComposer}
        onFieldChange={handleDraftFieldChange}
        onSelectDuration={handleSelectDuration}
        conflictSummary={conflictSummary}
        onOpenFullDetails={() => setComposerState((current) => promoteComposerStateToDrawer(current))}
        knownNotificationEmails={knownNotificationEmails}
        connectedAccounts={connectedAccounts}
        providers={notificationProviders}
        onConnectProvider={handleStartOAuthConnect}
        oauthBusyProvider={oauthBusyProvider}
        oauthStatusMessage={oauthStatusMessage}
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
        onFindFreeSlot={handleFindFreeSlot}
        conflictSummary={conflictSummary}
        knownNotificationEmails={knownNotificationEmails}
        connectedAccounts={connectedAccounts}
        providers={notificationProviders}
        onConnectProvider={handleStartOAuthConnect}
        oauthBusyProvider={oauthBusyProvider}
        oauthStatusMessage={oauthStatusMessage}
        onDelete={() => handleDeleteEvent(activeEvent)}
        onSubmit={handleSaveEvent}
      />

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
