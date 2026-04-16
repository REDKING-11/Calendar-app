import React, { useMemo, useState } from 'react';
import { isEventOnDate } from '../calendar-helpers';

function formatTime(dateString) {
  return new Date(dateString).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function TodayScheduleControl({ events }) {
  const [isOpen, setIsOpen] = useState(false);
  const userName =
    typeof window !== 'undefined'
      ? window.localStorage.getItem('calendar-user-name') || ''
      : '';

  const todayEvents = useMemo(() => {
    const today = new Date();

    return events
      .filter((event) => isEventOnDate(event, today))
      .sort((left, right) => new Date(left.startsAt) - new Date(right.startsAt));
  }, [events]);

  const firstEvent = todayEvents[0] || null;
  const lastEvent = todayEvents[todayEvents.length - 1] || null;

  return (
    <div className="today-schedule-control">
      <button
        type="button"
        className="calendar-header-button"
        onClick={() => setIsOpen((current) => !current)}
      >
        Today&apos;s schedule
      </button>

      {isOpen ? (
        <section className="day-schedule-popover">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow">Daily plan</p>
              <h3 className="m-0 text-2xl font-semibold text-slate-900">
                Hey {userName || 'there'}, today&apos;s schedule
              </h3>
            </div>
            <button
              type="button"
              className="rounded-full border border-slate-900/12 bg-white/85 px-3 py-2 text-sm text-slate-700 transition hover:bg-white"
              onClick={() => setIsOpen(false)}
            >
              Close
            </button>
          </div>

          {todayEvents.length > 0 ? (
            <div className="grid gap-3">
              <div className="rounded-2xl border border-slate-900/6 bg-white/85 px-4 py-3">
                <p className="m-0 text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">
                  You start at
                </p>
                <p className="mt-2 text-lg font-semibold text-slate-900">
                  {formatTime(firstEvent.startsAt)} {firstEvent.title}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-900/6 bg-white/85 px-4 py-3">
                <p className="m-0 text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Your day ends at
                </p>
                <p className="mt-2 text-lg font-semibold text-slate-900">
                  {formatTime(lastEvent.endsAt)} {lastEvent.title}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-900/6 bg-white/85 px-4 py-3">
                <p className="m-0 text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">
                  Everything today
                </p>
                <div className="mt-3 grid gap-2">
                  {todayEvents.map((event) => (
                    <div
                      key={event.id}
                      className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2"
                    >
                      <span className="text-sm font-semibold text-slate-700">
                        {formatTime(event.startsAt)}
                      </span>
                      <div className="flex-1">
                        <span className="text-sm text-slate-900">{event.title}</span>
                        {event.tags?.length ? (
                          <div className="event-inline-tag-list mt-2">
                            {event.tags.map((tag) => (
                              <span
                                key={tag.id}
                                className="event-inline-tag"
                                style={{
                                  backgroundColor: `${tag.color}22`,
                                  borderColor: `${tag.color}55`,
                                  color: tag.color,
                                }}
                              >
                                {tag.label}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-900/6 bg-white/85 px-4 py-3 text-slate-600">
              Hey {userName || 'there'}, nothing is scheduled for today yet.
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
