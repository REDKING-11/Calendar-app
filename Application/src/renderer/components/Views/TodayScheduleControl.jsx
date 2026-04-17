import React, { useMemo, useState } from 'react';
import { isEventOnDate } from '../calendar-helpers';
import { formatTime } from '../../formatting';

export default function TodayScheduleControl({ events, preferences }) {
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
              <h3 className="m-0 text-2xl font-semibold text-[var(--text-primary)]">
                Hey {userName || 'there'}, today&apos;s schedule
              </h3>
            </div>
            <button
              type="button"
              className="app-button app-button--secondary"
              onClick={() => setIsOpen(false)}
            >
              Close
            </button>
          </div>

          {todayEvents.length > 0 ? (
            <div className="grid gap-3">
              <div className="today-schedule-card rounded-2xl px-4 py-3">
                <p className="m-0 text-sm font-semibold uppercase tracking-[0.12em] app-text-soft">
                  You start at
                </p>
                <p className="mt-2 text-lg font-semibold text-[var(--text-primary)]">
                  {formatTime(firstEvent.startsAt, preferences)} {firstEvent.title}
                </p>
              </div>

              <div className="today-schedule-card rounded-2xl px-4 py-3">
                <p className="m-0 text-sm font-semibold uppercase tracking-[0.12em] app-text-soft">
                  Your day ends at
                </p>
                <p className="mt-2 text-lg font-semibold text-[var(--text-primary)]">
                  {formatTime(lastEvent.endsAt, preferences)} {lastEvent.title}
                </p>
              </div>

              <div className="today-schedule-card rounded-2xl px-4 py-3">
                <p className="m-0 text-sm font-semibold uppercase tracking-[0.12em] app-text-soft">
                  Everything today
                </p>
                <div className="mt-3 grid gap-2">
                  {todayEvents.map((event) => (
                    <div
                      key={event.id}
                      className="today-schedule-event flex items-center justify-between gap-3 rounded-xl px-3 py-2"
                    >
                      <span className="text-sm font-semibold app-text-muted">
                        {formatTime(event.startsAt, preferences)}
                      </span>
                      <div className="flex-1">
                        <span className="text-sm text-[var(--text-primary)]">{event.title}</span>
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
            <div className="today-schedule-card rounded-2xl px-4 py-3 app-text-muted">
              Hey {userName || 'there'}, nothing is scheduled for today yet.
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
