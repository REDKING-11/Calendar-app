import React from 'react';
import {
  COLOR_PRESETS,
  EVENT_TYPE_OPTIONS,
  TAG_COLOR_PRESETS,
  TASK_REPEAT_OPTIONS,
} from '../eventDraft';

export default function EventComposerDrawer({
  isOpen,
  mode = 'create',
  draftEvent,
  draftTag,
  availableTags,
  onClose,
  onDraftChange,
  onDraftTagChange,
  onAddTag,
  onAddExistingTag,
  onRemoveTag,
  onSubmit,
}) {
  const reusableTags = (availableTags || []).filter(
    (tag) =>
      !draftEvent.tags.some(
        (draftItem) => draftItem.label.toLowerCase() === tag.label.toLowerCase()
      )
  );
  const isTask = draftEvent.type === 'task';
  const isAppointment = draftEvent.type === 'appointment';
  const timeLabel = isTask ? 'Due time' : 'Start time';
  const descriptionPlaceholder = isTask
    ? 'What needs to get done?'
    : isAppointment
      ? 'Anything important to remember for this appointment?'
      : 'What should you remember about this event?';

  return (
    <aside className={`event-drawer ${isOpen ? 'event-drawer--open' : ''}`} aria-hidden={!isOpen}>
      <section className="flex h-full flex-col rounded-r-[28px] border-r border-slate-900/8 bg-white/88 p-5 shadow-[0_24px_70px_rgba(36,52,89,0.18)] backdrop-blur-xl">
        <div className="event-composer-top flex items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
              {mode === 'edit' ? 'Edit event' : 'New event'}
            </p>
            <h2 className="m-0 text-[2rem] font-semibold tracking-tight text-slate-900">
              {mode === 'edit' ? 'Update event details' : 'Create local event'}
            </h2>
          </div>
          <button
            type="button"
            className="rounded-full border border-slate-900/12 bg-white/85 px-4 py-2.5 text-slate-800 transition hover:bg-white"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <form className="event-composer-layout mt-4 min-h-0 flex-1" onSubmit={onSubmit}>
          <div className="event-composer-scroll">
            <div className="event-type-row">
            {EVENT_TYPE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`event-type-pill ${
                  draftEvent.type === option.id ? 'event-type-pill--active' : ''
                }`}
                onClick={() => onDraftChange({ target: { name: 'type', value: option.id } })}
              >
                {option.label}
              </button>
            ))}
            </div>

            <div className="event-composer-field">
              <label htmlFor="event-title" className="text-sm font-medium text-slate-700">
                Title
              </label>
              <input
                id="event-title"
                name="title"
                type="text"
                value={draftEvent.title}
                onChange={onDraftChange}
                placeholder="Pairing flow review"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              />
            </div>

            <div className="event-composer-field">
              <label htmlFor="event-description" className="text-sm font-medium text-slate-700">
                Description
              </label>
              <textarea
                id="event-description"
                name="description"
                value={draftEvent.description}
                onChange={onDraftChange}
                placeholder={descriptionPlaceholder}
                rows={3}
                className="w-full resize-none rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
              />
            </div>

            <div className="event-composer-grid">
              <div className="event-composer-field">
                <label htmlFor="event-date" className="text-sm font-medium text-slate-700">
                  Date
                </label>
                <input
                  id="event-date"
                  name="date"
                  type="date"
                  value={draftEvent.date}
                  onChange={onDraftChange}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                />
              </div>

              <div className="event-composer-field">
                <label htmlFor="event-time" className="text-sm font-medium text-slate-700">
                  {timeLabel}
                </label>
                <input
                  id="event-time"
                  name="time"
                  type="time"
                  value={draftEvent.time}
                  onChange={onDraftChange}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                />
              </div>

              {!isTask ? (
                <div className="event-composer-field">
                  <label htmlFor="event-end-time" className="text-sm font-medium text-slate-700">
                    End time
                  </label>
                  <input
                    id="event-end-time"
                    name="endTime"
                    type="time"
                    value={draftEvent.endTime}
                    onChange={onDraftChange}
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  />
                </div>
              ) : null}
            </div>

            {isTask ? (
              <>
                <div className="event-composer-grid">
                  <div className="event-composer-field">
                    <label htmlFor="task-repeat" className="text-sm font-medium text-slate-700">
                      Repeat
                    </label>
                    <select
                      id="task-repeat"
                      name="repeat"
                      value={draftEvent.repeat}
                      onChange={onDraftChange}
                      className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    >
                      {TASK_REPEAT_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                    <input
                      name="hasDeadline"
                      type="checkbox"
                      checked={Boolean(draftEvent.hasDeadline)}
                      onChange={(event) =>
                        onDraftChange({
                          target: {
                            name: 'hasDeadline',
                            value: event.target.checked,
                          },
                        })
                      }
                    />
                    Has a deadline
                  </label>
                </div>

                <div className="event-composer-field">
                  <label htmlFor="task-group" className="text-sm font-medium text-slate-700">
                    Group
                  </label>
                  <input
                    id="task-group"
                    name="groupName"
                    type="text"
                    value={draftEvent.groupName}
                    onChange={onDraftChange}
                    placeholder="Optional group, e.g. Home, Work, Launch prep"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  />
                </div>

                {mode === 'edit' ? (
                  <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                    <input
                      name="completed"
                      type="checkbox"
                      checked={Boolean(draftEvent.completed)}
                      onChange={(event) =>
                        onDraftChange({
                          target: {
                            name: 'completed',
                            value: event.target.checked,
                          },
                        })
                      }
                    />
                    Mark task as completed
                  </label>
                ) : null}
              </>
            ) : null}

            {!isTask ? (
              <>
                <div className="event-composer-field">
                  <label htmlFor="event-color" className="text-sm font-medium text-slate-700">
                    Color
                  </label>
                  <div className="event-color-picker-row event-color-picker-row--compact">
                    <div className="event-color-row">
                      {COLOR_PRESETS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          className={`event-color-swatch ${
                            draftEvent.color === color ? 'event-color-swatch--active' : ''
                          }`}
                          style={{ backgroundColor: color }}
                          onClick={() => onDraftChange({ target: { name: 'color', value: color } })}
                          aria-label={`Choose ${color} as event color`}
                        />
                      ))}
                    </div>
                    <input
                      id="event-color"
                      name="color"
                      type="color"
                      value={draftEvent.color}
                      onChange={onDraftChange}
                      className="event-color-picker-input"
                    />
                    <span className="text-sm font-medium text-slate-600">{draftEvent.color}</span>
                  </div>
                </div>

                <div className="event-tag-builder">
                  {reusableTags.length > 0 ? (
                    <div className="event-tag-builder-suggestions">
                      <p className="m-0 text-sm font-medium text-slate-700">Your Made Tags</p>
                      <div className="event-tag-list">
                        {reusableTags.map((tag) => (
                          <button
                            key={tag.id}
                            type="button"
                            className="event-tag-chip"
                            style={{
                              backgroundColor: `${tag.color}22`,
                              borderColor: `${tag.color}66`,
                              color: tag.color,
                            }}
                            onClick={() => onAddExistingTag?.(tag)}
                          >
                            <span className="event-tag-dot" style={{ backgroundColor: tag.color }} />
                            {tag.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <input
                    name="label"
                    type="text"
                    value={draftTag.label}
                    onChange={onDraftTagChange}
                    placeholder="Add a tag like Design"
                    className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  />
                  <div className="event-color-row">
                    {TAG_COLOR_PRESETS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`event-color-swatch event-color-swatch--small ${
                          draftTag.color === color ? 'event-color-swatch--active' : ''
                        }`}
                        style={{ backgroundColor: color }}
                        onClick={() => onDraftTagChange({ target: { name: 'color', value: color } })}
                        aria-label={`Choose ${color} as tag color`}
                      />
                    ))}
                  </div>
                  <div className="event-color-picker-row">
                    <input
                      name="color"
                      type="color"
                      value={draftTag.color}
                      onChange={onDraftTagChange}
                      className="event-color-picker-input"
                    />
                    <button
                      type="button"
                      onClick={onAddTag}
                      className="rounded-full border border-slate-900/12 bg-white/85 px-4 py-2.5 text-slate-800 transition hover:bg-white"
                    >
                      Add tag
                    </button>
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <div className="event-composer-footer">
            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-slate-900/12 bg-white/85 px-4 py-2.5 text-slate-800 transition hover:bg-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-full bg-slate-900 px-4 py-2.5 text-white transition hover:bg-slate-800"
              >
                {mode === 'edit' ? 'Save changes' : 'Save event'}
              </button>
            </div>
          </div>
        </form>
      </section>
    </aside>
  );
}
