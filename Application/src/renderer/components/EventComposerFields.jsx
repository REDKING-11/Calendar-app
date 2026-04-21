import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addMinutesToTime,
  COLOR_PRESETS,
  DURATION_PRESET_OPTIONS,
  EVENT_SCOPE_OPTIONS,
  EVENT_TYPE_OPTIONS,
  INVITE_DELIVERY_MODE_OPTIONS,
  extractInviteeEmails,
  formatDateForInput,
  getDraftDurationMinutes,
  scopeToInviteProvider,
} from '../eventDraft';
import NotificationSettingsFields from './NotificationSettingsFields';

const REPEAT_OPTIONS = [
  { id: 'none', label: 'Does not repeat' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
];
const TIME_INPUT_SCROLL_STEP_MINUTES = 15;

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

  const date = buildDraftDate(dateValue);
  const weekday = date.toLocaleDateString(undefined, { weekday: 'long' });
  const month = date.toLocaleDateString(undefined, { month: 'long' });
  return `${weekday} ${month} ${date.getDate()}`;
}

function formatQuickDateInputValue(dateValue) {
  if (!dateValue) {
    return '';
  }

  const date = buildDraftDate(dateValue);
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function normalizeQuickDateInputValue(value) {
  return String(value || '')
    .replace(/[^\d./-]/g, '')
    .slice(0, 10);
}

function parseQuickDateInputValue(value, fallbackDateValue) {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) {
    return null;
  }

  const match = normalizedValue.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/);
  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const fallbackDate = fallbackDateValue ? buildDraftDate(fallbackDateValue) : new Date();
  let year = fallbackDate.getFullYear();

  if (match[3]) {
    const parsedYear = Number(match[3]);
    if (!Number.isFinite(parsedYear)) {
      return null;
    }

    year = match[3].length === 2 ? 2000 + parsedYear : parsedYear;
  }

  const parsedDate = new Date(year, month - 1, day);
  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.getFullYear() !== year ||
    parsedDate.getMonth() !== month - 1 ||
    parsedDate.getDate() !== day
  ) {
    return null;
  }

  return formatDateForInput(parsedDate);
}

function normalizeTimeInputValue(value) {
  return String(value || '')
    .replace(/[^\d:.-]/g, '')
    .slice(0, 5);
}

function parseTimeInputValue(value) {
  const normalizedValue = String(value || '').trim().replace(/\./g, ':');
  if (!normalizedValue) {
    return null;
  }

  let hours = 0;
  let minutes = 0;

  if (normalizedValue.includes(':')) {
    const [rawHours = '', rawMinutes = '0'] = normalizedValue.split(':');
    if (!rawHours) {
      return null;
    }
    hours = Number(rawHours);
    minutes = rawMinutes === '' ? 0 : Number(rawMinutes);
  } else if (/^\d{1,2}$/.test(normalizedValue)) {
    hours = Number(normalizedValue);
    minutes = 0;
  } else if (/^\d{3}$/.test(normalizedValue)) {
    hours = Number(normalizedValue.slice(0, 1));
    minutes = Number(normalizedValue.slice(1));
  } else if (/^\d{4}$/.test(normalizedValue)) {
    hours = Number(normalizedValue.slice(0, 2));
    minutes = Number(normalizedValue.slice(2));
  } else {
    return null;
  }

  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function TimeTextField({
  id,
  name,
  value,
  onCommit,
  ariaLabel,
  className,
  placeholder = '09:00',
}) {
  const [inputValue, setInputValue] = useState(() => value || '');
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setInputValue(value || '');
    }
  }, [value, isFocused]);

  const commitValue = () => {
    const parsedValue = parseTimeInputValue(inputValue);
    if (parsedValue) {
      onCommit(parsedValue);
      setInputValue(parsedValue);
      return;
    }

    setInputValue(value || '');
  };

  const adjustValue = (minutes) => {
    const baseValue = parseTimeInputValue(inputValue) || value || '09:00';
    const nextValue = addMinutesToTime(baseValue, minutes);
    onCommit(nextValue);
    setInputValue(nextValue);
  };

  return (
    <input
      id={id}
      name={name}
      type="text"
      value={isFocused ? inputValue : value || ''}
      spellCheck={false}
      autoComplete="off"
      inputMode="numeric"
      placeholder={placeholder}
      className={className}
      aria-label={ariaLabel}
      onFocus={(event) => {
        setInputValue(value || '');
        setIsFocused(true);
        window.requestAnimationFrame(() => event.target.select());
      }}
      onChange={(event) => {
        setInputValue(normalizeTimeInputValue(event.target.value));
      }}
      onBlur={() => {
        commitValue();
        setIsFocused(false);
      }}
      onWheel={(event) => {
        event.preventDefault();
        adjustValue(event.deltaY > 0 ? TIME_INPUT_SCROLL_STEP_MINUTES : -TIME_INPUT_SCROLL_STEP_MINUTES);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          adjustValue(TIME_INPUT_SCROLL_STEP_MINUTES);
        }

        if (event.key === 'ArrowDown') {
          event.preventDefault();
          adjustValue(-TIME_INPUT_SCROLL_STEP_MINUTES);
        }

        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          setInputValue(value || '');
          event.currentTarget.blur();
        }
      }}
    />
  );
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

          <div className="event-composer-field">
            <TimeTextField
              id="event-time"
              name="time"
              value={draftEvent.time}
              onCommit={(nextValue) => onFieldChange('time', nextValue)}
              ariaLabel="Start time"
              className="app-input w-full rounded-xl px-4 py-3 event-time-input"
            />
          </div>

          <div className="event-composer-field">
            <TimeTextField
              id="event-end-time"
              name="endTime"
              value={draftEvent.endTime}
              onCommit={(nextValue) => onFieldChange('endTime', nextValue)}
              ariaLabel="End time"
              className="app-input w-full rounded-xl px-4 py-3 event-time-input"
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
  const [isDateInputFocused, setIsDateInputFocused] = useState(false);
  const [dateInputValue, setDateInputValue] = useState(() => formatQuickDateInputValue(draftEvent.date));

  useEffect(() => {
    if (!isDateInputFocused) {
      setDateInputValue(formatQuickDateInputValue(draftEvent.date));
    }
  }, [draftEvent.date, isDateInputFocused]);

  const commitDateInputValue = () => {
    const nextDateValue = parseQuickDateInputValue(dateInputValue, draftEvent.date);
    if (nextDateValue) {
      onFieldChange('date', nextDateValue);
      setDateInputValue(formatQuickDateInputValue(nextDateValue));
      return;
    }

    setDateInputValue(formatQuickDateInputValue(draftEvent.date));
  };

  return (
    <section className="quick-timing-block">
      <div className="quick-timing-row">
        <input
          type="text"
          value={
            isDateInputFocused
              ? dateInputValue
              : formatQuickDateLabel(draftEvent.date)
          }
          spellCheck={false}
          inputMode="numeric"
          placeholder={isDateInputFocused ? 'dd.mm' : 'Pick a date'}
          className={`quick-date-input ${isDateInputFocused ? 'quick-date-input--focused' : ''}`}
          aria-label="Type event date as day and month"
          onFocus={(event) => {
            setDateInputValue(formatQuickDateInputValue(draftEvent.date));
            setIsDateInputFocused(true);
            window.requestAnimationFrame(() => event.target.select());
          }}
          onChange={(event) => {
            setDateInputValue(normalizeQuickDateInputValue(event.target.value));
          }}
          onBlur={() => {
            commitDateInputValue();
            setIsDateInputFocused(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            }

            if (event.key === 'Escape') {
              event.preventDefault();
              setDateInputValue(formatQuickDateInputValue(draftEvent.date));
              event.currentTarget.blur();
            }
          }}
        />
        <div className="quick-time-range" role="group" aria-label="Event time">
          <TimeTextField
            id="quick-event-time"
            name="time"
            value={draftEvent.time}
            onCommit={(nextValue) => onFieldChange('time', nextValue)}
            ariaLabel="Start time"
            className="quick-time-input"
          />
          <span className="quick-time-separator" aria-hidden="true">
            -
          </span>
          <TimeTextField
            id="quick-event-end-time"
            name="endTime"
            value={draftEvent.endTime}
            onCommit={(nextValue) => onFieldChange('endTime', nextValue)}
            ariaLabel="End time"
            className="quick-time-input"
          />
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

function getProviderLabel(providerId) {
  if (providerId === 'google') {
    return 'Google';
  }
  if (providerId === 'microsoft') {
    return 'Outlook';
  }
  return providerId || 'Provider';
}

function getAccountLabel(account = {}) {
  return account.email || account.displayName || `${getProviderLabel(account.provider)} account`;
}

function isWritableCalendar(calendar = {}) {
  const accessRole = String(calendar.accessRole || '').toLowerCase();
  if (calendar.provider === 'google') {
    return ['owner', 'writer'].includes(accessRole);
  }
  if (calendar.provider === 'microsoft') {
    return calendar.selected !== false && accessRole !== 'reader';
  }
  return calendar.selected !== false;
}

function InviteTargetSection({
  draftEvent,
  onFieldChange,
  connectedAccounts = [],
  externalCalendarsByAccount = {},
  onLoadExternalCalendars,
  onConnectProvider,
  onOpenConnectionSettings,
  oauthBusyProvider = '',
  oauthStatusMessage = '',
}) {
  const inviteEmails = useMemo(
    () => extractInviteeEmails(draftEvent.inviteRecipientsInput),
    [draftEvent.inviteRecipientsInput]
  );
  const guestEmailCandidates = useMemo(
    () => extractInviteeEmails(draftEvent.peopleInput),
    [draftEvent.peopleInput]
  );
  const requiredProvider = scopeToInviteProvider(draftEvent.scope);
  const providerLabel = getProviderLabel(requiredProvider);
  const providerAccounts = connectedAccounts.filter(
    (account) =>
      account.provider === requiredProvider &&
      account.status === 'connected' &&
      account.canWrite &&
      account.writeScopeGranted
  );
  const selectedAccount = providerAccounts.find(
    (account) => account.accountId === draftEvent.inviteTargetAccountId
  );
  const calendarState = draftEvent.inviteTargetAccountId
    ? externalCalendarsByAccount[draftEvent.inviteTargetAccountId] || { status: 'idle', items: [] }
    : { status: 'idle', items: [] };
  const writableCalendars = (calendarState.items || []).filter(isWritableCalendar);
  const canSendInvites =
    inviteEmails.length > 0 &&
    requiredProvider &&
    selectedAccount &&
    draftEvent.inviteTargetCalendarId;

  const handleUseGuestEmails = () => {
    const mergedEmails = Array.from(new Set([...inviteEmails, ...guestEmailCandidates]));
    onFieldChange('inviteRecipientsInput', mergedEmails.join(', '));
  };

  useEffect(() => {
    if (draftEvent.inviteTargetAccountId) {
      onLoadExternalCalendars?.(draftEvent.inviteTargetAccountId);
    }
  }, [draftEvent.inviteTargetAccountId, onLoadExternalCalendars]);

  const handleAccountChange = (event) => {
    const accountId = event.target.value;
    onFieldChange('inviteTargetAccountId', accountId);
    onFieldChange('inviteTargetProvider', requiredProvider);
    onFieldChange('inviteTargetCalendarId', '');
    onFieldChange('inviteDeliveryMode', accountId ? 'provider_invite' : 'local_only');
    if (accountId) {
      onLoadExternalCalendars?.(accountId);
    }
  };

  const handleCalendarChange = (event) => {
    onFieldChange('inviteTargetCalendarId', event.target.value);
    if (event.target.value) {
      onFieldChange('inviteDeliveryMode', 'provider_invite');
      onFieldChange('inviteTargetProvider', requiredProvider);
    }
  };

  return (
    <section className="event-composer-section event-composer-panel-card app-subsurface invite-target-section">
      <div className="event-composer-section-heading">
        <p className="settings-section-eyebrow">Invites</p>
        <h3 className="event-composer-section-title">Invitees and delivery</h3>
      </div>

      <div className="event-composer-field">
        <label htmlFor="event-invite-recipients" className="event-field-label">
          Invite recipients
        </label>
        <input
          id="event-invite-recipients"
          name="inviteRecipientsInput"
          type="text"
          value={draftEvent.inviteRecipientsInput || ''}
          onChange={(event) => onFieldChange('inviteRecipientsInput', event.target.value)}
          placeholder="Email addresses to invite"
          className="app-input w-full rounded-xl px-4 py-3"
        />
        <div className="invite-recipient-tools">
          <p className="notification-helper-copy">
            This list controls provider invites. People/guests can stay as local context.
          </p>
          {guestEmailCandidates.length > 0 ? (
            <button
              type="button"
              className="event-inline-link-button"
              onClick={handleUseGuestEmails}
            >
              Use guest emails
            </button>
          ) : null}
        </div>
      </div>

      <div className="invite-target-status">
        {inviteEmails.length === 0 ? (
          <p className="notification-helper-copy">
            Add invite recipient emails here to send real calendar invites.
          </p>
        ) : draftEvent.scope === 'internal' ? (
          <p className="settings-inline-warning">
            Internal events stay in this app. Switch scope to Work or Personal before sending invites.
          </p>
        ) : (
          <p className="notification-helper-copy">
            {inviteEmails.length} invitee email{inviteEmails.length === 1 ? '' : 's'} will use {providerLabel}.
          </p>
        )}
      </div>

      <div className="invite-delivery-row" role="group" aria-label="Invite delivery mode">
        {INVITE_DELIVERY_MODE_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`event-scope-pill ${
              draftEvent.inviteDeliveryMode === option.id ? 'event-scope-pill--active' : ''
            }`}
            disabled={option.id === 'provider_invite' && (!requiredProvider || inviteEmails.length === 0)}
            onClick={() => onFieldChange('inviteDeliveryMode', option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {requiredProvider ? (
        <div className="event-composer-grid">
          <label className="event-composer-field">
            <span className="event-field-label">Account</span>
            <select
              className="app-input w-full rounded-xl px-4 py-3"
              value={draftEvent.inviteTargetAccountId || ''}
              onChange={handleAccountChange}
              disabled={providerAccounts.length === 0 || inviteEmails.length === 0}
            >
              <option value="">Choose {providerLabel} account</option>
              {providerAccounts.map((account) => (
                <option key={account.accountId} value={account.accountId}>
                  {getAccountLabel(account)}
                </option>
              ))}
            </select>
          </label>

          <label className="event-composer-field">
            <span className="event-field-label">Calendar</span>
            <select
              className="app-input w-full rounded-xl px-4 py-3"
              value={draftEvent.inviteTargetCalendarId || ''}
              onChange={handleCalendarChange}
              disabled={!selectedAccount || calendarState.status === 'loading' || writableCalendars.length === 0}
            >
              <option value="">
                {calendarState.status === 'loading'
                  ? 'Loading calendars...'
                  : writableCalendars.length > 0
                    ? 'Choose calendar'
                    : 'No writable calendars'}
              </option>
              {writableCalendars.map((calendar) => (
                <option key={calendar.remoteCalendarId} value={calendar.remoteCalendarId}>
                  {calendar.displayName}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {requiredProvider && providerAccounts.length === 0 ? (
        <div className="notification-connect-block notification-connect-block--compact">
          <p className="notification-helper-copy">
            {onOpenConnectionSettings
              ? `Open Settings to connect or reconnect ${providerLabel} with calendar write access.`
              : `Connect or reconnect ${providerLabel} with calendar write access to send invites.`}
          </p>
          <button
            type="button"
            className="app-button app-button--secondary"
            disabled={!onOpenConnectionSettings && oauthBusyProvider === requiredProvider}
            onClick={() =>
              onOpenConnectionSettings
                ? onOpenConnectionSettings(requiredProvider)
                : onConnectProvider?.(requiredProvider)
            }
            title="Manage Google and Outlook connections in Settings"
          >
            {onOpenConnectionSettings
              ? 'Open settings'
              : oauthBusyProvider === requiredProvider
                ? `Connecting ${providerLabel}...`
                : `Connect ${providerLabel}`}
          </button>
        </div>
      ) : null}

      {calendarState.status === 'error' ? (
        <p className="settings-inline-warning">{calendarState.error || 'Could not load calendars.'}</p>
      ) : null}
      {draftEvent.lastInviteError ? (
        <p className="settings-inline-warning">{draftEvent.lastInviteError}</p>
      ) : null}
      {canSendInvites ? (
        <p className="notification-helper-copy">
          Ready to send via {getAccountLabel(selectedAccount)}.
        </p>
      ) : null}
      {oauthStatusMessage ? <p className="notification-helper-copy">{oauthStatusMessage}</p> : null}
    </section>
  );
}

function SchedulingSection({ draftEvent, onFieldChange }) {
  return (
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
  externalCalendarsByAccount,
  onLoadExternalCalendars,
  onConnectProvider,
  onOpenConnectionSettings,
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
          <NotificationSettingsFields
            draftEvent={draftEvent}
            onFieldChange={onFieldChange}
            knownNotificationEmails={knownNotificationEmails}
            connectedAccounts={connectedAccounts}
            providers={providers}
            onConnectProvider={onConnectProvider}
            onOpenConnectionSettings={onOpenConnectionSettings}
            oauthBusyProvider={oauthBusyProvider}
            oauthStatusMessage={oauthStatusMessage}
          />
        </section>

        <AdvancedMetadataSection draftEvent={draftEvent} onFieldChange={onFieldChange} />
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

function AdvancedMetadataSection({ draftEvent, onFieldChange }) {
  return (
    <section className="event-composer-section event-composer-section--compact event-composer-panel-card event-composer-panel-card--compact app-subsurface">
      <div className="event-composer-section-heading">
        <p className="settings-section-eyebrow">Advanced</p>
        <h3 className="event-composer-section-title">Metadata</h3>
      </div>

      <div className="event-composer-grid event-composer-grid--compact">
        <div className="event-composer-field">
          <label htmlFor="event-group-name-inline" className="event-field-label">
            Group
          </label>
          <input
            id="event-group-name-inline"
            name="groupName"
            type="text"
            value={draftEvent.groupName}
            onChange={(event) => onFieldChange('groupName', event.target.value)}
            placeholder="Optional grouping"
            className="app-input w-full rounded-xl px-4 py-3"
          />
        </div>

        <label className="app-checkbox-row event-checkbox-row event-checkbox-row--compact">
          <input
            type="checkbox"
            checked={Boolean(draftEvent.hasDeadline)}
            onChange={(event) => onFieldChange('hasDeadline', event.target.checked)}
          />
          <span>Has deadline</span>
        </label>
      </div>

      {draftEvent.type === 'focus' ? (
        <label className="app-checkbox-row event-checkbox-row event-checkbox-row--compact">
          <input
            type="checkbox"
            checked={Boolean(draftEvent.completed)}
            onChange={(event) => onFieldChange('completed', event.target.checked)}
          />
          <span>Completed</span>
        </label>
      ) : null}

      {draftEvent.externalProviderLinks?.length ? (
        <div className="event-provider-section event-provider-section--compact app-muted-surface">
          <p className="event-field-label">Connected provider links</p>
          <div className="event-provider-list event-provider-list--compact">
            {draftEvent.externalProviderLinks.map((link, index) => (
              <div
                key={`${link.provider}-${link.externalEventId}-${index}`}
                className="event-provider-item"
              >
                <p className="event-provider-title">
                  {link.provider} Â· {link.externalEventId}
                </p>
                {link.url ? <p className="event-provider-copy">{link.url}</p> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
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
  externalCalendarsByAccount = {},
  onLoadExternalCalendars,
  onConnectProvider,
  onOpenConnectionSettings,
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
          <InviteTargetSection
            draftEvent={draftEvent}
            onFieldChange={onFieldChange}
            connectedAccounts={connectedAccounts}
            externalCalendarsByAccount={externalCalendarsByAccount}
            onLoadExternalCalendars={onLoadExternalCalendars}
            onConnectProvider={onConnectProvider}
            onOpenConnectionSettings={onOpenConnectionSettings}
            oauthBusyProvider={oauthBusyProvider}
            oauthStatusMessage={oauthStatusMessage}
          />
          <SchedulingSection draftEvent={draftEvent} onFieldChange={onFieldChange} />
        </div>

        <FullEditorAdvancedFields
          draftEvent={draftEvent}
          onFieldChange={onFieldChange}
          knownNotificationEmails={knownNotificationEmails}
          connectedAccounts={connectedAccounts}
          providers={providers}
          externalCalendarsByAccount={externalCalendarsByAccount}
          onLoadExternalCalendars={onLoadExternalCalendars}
          onConnectProvider={onConnectProvider}
          onOpenConnectionSettings={onOpenConnectionSettings}
          oauthBusyProvider={oauthBusyProvider}
          oauthStatusMessage={oauthStatusMessage}
        />
      </div>
    </div>
  );
}
