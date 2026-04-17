import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import AboutDrawer from './components/AboutDrawer';
import CalendarViewport from './components/CalendarViewport';
import EventComposerDrawer from './components/EventComposerDrawer';
import EventOverviewPopover from './components/EventOverviewPopover';
import Header from './components/Header';
import Introduction from './components/introduction';
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
import './styles.css';

const SETUP_COMPLETE_STORAGE_KEY = 'calendar-setup-complete';
const HOSTED_EMAIL_STORAGE_KEY = 'calendar-hosted-email';
const HOSTED_DEVICE_NAME_STORAGE_KEY = 'calendar-hosted-device-name';
const HOLIDAY_PRELOAD_STATUS = {
  idle: 'idle',
  loading: 'loading',
  ready: 'ready',
  error: 'error',
};

function getHolidaySeedYears() {
  const currentYear = new Date().getFullYear();
  return [currentYear, currentYear + 1];
}

function getVisibleEventsForView(events, calendarView, selectedDate, timeZone) {
  if (!selectedDate) {
    return events;
  }

  if (calendarView === 'day') {
    return events.filter((event) => isSameDay(new Date(event.startsAt), selectedDate));
  }

  if (calendarView === 'week') {
    const weekStart = startOfWeek(selectedDate, timeZone);
    const weekEnd = endOfWeek(selectedDate, timeZone);
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

function App() {
  const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [snapshot, setSnapshot] = useState(null);
  const [draftEvent, setDraftEvent] = useState(() => createEmptyDraftEvent(new Date()));
  const [draftTag, setDraftTag] = useState(createEmptyDraftTag);
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState('create');
  const [activeEvent, setActiveEvent] = useState(null);
  const [calendarView, setCalendarView] = useState('month');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [searchQuery, setSearchQuery] = useState('');
  const [quickFilter, setQuickFilter] = useState('all');
  const [activeTagFilters, setActiveTagFilters] = useState([]);
  const [isUpcomingOpen, setIsUpcomingOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [isSetupComplete, setIsSetupComplete] = useState(() => {
    if (typeof window === 'undefined') {
      return true;
    }

    const persistedSetupComplete = window.localStorage.getItem(SETUP_COMPLETE_STORAGE_KEY);
    if (persistedSetupComplete !== null) {
      return persistedSetupComplete === 'true';
    }

    return Boolean(
      window.localStorage.getItem('calendar-user-country') ||
        window.localStorage.getItem('calendar-user-timezone') ||
        window.localStorage.getItem('calendar-user-name')
    );
  });
  const [userTimeZone, setUserTimeZone] = useState(() => {
    if (typeof window === 'undefined') {
      return detectedTimeZone;
    }

    return window.localStorage.getItem('calendar-user-timezone') || detectedTimeZone;
  });
  const [userCountryCode, setUserCountryCode] = useState(() => {
    if (typeof window === 'undefined') {
      return '';
    }

    return window.localStorage.getItem('calendar-user-country') || '';
  });
  const [holidayPreloadState, setHolidayPreloadState] = useState({
    countryCode: '',
    status: HOLIDAY_PRELOAD_STATUS.idle,
  });
  const [hostedUrl, setHostedUrl] = useState('');
  const [hostedEmail, setHostedEmail] = useState(() => {
    if (typeof window === 'undefined') {
      return '';
    }

    return window.localStorage.getItem(HOSTED_EMAIL_STORAGE_KEY) || '';
  });
  const [hostedPassword, setHostedPassword] = useState('');
  const [hostedDeviceName, setHostedDeviceName] = useState(() => {
    if (typeof window === 'undefined') {
      return '';
    }

    return window.localStorage.getItem(HOSTED_DEVICE_NAME_STORAGE_KEY) || '';
  });
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
    const nextBaseUrl = snapshot?.security?.hosted?.baseUrl;
    if (!hostedUrl && nextBaseUrl) {
      setHostedUrl(nextBaseUrl);
    }
  }, [snapshot?.security?.hosted?.baseUrl, hostedUrl]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(HOSTED_EMAIL_STORAGE_KEY, hostedEmail);
  }, [hostedEmail]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(HOSTED_DEVICE_NAME_STORAGE_KEY, hostedDeviceName);
  }, [hostedDeviceName]);

  const allEvents = snapshot?.events || [];

  const persistSetupComplete = (isComplete) => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(SETUP_COMPLETE_STORAGE_KEY, isComplete ? 'true' : 'false');
  };

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
        timeZone: userTimeZone,
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

  const applySetupPreferences = async ({ countryCode, timeZone }) => {
    const nextTimeZone = timeZone || detectedTimeZone;
    setUserCountryCode(countryCode || '');
    setUserTimeZone(nextTimeZone);
    setIsSetupComplete(true);
    persistSetupComplete(true);

    if (countryCode) {
      void window.calendarApp
        .importHolidays({
          countryCode,
          years: getHolidaySeedYears(),
          timeZone: nextTimeZone,
        })
        .then((result) => {
          if (result?.snapshot) {
            snapshotRef.current = result.snapshot;
            setSnapshot(result.snapshot);
          }

          if (result?.warning) {
            setHolidayPreloadState({
              countryCode,
              status: HOLIDAY_PRELOAD_STATUS.error,
            });
          }
        })
        .catch(() => {
          setHolidayPreloadState({
            countryCode,
            status: HOLIDAY_PRELOAD_STATUS.error,
          });
        });
    }

    return {
      warning:
        countryCode &&
        holidayPreloadState.countryCode === countryCode &&
        holidayPreloadState.status === HOLIDAY_PRELOAD_STATUS.error
          ? 'Settings were saved, but holidays could not be imported right now.'
          : '',
    };
  };

  const handleSkipSetup = () => {
    setIsSetupComplete(true);
    persistSetupComplete(true);
    setIsSetupOpen(false);
  };

  const availableTags = useMemo(
    () => collectAvailableTags(allEvents, snapshot?.tags || []),
    [allEvents, snapshot?.tags]
  );
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const events = useMemo(
    () =>
      allEvents.filter((event) => {
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
            eventStart >= startOfWeek(new Date(), userTimeZone) &&
            eventStart < endOfWeek(new Date(), userTimeZone)) ||
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
    [allEvents, normalizedSearchQuery, quickFilter, activeTagFilters, userTimeZone]
  );
  const visibleEvents = useMemo(
    () => getVisibleEventsForView(events, calendarView, selectedDate, userTimeZone),
    [events, calendarView, selectedDate, userTimeZone]
  );

  const upcomingDays = useMemo(
    () =>
      events.slice(0, 5).map((event) => {
        const startsAt = new Date(event.startsAt);
        return {
          id: event.id,
          day: startsAt.toLocaleDateString('en-US', { weekday: 'short' }),
          date: startsAt.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          }),
          time: startsAt.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
          }),
          focus: event.title,
          startsAt,
        };
      }),
    [events]
  );

  const openComposer = (date = new Date()) => {
    setActiveEvent(null);
    setComposerMode('create');
    setSelectedDate(date);
    setDraftEvent(createEmptyDraftEvent(date));
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
    setDraftEvent((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleDraftTagChange = (event) => {
    const { name, value } = event.target;
    setDraftTag((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleAddTag = (availableTags = []) => {
    if (!draftTag.label.trim()) {
      return;
    }

    const matchingTag = availableTags.find(
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
        ? new Date(new Date(`${draftEvent.date}T${draftEvent.time}:00`).getTime() + 30 * 60 * 1000)
        : new Date(`${draftEvent.date}T${draftEvent.endTime}:00`);

    if (endsAt <= startsAt) {
      endsAt.setHours(startsAt.getHours() + 1);
      endsAt.setMinutes(startsAt.getMinutes());
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
      } catch (_refreshError) {
        // Keep the current UI state if the store snapshot cannot be reloaded.
      }
      return null;
    } finally {
      setHostedBusyAction('');
    }
  };

  const buildHostedCredentials = () => ({
    baseUrl: hostedUrl,
    email: hostedEmail,
    password: hostedPassword,
    deviceName: hostedDeviceName,
  });

  if (!isSetupComplete) {
    return (
      <Introduction
        isOpen
        variant="onboarding"
        preloadState={holidayPreloadState}
        onCountryChange={prepareHolidayPreload}
        onOpenChange={() => {}}
        onSavePreferences={applySetupPreferences}
        onSkip={handleSkipSetup}
      />
    );
  }

  return (
    <>
      <div className="app-shell overflow-hidden">
        <Sidebar
          availableTags={availableTags}
          events={events}
          visibleEvents={visibleEvents}
          timeZone={userTimeZone}
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
            timeZone={userTimeZone}
            onToggleSetup={() => setIsSetupOpen((current) => !current)}
            isSetupOpen={isSetupOpen}
          />

          <Introduction
            isOpen={isSetupOpen}
            variant="panel"
            onOpenChange={setIsSetupOpen}
            preloadState={holidayPreloadState}
            onCountryChange={prepareHolidayPreload}
            onSavePreferences={applySetupPreferences}
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
              selectedDate={selectedDate}
              timeZone={userTimeZone}
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
                onEdit={(event) => {
                  setActiveEvent(null);
                  openEditComposer(event);
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
        hostedUrl={hostedUrl}
        onHostedUrlChange={setHostedUrl}
        hostedEmail={hostedEmail}
        onHostedEmailChange={setHostedEmail}
        hostedPassword={hostedPassword}
        onHostedPasswordChange={setHostedPassword}
        hostedDeviceName={hostedDeviceName}
        onHostedDeviceNameChange={setHostedDeviceName}
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
          )
            .then((result) => {
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

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<App />);
