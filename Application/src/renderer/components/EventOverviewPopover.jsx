import React from 'react';

function formatDateTime(dateString) {
  return new Date(dateString).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatTypeLabel(type) {
  if (!type) {
    return 'Event';
  }

  return `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}

export default function EventOverviewPopover({
  event,
  onClose,
  onEdit,
  onDelete,
}) {
  if (!event) {
    return null;
  }

  return (
    <div className="event-overview-popover">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Event overview</p>
          <h3 className="m-0 text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
            {event.title}
          </h3>
        </div>
        <button
          type="button"
          className="app-button app-button--secondary"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      <div className="event-overview-card-list">
        <div className="event-overview-card">
          <p className="event-overview-label">Type</p>
          <p className="event-overview-value">{formatTypeLabel(event.type)}</p>
        </div>

        {event.type === 'task' ? (
          <>
            <div className="event-overview-card">
              <p className="event-overview-label">Status</p>
              <p className="event-overview-value">
                {event.completed ? 'Completed' : 'Open'}
              </p>
            </div>

            <div className="event-overview-card">
              <p className="event-overview-label">Repeat</p>
              <p className="event-overview-value">
                {event.repeat === 'none'
                  ? 'Does not repeat'
                  : `${event.repeat.charAt(0).toUpperCase()}${event.repeat.slice(1)}`}
              </p>
            </div>

            <div className="event-overview-card">
              <p className="event-overview-label">Deadline</p>
              <p className="event-overview-value">
                {event.hasDeadline ? 'Has a deadline' : 'Flexible'}
              </p>
            </div>

            <div className="event-overview-card">
              <p className="event-overview-label">Group</p>
              <p className="event-overview-value">
                {event.groupName?.trim() || 'No group yet'}
              </p>
            </div>
          </>
        ) : null}

        <div className="event-overview-card">
          <p className="event-overview-label">Description</p>
          <p className="event-overview-value">
            {event.description?.trim() || 'No description yet.'}
          </p>
        </div>

        <div className="event-overview-card">
          <p className="event-overview-label">Starts</p>
          <p className="event-overview-value">{formatDateTime(event.startsAt)}</p>
        </div>

        <div className="event-overview-card">
          <p className="event-overview-label">Ends</p>
          <p className="event-overview-value">{formatDateTime(event.endsAt)}</p>
        </div>

        <div className="event-overview-card">
          <p className="event-overview-label">Color</p>
          <div className="flex items-center gap-3">
            <span
              className="h-4 w-4 rounded-full"
              style={{ backgroundColor: event.color || '#4f9d69' }}
            />
            <p className="event-overview-value">{event.color || '#4f9d69'}</p>
          </div>
        </div>

        <div className="event-overview-card">
          <p className="event-overview-label">Tags</p>
          {event.tags?.length ? (
            <div className="event-tag-list">
              {event.tags.map((tag) => (
                <span
                  key={tag.id}
                  className="event-tag-chip"
                  style={{
                    backgroundColor: `${tag.color}22`,
                    borderColor: `${tag.color}66`,
                    color: tag.color,
                  }}
                >
                  <span className="event-tag-dot" style={{ backgroundColor: tag.color }} />
                  {tag.label}
                </span>
              ))}
            </div>
          ) : (
            <p className="event-overview-value app-text-soft">No tags</p>
          )}
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2.5">
        <button
          type="button"
          className="app-button app-danger-button"
          onClick={() => onDelete?.(event)}
        >
          Delete
        </button>
        <button
          type="button"
          className="app-button app-button--primary"
          onClick={() => onEdit?.(event)}
        >
          Edit event
        </button>
      </div>
    </div>
  );
}
