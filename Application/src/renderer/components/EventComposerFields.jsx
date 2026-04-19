import React, { useRef } from 'react';
import {
  COLOR_PRESETS,
  DURATION_PRESET_OPTIONS,
  EVENT_SCOPE_OPTIONS,
  EVENT_TYPE_OPTIONS,
  getDraftDurationMinutes,
} from '../eventDraft';
import NotificationSettingsFields from './NotificationSettingsFields';

const REPEAT_OPTIONS = [
  { id: 'none', label: 'Does not repeat' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
];

function buildAvailabilityState(conflictSummary) {
  if (!conflictSummary?.hasConflicts) {
    return {
      variant: 'free',
      title: 'Free',
      copy: 'No overlaps',
    };
  }

  if (conflictSummary.focusCount > 0) {
    return {
      variant: 'focus',
      title: 'Focus conflict',
      copy: `${conflictSummary.focusCount} focus block${conflictSummary.focusCount === 1 ? '' : 's'}`,
    };
  }

  return {
    variant: 'busy',
    title: 'Busy',
    copy: `${conflictSummary.total} overlap${conflictSummary.total === 1 ? '' : 's'}`,
  };
}

function formatConflictList(conflictSummary) {
  return (conflictSummary?.items || [])
    .slice(0, 3)
    .map((item) => item.title)
    .join(' · ');
}

function buildDraftDate(dateValue, timeValue = '12:00') {
  return new Date(`${dateValue}T${timeValue}:00`);
}

function formatQuickDateLabel(dateValue) {
  if (!dateValue) {
    return 'Pick a date';
  }

  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(buildDraftDate(dateValue));
}

function formatQuickTimeValue(_dateValue, timeValue) {
  if (!timeValue) {
    return '--:--';
  }

  return timeValue;
}

function openNativePicker(inputRef) {
  const node = inputRef.current;
  if (!node) {
    return;
  }

  if (typeof node.showPicker === 'function') {
    node.showPicker();
    return;
  }

  node.focus();
}

function FullTimingBlock({
  draftEvent,
  onFieldChange,
  onSelectDuration,
  conflictSummary,
  onFindFreeSlot,
}) {
  const durationMinutes = getDraftDurationMinutes(draftEvent, 60);
  const availability = buildAvailabilityState(conflictSummary);
  const conflictList = formatConflictList(conflictSummary);

  return (
    <section className="event-timing-card app-subsurface">
      <div className="event-composer-field event-composer-field--timing">
        <label className="event-field-label">Timing</label>
        <div className="event-composer-grid event-composer-grid--timing">
          <div className="event-composer-field">
            <input
              id="event-date"
              name="date"
              type="date"
              value={draftEvent.date}
              onChange={(event) => onFieldChange('date', event.target.value)}
              className="app-input w-full rounded-xl px-4 py-3"
            />
          </div>

          <div className="event-composer-field flex">
            <input
              id="event-time"
              name="time"
              type="time"
              value={draftEvent.time}
              onChange={(event) => onFieldChange('time', event.target.value)}
              className="app-input w-full rounded-xl px-4 py-3"
            />
            <input
              id="event-end-time"
              name="endTime"
              type="time"
              value={draftEvent.endTime}
              onChange={(event) => onFieldChange('endTime', event.target.value)}
              className="app-input w-full rounded-xl px-4 py-3"
            />
          </div>
        </div>
      </div>

      <div className="event-duration-section">
        <div className="event-duration-row" role="group" aria-label="Duration presets">
          {DURATION_PRESET_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`event-duration-chip ${
                durationMinutes === option.id ? 'event-duration-chip--active' : ''
              }`}
              onClick={() => onSelectDuration(option.id)}
            >
              {option.label}
            </button>
          ))}
          <span className="event-duration-label app-text-soft">{durationMinutes} min</span>
        </div>

        <button
          type="button"
          className="app-button app-button--secondary event-find-free-button"
          onClick={onFindFreeSlot}
        >
          Find free slot
        </button>
      </div>

      <div
        className={`event-availability-card event-availability-card--${availability.variant}`}
        role="status"
      >
        <p className="event-availability-title">{availability.title}</p>
        <p className="event-availability-copy">{availability.copy}</p>
        {conflictList ? <p className="event-availability-list">{conflictList}</p> : null}
      </div>
    </section>
  );
}

function QuickTimingBlock({
  draftEvent,
  onFieldChange,
  onSelectDuration,
  conflictSummary,
}) {
  const durationMinutes = getDraftDurationMinutes(draftEvent, 60);
  const availability = buildAvailabilityState(conflictSummary);
  const dateInputRef = useRef(null);
  const startInputRef = useRef(null);
  const endInputRef = useRef(null);

  return (
    <section className="quick-timing-block">
      <div className="quick-timing-row">
        <button
          type="button"
          className="quick-date-chip"
          onClick={() => openNativePicker(dateInputRef)}
          aria-label="Choose event date"
        >
          {formatQuickDateLabel(draftEvent.date)}
        </button>
        <div className="quick-time-range" role="group" aria-label="Event time">
          <button
            type="button"
            className="quick-time-button"
            onClick={() => openNativePicker(startInputRef)}
            aria-label="Choose start time"
          >
            {formatQuickTimeValue(draftEvent.date, draftEvent.time)}
          </button>
          <span className="quick-time-separator" aria-hidden="true">
            -
          </span>
          <button
            type="button"
            className="quick-time-button"
            onClick={() => openNativePicker(endInputRef)}
            aria-label="Choose end time"
          >
            {formatQuickTimeValue(draftEvent.date, draftEvent.endTime)}
          </button>
        </div>
        <div className="quick-duration-row" role="group" aria-label="Duration presets">
          {DURATION_PRESET_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`event-duration-chip event-duration-chip--compact ${
                durationMinutes === option.id ? 'event-duration-chip--active' : ''
              }`}
              onClick={() => onSelectDuration(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <input
        ref={dateInputRef}
        type="date"
        value={draftEvent.date}
        onChange={(event) => onFieldChange('date', event.target.value)}
        className="event-quick-native-picker"
        tabIndex={-1}
        aria-hidden="true"
      />
      <input
        ref={startInputRef}
        type="time"
        value={draftEvent.time}
        onChange={(event) => onFieldChange('time', event.target.value)}
        className="event-quick-native-picker"
        tabIndex={-1}
        aria-hidden="true"
      />
      <input
        ref={endInputRef}
        type="time"
        value={draftEvent.endTime}
        onChange={(event) => onFieldChange('endTime', event.target.value)}
        className="event-quick-native-picker"
        tabIndex={-1}
        aria-hidden="true"
      />

      <div
        className={`quick-availability-badge quick-availability-badge--${availability.variant}`}
        role="status"
      >
        <strong>{availability.title}</strong>
        <span>{availability.copy}</span>
      </div>
    </section>
  );
}

function CategoryPicker({ draftEvent, onFieldChange, compact = false, showLabel = true }) {
  return (
    <div className="event-composer-field">
      {showLabel ? <label className="event-field-label">Category</label> : null}
      <div
        className={`event-color-row ${compact ? 'event-color-row--compact' : ''}`}
        role="group"
        aria-label="Event category color"
      >
        {COLOR_PRESETS.map((color) => (
          <button
            key={color}
            type="button"
            className={`event-color-swatch ${
              draftEvent.color === color ? 'event-color-swatch--active' : ''
            }`}
            style={{ backgroundColor: color }}
            onClick={() => onFieldChange('color', color)}
            aria-label={`Choose ${color} as event category color`}
            aria-pressed={draftEvent.color === color}
          >
            <span className="event-color-swatch-indicator" aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}

function ScopeField({ draftEvent, onFieldChange, compact = false, showLabel = true }) {
  return (
    <div className="event-composer-field">
      {showLabel ? <label className="event-field-label">Event scope</label> : null}
      <div className={`event-scope-row ${compact ? 'event-scope-row--compact' : ''}`}>
        {EVENT_SCOPE_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`event-scope-pill ${
              draftEvent.scope === option.id ? 'event-scope-pill--active' : ''
            }`}
            onClick={() => onFieldChange('scope', option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TypeField({ draftEvent, onFieldChange, compact = false, showLabel = true }) {
  return (
    <div className="event-composer-field">
      {showLabel ? <label className="event-field-label">Type</label> : null}
      <div className={`event-type-row ${compact ? 'event-type-row--compact' : ''}`}>
        {EVENT_TYPE_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`event-type-pill ${
              draftEvent.type === option.id ? 'event-type-pill--active' : ''
            }`}
            onClick={() => onFieldChange('type', option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function QuickComposerLayout({
  draftEvent,
  onFieldChange,
  onSelectDuration,
  conflictSummary,
  titleAutoFocus,
}) {
  return (
    <div className="event-composer-fields event-composer-fields--quick event-composer-fields--compact">
      <div className="event-composer-field event-composer-field--primary">
        <input
          id="event-title"
          name="title"
          type="text"
          value={draftEvent.title}
          onChange={(event) => onFieldChange('title', event.target.value)}
          placeholder="Add a title"
          aria-label="Event title"
          className="app-input w-full rounded-xl px-4 py-3 event-composer-title-input event-composer-title-input--quick"
          autoFocus={titleAutoFocus}
        />
      </div>

      <QuickTimingBlock
        draftEvent={draftEvent}
        onFieldChange={onFieldChange}
        onSelectDuration={onSelectDuration}
        conflictSummary={conflictSummary}
      />

      <div className="quick-composer-secondary-row">
        <CategoryPicker
          draftEvent={draftEvent}
          onFieldChange={onFieldChange}
          compact
          showLabel={false}
        />
        <ScopeField
          draftEvent={draftEvent}
          onFieldChange={onFieldChange}
          compact
          showLabel={false}
        />
      </div>

      <TypeField draftEvent={draftEvent} onFieldChange={onFieldChange} compact showLabel={false} />
    </div>
  );
}

function FullEditorAdvancedFields({
  draftEvent,
  onFieldChange,
  knownNotificationEmails,
  connectedAccounts,
  providers,
  onConnectProvider,
  oauthBusyProvider,
  oauthStatusMessage,
}) {
  return (
    <>
      <div className="event-composer-column event-composer-column--secondary">
        <section className="event-composer-section event-composer-panel-card app-subsurface">
          <div className="event-composer-section-heading">
            <p className="settings-section-eyebrow">Details</p>
            <h3 className="event-composer-section-title">Event details</h3>
          </div>

          <div className="event-composer-field">
            <label htmlFor="event-description" className="event-field-label">
              Description
            </label>
            <textarea
              id="event-description"
              name="description"
              value={draftEvent.description}
              onChange={(event) => onFieldChange('description', event.target.value)}
              placeholder="What should you remember about this event?"
              rows={4}
              className="app-input w-full resize-none rounded-xl px-4 py-3"
            />
          </div>

          <div className="event-composer-grid">
            <div className="event-composer-field">
              <label htmlFor="event-location" className="event-field-label">
                Location
              </label>
              <input
                id="event-location"
                name="location"
                type="text"
                value={draftEvent.location}
                onChange={(event) => onFieldChange('location', event.target.value)}
                placeholder="Room, cafe, or link context"
                className="app-input w-full rounded-xl px-4 py-3"
              />
            </div>

            <div className="event-composer-field">
              <label htmlFor="event-people" className="event-field-label">
                People / guests
              </label>
              <input
                id="event-people"
                name="peopleInput"
                type="text"
                value={draftEvent.peopleInput}
                onChange={(event) => onFieldChange('peopleInput', event.target.value)}
                placeholder="Comma-separated names or emails"
                className="app-input w-full rounded-xl px-4 py-3"
              />
            </div>
          </div>
        </section>

        <section className="event-composer-section event-composer-panel-card app-subsurface">
          <div className="event-composer-section-heading">
            <p className="settings-section-eyebrow">Scheduling</p>
            <h3 className="event-composer-section-title">Repeat</h3>
          </div>

          <div className="event-composer-grid">
            <div className="event-composer-field">
              <label htmlFor="event-repeat" className="event-field-label">
                Recurrence
              </label>
              <select
                id="event-repeat"
                name="repeat"
                value={draftEvent.repeat}
                onChange={(event) => onFieldChange('repeat', event.target.value)}
                className="app-input w-full rounded-xl px-4 py-3"
              >
                {REPEAT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="event-composer-section event-composer-panel-card app-subsurface">
          <NotificationSettingsFields
            draftEvent={draftEvent}
            onFieldChange={onFieldChange}
            knownNotificationEmails={knownNotificationEmails}
            connectedAccounts={connectedAccounts}
            providers={providers}
            onConnectProvider={onConnectProvider}
            oauthBusyProvider={oauthBusyProvider}
            oauthStatusMessage={oauthStatusMessage}
          />
        </section>
      </div>

      <section className="event-composer-section event-composer-panel-card event-composer-section--full-span app-subsurface">
        <div className="event-composer-section-heading">
          <p className="settings-section-eyebrow">Advanced</p>
          <h3 className="event-composer-section-title">Metadata</h3>
        </div>

        <div className="event-composer-grid">
          <div className="event-composer-field">
            <label htmlFor="event-group-name" className="event-field-label">
              Group
            </label>
            <input
              id="event-group-name"
              name="groupName"
              type="text"
              value={draftEvent.groupName}
              onChange={(event) => onFieldChange('groupName', event.target.value)}
              placeholder="Optional grouping"
              className="app-input w-full rounded-xl px-4 py-3"
            />
          </div>

          <label className="app-checkbox-row event-checkbox-row">
            <input
              type="checkbox"
              checked={Boolean(draftEvent.hasDeadline)}
              onChange={(event) => onFieldChange('hasDeadline', event.target.checked)}
            />
            <span>Has deadline</span>
          </label>
        </div>

        {draftEvent.type === 'focus' ? (
          <label className="app-checkbox-row event-checkbox-row">
            <input
              type="checkbox"
              checked={Boolean(draftEvent.completed)}
              onChange={(event) => onFieldChange('completed', event.target.checked)}
            />
            <span>Completed</span>
          </label>
        ) : null}

        {draftEvent.externalProviderLinks?.length ? (
          <div className="event-provider-section app-muted-surface">
            <p className="event-field-label">Connected provider links</p>
            <div className="event-provider-list">
              {draftEvent.externalProviderLinks.map((link, index) => (
                <div
                  key={`${link.provider}-${link.externalEventId}-${index}`}
                  className="event-provider-item"
                >
                  <p className="event-provider-title">
                    {link.provider} · {link.externalEventId}
                  </p>
                  {link.url ? <p className="event-provider-copy">{link.url}</p> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}

export default function EventComposerFields({
  draftEvent,
  onFieldChange,
  onSelectDuration,
  conflictSummary,
  onFindFreeSlot,
  titleAutoFocus = false,
  variant = 'full',
  knownNotificationEmails = [],
  connectedAccounts = [],
  providers = [],
  onConnectProvider,
  oauthBusyProvider = '',
  oauthStatusMessage = '',
}) {
  const isQuick = variant === 'quick';

  if (isQuick) {
    return (
      <QuickComposerLayout
        draftEvent={draftEvent}
        onFieldChange={onFieldChange}
        onSelectDuration={onSelectDuration}
        conflictSummary={conflictSummary}
        titleAutoFocus={titleAutoFocus}
      />
    );
  }

  return (
    <div className="event-composer-fields event-composer-fields--full">
      <div className="event-composer-full-grid">
        <div className="event-composer-column event-composer-column--primary">
          <div className="event-composer-field event-composer-field--primary">
            <label htmlFor="event-title" className="event-field-label event-field-label--primary">
              Title
            </label>
            <input
              id="event-title"
              name="title"
              type="text"
              value={draftEvent.title}
              onChange={(event) => onFieldChange('title', event.target.value)}
              placeholder="Pairing flow review"
              className="app-input w-full rounded-xl px-4 py-3 event-composer-title-input"
              autoFocus={titleAutoFocus}
            />
          </div>

          <FullTimingBlock
            draftEvent={draftEvent}
            onFieldChange={onFieldChange}
            onSelectDuration={onSelectDuration}
            conflictSummary={conflictSummary}
            onFindFreeSlot={onFindFreeSlot}
          />

          <div className="event-composer-grid">
            <CategoryPicker draftEvent={draftEvent} onFieldChange={onFieldChange} />
            <ScopeField draftEvent={draftEvent} onFieldChange={onFieldChange} />
          </div>

          <TypeField draftEvent={draftEvent} onFieldChange={onFieldChange} />
        </div>

        <FullEditorAdvancedFields
          draftEvent={draftEvent}
          onFieldChange={onFieldChange}
          knownNotificationEmails={knownNotificationEmails}
          connectedAccounts={connectedAccounts}
          providers={providers}
          onConnectProvider={onConnectProvider}
          oauthBusyProvider={oauthBusyProvider}
          oauthStatusMessage={oauthStatusMessage}
        />
      </div>
    </div>
  );
}
