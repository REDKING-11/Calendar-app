import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import AboutDrawer from './components/AboutDrawer';
import CalendarViewport from './components/CalendarViewport';
import EventComposerDrawer from './components/EventComposerDrawer';
import EventOverviewPopover from './components/EventOverviewPopover';
import Header from './components/Header';
import Introduction from './components/introduction';
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
  createDraftEventFromEvent,
  createDraftTagId,
  createEmptyDraftEvent,
  createEmptyDraftTag,
} from './eventDraft';
import { STORAGE_KEYS, useCalendarPreferences, updatePreference } from './preferences';
import './styles.css';

const HOLIDAY_PRELOAD_STATUS = {
  idle: 'idle',
  loading: 'loading',
  ready: 'ready',
  error: 'error',
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

function App() {
  const windowMode = getWindowMode();
  const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { preferences, setPreferences, effectiveTheme } = useCalendarPreferences();
  const [snapshot, setSnapshot] = useState(null);
  const [draftEvent, setDraftEvent] = useState(() =>
    createEmptyDraftEvent(new Date(), preferences.defaultEventDuration)
  );
  const [draftTag, setDraftTag] = useState(createEmptyDraftTag);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState('create');
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
  const snapshotRef = useRef(null);
  const holidayPreloadRequestRef = useRef(0);

  const refreshSnapshot = async () => {
    const nextSnapshot = await window.calendarApp.getSnapshot();
    snapshotRef.current = nextSnapshot;
    setSnapshot(nextSnapshot);
    return nextSnapshot;
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

  useEffect(() => {
    if (!hostedUrl && snapshot?.security?.hosted?.baseUrl) {
      setHostedUrl(snapshot.security.hosted.baseUrl);
    }
  }, [snapshot?.security?.hosted?.baseUrl, hostedUrl]);

  useEffect(() => {
    setCalendarView(preferences.defaultView);
  }, [preferences.defaultView]);

  const allEvents = snapshot?.events || [];

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

  const importHolidayPreferences = async ({ countryCode, timeZone, name }) => {
    const nextTimeZone = timeZone || detectedTimeZone;
    updatePreference(setPreferences, {
      countryCode: countryCode || '',
      timeZone: nextTimeZone,
      name: typeof name === 'string' ? name : preferences.name,
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
        if (!preferences.showCompletedTasks && event.type === 'task' && event.completed) {
          return false;
        }

        const eventStart = new Date(event.startsAt);
        const matchesSearch =
          !normalizedSearchQuery ||
          event.title.toLowerCase().includes(normalizedSearchQuery) ||
          (event.tags || []).some((tag) =>
            tag.label.toLowerCase().includes(normalizedSearchQuery)
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

  const openComposer = (date = new Date()) => {
    setActiveEvent(null);
    setComposerMode('create');
    setSelectedDate(date);
    setDraftEvent(createEmptyDraftEvent(date, preferences.defaultEventDuration));
    setDraftTag(createEmptyDraftTag());
    setIsComposerOpen(true);
  };

  const openEditComposer = (event) => {
    setActiveEvent(event);
    setComposerMode('edit');
    setSelectedDate(new Date(event.startsAt));
    setDraftEvent(createDraftEventFromEvent(event));
    setDraftTag(createEmptyDraftTag());
    setIsComposerOpen(true);
  };

  const closeComposer = () => {
    setIsComposerOpen(false);
    setComposerMode('create');
  };

  const handleDraftChange = (event) => {
    const { name, value } = event.target;

    setDraftEvent((current) => {
      const nextDraft = {
        ...current,
        [name]: value,
      };

      if (name === 'type' && value === 'task' && !current.endTime) {
        const startDate = new Date(`${current.date}T${current.time}:00`);
        startDate.setMinutes(startDate.getMinutes() + preferences.defaultTaskDuration);
        nextDraft.endTime = startDate.toTimeString().slice(0, 5);
      }

      return nextDraft;
    });
  };

  const handleDraftTagChange = (event) => {
    const { name, value } = event.target;
    setDraftTag((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleAddTag = (nextAvailableTags = []) => {
    if (!draftTag.label.trim()) {
      return;
    }

    const matchingTag = nextAvailableTags.find(
      (tag) => tag.label.toLowerCase() === draftTag.label.trim().toLowerCase()
    );

    setDraftEvent((current) => ({
      ...current,
      tags: current.tags.some(
        (tag) => tag.label.toLowerCase() === draftTag.label.trim().toLowerCase()
      )
        ? current.tags
        : [
            ...current.tags,
            matchingTag || {
              id: createDraftTagId(),
              label: draftTag.label.trim(),
              color: draftTag.color,
            },
          ],
    }));
    setDraftTag((current) => ({
      ...current,
      label: '',
    }));
  };

  const handleRemoveTag = (tagId) => {
    setDraftEvent((current) => ({
      ...current,
      tags: current.tags.filter((tag) => tag.id !== tagId),
    }));
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

  const handleCreateEvent = async (event) => {
    event.preventDefault();

    if (
      !draftEvent.title.trim() ||
      !draftEvent.date ||
      !draftEvent.time ||
      (draftEvent.type !== 'task' && !draftEvent.endTime)
    ) {
      return;
    }

    const startsAt = new Date(`${draftEvent.date}T${draftEvent.time}:00`);
    const endsAt =
      draftEvent.type === 'task'
        ? new Date(
            new Date(`${draftEvent.date}T${draftEvent.time}:00`).getTime() +
              preferences.defaultTaskDuration * 60 * 1000
          )
        : new Date(`${draftEvent.date}T${draftEvent.endTime}:00`);

    if (endsAt <= startsAt) {
      endsAt.setMinutes(startsAt.getMinutes() + preferences.defaultEventDuration);
    }

    const nextSnapshot =
      composerMode === 'edit' && activeEvent
        ? await window.calendarApp.updateEvent({
            id: activeEvent.id,
            title: draftEvent.title.trim(),
            description: draftEvent.description.trim(),
            type: draftEvent.type,
            completed: Boolean(draftEvent.completed),
            repeat: draftEvent.type === 'task' ? draftEvent.repeat : 'none',
            hasDeadline: draftEvent.type === 'task' ? Boolean(draftEvent.hasDeadline) : false,
            groupName: draftEvent.type === 'task' ? draftEvent.groupName.trim() : '',
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            color: draftEvent.color,
            tags: draftEvent.tags,
          })
        : await window.calendarApp.createEvent({
            title: draftEvent.title.trim(),
            description: draftEvent.description.trim(),
            type: draftEvent.type,
            completed: Boolean(draftEvent.completed),
            repeat: draftEvent.type === 'task' ? draftEvent.repeat : 'none',
            hasDeadline: draftEvent.type === 'task' ? Boolean(draftEvent.hasDeadline) : false,
            groupName: draftEvent.type === 'task' ? draftEvent.groupName.trim() : '',
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            color: draftEvent.color,
            tags: draftEvent.tags,
          });

    setSnapshot(nextSnapshot);
    setActiveEvent(null);
    closeComposer();
  };

  const handleDeleteEvent = async (eventToDelete) => {
    const nextSnapshot = await window.calendarApp.deleteEvent(eventToDelete.id);
    setSnapshot(nextSnapshot);
    setActiveEvent(null);
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
          onCreateEvent={openComposer}
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
                  setActiveEvent(null);
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
              onCreateEvent={openComposer}
              onSelectEvent={setActiveEvent}
              onChangeView={setCalendarView}
              onSelectMonth={(date) => {
                setSelectedDate(date);
                setCalendarView('month');
              }}
            />

            {activeEvent ? (
              <EventOverviewPopover
                event={activeEvent}
                onClose={() => setActiveEvent(null)}
                onEdit={(currentEvent) => {
                  setActiveEvent(null);
                  openEditComposer(currentEvent);
                }}
                onDelete={handleDeleteEvent}
              />
            ) : null}
          </main>
        </div>
      </div>

      <div
        className={`event-drawer-overlay ${isComposerOpen || isAboutOpen ? 'event-drawer-overlay--open' : ''}`}
        onClick={() => {
          closeComposer();
          setActiveEvent(null);
          setIsAboutOpen(false);
          setIsUpcomingOpen(false);
        }}
        aria-hidden={!isComposerOpen && !isAboutOpen}
      />

      <EventComposerDrawer
        isOpen={isComposerOpen}
        mode={composerMode}
        draftEvent={draftEvent}
        draftTag={draftTag}
        availableTags={availableTags}
        onClose={closeComposer}
        onDraftChange={handleDraftChange}
        onDraftTagChange={handleDraftTagChange}
        onAddTag={() => handleAddTag(availableTags)}
        onAddExistingTag={(tag) => {
          setDraftEvent((current) => {
            if (current.tags.some((item) => item.label.toLowerCase() === tag.label.toLowerCase())) {
              return current;
            }

            return {
              ...current,
              tags: [...current.tags, tag],
            };
          });
        }}
        onRemoveTag={handleRemoveTag}
        onSubmit={handleCreateEvent}
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
