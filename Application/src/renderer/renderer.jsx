import React, { useEffect, useMemo, useState } from 'react';
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

function getVisibleEventsForView(events, calendarView, selectedDate) {
  if (!selectedDate) {
    return events;
  }

  if (calendarView === 'day') {
    return events.filter((event) => isSameDay(new Date(event.startsAt), selectedDate));
  }

  if (calendarView === 'week') {
    const weekStart = startOfWeek(selectedDate);
    const weekEnd = endOfWeek(selectedDate);
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
  const [hostedUrl, setHostedUrl] = useState('');
  const [hostedBusyAction, setHostedBusyAction] = useState('');
  const [hostedStatusMessage, setHostedStatusMessage] = useState('');

  const refreshSnapshot = async () => {
    const nextSnapshot = await window.calendarApp.getSnapshot();
    setSnapshot(nextSnapshot);
    return nextSnapshot;
  };

  useEffect(() => {
    let cancelled = false;

    const loadSnapshot = async () => {
      const nextSnapshot = await window.calendarApp.getSnapshot();
      if (!cancelled) {
        setSnapshot(nextSnapshot);
      }
    };

    loadSnapshot();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const nextBaseUrl = snapshot?.security?.hosted?.baseUrl;
    if (!hostedUrl && nextBaseUrl) {
      setHostedUrl(nextBaseUrl);
    }
  }, [snapshot?.security?.hosted?.baseUrl, hostedUrl]);

  const allEvents = snapshot?.events || [];
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
            eventStart >= startOfWeek(new Date()) &&
            eventStart < endOfWeek(new Date())) ||
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
    [allEvents, normalizedSearchQuery, quickFilter, activeTagFilters]
  );
  const visibleEvents = useMemo(
    () => getVisibleEventsForView(events, calendarView, selectedDate),
    [events, calendarView, selectedDate]
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
      const nextSnapshot = await action();
      setSnapshot(nextSnapshot);
      if (nextSnapshot?.security?.hosted?.baseUrl) {
        setHostedUrl(nextSnapshot.security.hosted.baseUrl);
      }
      if (successMessage) {
        setHostedStatusMessage(successMessage);
      }
    } catch (error) {
      const fallbackMessage =
        error?.message || 'The hosted backend action could not be completed.';
      setHostedStatusMessage(fallbackMessage);
      try {
        await refreshSnapshot();
      } catch (_refreshError) {
        // Keep the current UI state if the store snapshot cannot be reloaded.
      }
    } finally {
      setHostedBusyAction('');
    }
  };

  return (
    <>
      <div className="app-shell overflow-hidden">
        <Sidebar
          availableTags={availableTags}
          events={events}
          visibleEvents={visibleEvents}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          onCreateEvent={openComposer}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          quickFilter={quickFilter}
          onQuickFilterChange={setQuickFilter}
          activeTagFilters={activeTagFilters}
          onToggleTagFilter={handleToggleTagFilter}
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
            timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
            onToggleSetup={() => setIsSetupOpen((current) => !current)}
            isSetupOpen={isSetupOpen}
          />

          <Introduction isOpen={isSetupOpen} onOpenChange={setIsSetupOpen} />

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
        onStartHostedConnect={(provider) =>
          handleHostedAction(
            `connect-${provider}`,
            () => window.calendarApp.startHostedSyncConnect(hostedUrl, provider),
            `Browser sign-in opened for ${provider}. Finish the approval in the browser, then come back here.`
          )
        }
        onPollHostedAuth={() =>
          handleHostedAction(
            'finish-auth',
            () => window.calendarApp.pollHostedSyncAuth(),
            'Hosted sign-in status refreshed.'
          )
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
        hostedBusyAction={hostedBusyAction}
        hostedStatusMessage={hostedStatusMessage}
      />
    </>
  );
}

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<App />);
