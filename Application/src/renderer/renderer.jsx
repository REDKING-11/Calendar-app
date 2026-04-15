import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Header from './components/Header';
import HeroCard from './components/HeroCard';
import DayView from './components/Views/DayView';
import MonthView from './components/Views/MonthView';
import WeekView from './components/Views/WeekView';
import YearView from './components/Views/YearView';
import Introduction from './components/introduction';
import './styles.css';

function formatDateForInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTimeForInput(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function App() {
  const [snapshot, setSnapshot] = useState(null);
  const [draftEvent, setDraftEvent] = useState({
    title: '',
    date: formatDateForInput(new Date()),
    time: '10:00',
  });
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [calendarView, setCalendarView] = useState('month');
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isUpcomingOpen, setIsUpcomingOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isSetupOpen, setIsSetupOpen] = useState(false);

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

  const openComposer = (selectedDate = new Date()) => {
    const defaultTime =
      selectedDate.getHours() === 0 && selectedDate.getMinutes() === 0
        ? '09:00'
        : formatTimeForInput(selectedDate);

    setSelectedDate(selectedDate);
    setDraftEvent({
      title: '',
      date: formatDateForInput(selectedDate),
      time: defaultTime,
    });
    setIsComposerOpen(true);
  };

  const closeComposer = () => {
    setIsComposerOpen(false);
  };

  const handleDraftChange = (event) => {
    const { name, value } = event.target;
    setDraftEvent((current) => ({
      ...current,
      [name]: value,
    }));
  };

  const handleCreateEvent = async (event) => {
    event.preventDefault();

    if (!draftEvent.title.trim() || !draftEvent.date || !draftEvent.time) {
      return;
    }

    const startsAt = new Date(`${draftEvent.date}T${draftEvent.time}:00`);
    const endsAt = new Date(startsAt);
    endsAt.setHours(endsAt.getHours() + 1);

    const nextSnapshot = await window.calendarApp.createEvent({
      title: draftEvent.title.trim(),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      color: '#4f9d69',
    });

    setSnapshot(nextSnapshot);
    closeComposer();
  };

  const upcomingDays = (snapshot?.events || []).slice(0, 5).map((event) => {
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
  });

  return (
    <>
      <div className="flex h-screen flex-col overflow-hidden">
        <Header
          eventCount={snapshot?.stats?.activeEventCount || 0}
          onToggleUpcoming={() => setIsUpcomingOpen((current) => !current)}
          onOpenAbout={() => setIsAboutOpen(true)}
          timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
          onToggleSetup={() => setIsSetupOpen((current) => !current)}
          isSetupOpen={isSetupOpen}
        />
        <Introduction isOpen={isSetupOpen} onOpenChange={setIsSetupOpen} />
        <main className="mx-auto grid min-h-0 w-full max-w-[1800px] flex-1 grid-cols-1 gap-6 overflow-hidden px-6 pb-6 pt-4 xl:grid-cols-[1fr] xl:grid-rows-[minmax(0,1fr)] xl:px-8">
          <div className="relative min-h-0">
            {isUpcomingOpen ? (
              <section className="upcoming-popover">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
                      Quick view
                    </p>
                    <h2 className="m-0 text-2xl font-semibold text-slate-900">
                      What&apos;s up next
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsUpcomingOpen(false)}
                    className="rounded-full border border-slate-900/12 bg-white/85 px-3 py-2 text-sm text-slate-700 transition hover:bg-white"
                  >
                    Close
                  </button>
                </div>

                <div className="grid gap-3">
                  {upcomingDays.length > 0 ? (
                    upcomingDays.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="grid gap-1 rounded-2xl border border-slate-900/6 bg-white/90 px-4 py-3 text-left transition hover:bg-white"
                        onClick={() => {
                          setSelectedDate(item.startsAt);
                          setIsUpcomingOpen(false);
                        }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-semibold text-slate-500">
                            {item.day} {item.date}
                          </span>
                          <span className="text-sm text-slate-500">{item.time}</span>
                        </div>
                        <p className="m-0 text-base font-medium text-slate-900">
                          {item.focus}
                        </p>
                      </button>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-slate-900/6 bg-white/90 px-4 py-3 text-slate-600">
                      Nothing scheduled yet.
                    </div>
                  )}
                </div>
              </section>
            ) : null}

            <div className="h-full min-h-0">
              {calendarView === 'day' ? (
                <DayView
                  events={snapshot?.events || []}
                  selectedDate={selectedDate}
                  onSelectDate={setSelectedDate}
                  onCreateEvent={openComposer}
                  calendarView={calendarView}
                  onChangeView={setCalendarView}
                />
              ) : null}
              {calendarView === 'month' ? (
                <MonthView
                  events={snapshot?.events || []}
                  onCreateEvent={openComposer}
                  selectedDate={selectedDate}
                  onSelectDate={setSelectedDate}
                  calendarView={calendarView}
                  onChangeView={setCalendarView}
                />
              ) : null}
              {calendarView === 'week' ? (
                <WeekView
                  events={snapshot?.events || []}
                  selectedDate={selectedDate}
                  onSelectDate={setSelectedDate}
                  onCreateEvent={openComposer}
                  calendarView={calendarView}
                  onChangeView={setCalendarView}
                />
              ) : null}
              {calendarView === 'year' ? (
                <YearView
                  events={snapshot?.events || []}
                  selectedDate={selectedDate}
                  onSelectDate={setSelectedDate}
                  onCreateEvent={openComposer}
                  onSelectMonth={(date) => {
                    setSelectedDate(date);
                    setCalendarView('month');
                  }}
                  calendarView={calendarView}
                  onChangeView={setCalendarView}
                />
              ) : null}
            </div>
          </div>
        </main>
      </div>

      <div
        className={`event-drawer-overlay ${
          isComposerOpen || isAboutOpen ? 'event-drawer-overlay--open' : ''
        }`}
        onClick={() => {
          closeComposer();
          setIsAboutOpen(false);
          setIsUpcomingOpen(false);
        }}
        aria-hidden={!isComposerOpen && !isAboutOpen}
      />

      <aside
        className={`event-drawer ${isComposerOpen ? 'event-drawer--open' : ''}`}
        aria-hidden={!isComposerOpen}
      >
        <section className="h-full rounded-r-[28px] border-r border-slate-900/8 bg-white/88 p-6 shadow-[0_24px_70px_rgba(36,52,89,0.18)] backdrop-blur-xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
                New event
              </p>
              <h2 className="m-0 text-3xl font-semibold tracking-tight text-slate-900">
                Create local event
              </h2>
            </div>
            <button
              type="button"
              className="rounded-full border border-slate-900/12 bg-white/85 px-4 py-2.5 text-slate-800 transition hover:bg-white"
              onClick={closeComposer}
            >
              Close
            </button>
          </div>

          <form className="mt-5 grid gap-3" onSubmit={handleCreateEvent}>
            <label htmlFor="event-title" className="text-sm font-medium text-slate-700">
              Title
            </label>
            <input
              id="event-title"
              name="title"
              type="text"
              value={draftEvent.title}
              onChange={handleDraftChange}
              placeholder="Pairing flow review"
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            />

            <label htmlFor="event-date" className="text-sm font-medium text-slate-700">
              Date
            </label>
            <input
              id="event-date"
              name="date"
              type="date"
              value={draftEvent.date}
              onChange={handleDraftChange}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            />

            <label htmlFor="event-time" className="text-sm font-medium text-slate-700">
              Time
            </label>
            <input
              id="event-time"
              name="time"
              type="time"
              value={draftEvent.time}
              onChange={handleDraftChange}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            />

            <div className="mt-2 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={closeComposer}
                className="rounded-full border border-slate-900/12 bg-white/85 px-4 py-2.5 text-slate-800 transition hover:bg-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-full bg-slate-900 px-4 py-2.5 text-white transition hover:bg-slate-800"
              >
                Save event
              </button>
            </div>
          </form>
        </section>
      </aside>

      <aside
        className={`about-drawer ${isAboutOpen ? 'about-drawer--open' : ''}`}
        aria-hidden={!isAboutOpen}
      >
        <section className="h-full overflow-auto rounded-l-[28px] border-l border-slate-900/8 bg-white/92 p-6 shadow-[0_24px_70px_rgba(36,52,89,0.18)] backdrop-blur-xl">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
                Learn more
              </p>
              <h2 className="m-0 text-3xl font-semibold tracking-tight text-slate-900">
                About this app
              </h2>
            </div>
            <button
              type="button"
              className="rounded-full border border-slate-900/12 bg-white/85 px-4 py-2.5 text-slate-800 transition hover:bg-white"
              onClick={() => setIsAboutOpen(false)}
            >
              Close
            </button>
          </div>

          <HeroCard
            platform={window.calendarApp.platform}
            deviceId={snapshot?.deviceId}
            changeCount={snapshot?.stats?.changeCount || 0}
            activeEventCount={snapshot?.stats?.activeEventCount || 0}
          />
        </section>
      </aside>
    </>
  );
}

const container = document.getElementById('root');
const root = createRoot(container);
root.render(<App />);
