import React from 'react';
import {
  DEFAULT_NOTIFICATION_REMINDER_MINUTES,
  REMINDER_UNIT_OPTIONS,
  buildReminderMinutesFromParts,
  createNotificationDraft,
  getReminderAmountLimit,
  getReminderTimingParts,
  normalizeNotificationRecipients,
} from '../eventDraft';

function getScopeProviderRequirement(scope) {
  if (scope === 'work') {
    return ['google'];
  }

  if (scope === 'personal') {
    return ['microsoft'];
  }

  return ['google', 'microsoft'];
}

function getEligibleSenderAccount(scope, connectedAccounts = []) {
  const sendCapableAccounts = (connectedAccounts || []).filter(
    (account) => account?.emailSendCapable
  );
  if (scope === 'work') {
    return sendCapableAccounts.find((account) => account.provider === 'google') || null;
  }

  if (scope === 'personal') {
    return sendCapableAccounts.find((account) => account.provider === 'microsoft') || null;
  }

  return sendCapableAccounts[0] || null;
}

function getProviderLabel(providerId) {
  if (providerId === 'google') {
    return 'Google';
  }
  if (providerId === 'microsoft') {
    return 'Outlook';
  }
  return providerId;
}

function getProviderUpgradeCopy(providerId, connectedAccounts = []) {
  const providerAccounts = (connectedAccounts || []).filter(
    (account) => account.provider === providerId
  );
  if (providerAccounts.some((account) => account.mailScopeGranted)) {
    return '';
  }

  if (providerAccounts.length > 0) {
    return `Reconnect ${getProviderLabel(providerId)} with mail access to enable email reminders.`;
  }

  return `Connect ${getProviderLabel(providerId)} to send reminder emails.`;
}

function buildDefaultRecipient(scope, connectedAccounts = [], knownNotificationEmails = []) {
  const senderAccount = getEligibleSenderAccount(scope, connectedAccounts);
  if (senderAccount?.email) {
    return String(senderAccount.email).trim().toLowerCase();
  }

  return knownNotificationEmails[0] || '';
}

function EmailRecipientList({
  notification,
  knownNotificationEmails,
  onToggleRecipient,
  disabled = false,
}) {
  if (!knownNotificationEmails.length) {
    return (
      <p className="notification-helper-copy">
        No saved email addresses yet. Add one in setup or settings, or connect an account first.
      </p>
    );
  }

  return (
    <div className="notification-recipient-list" role="group" aria-label="Email recipients">
      {knownNotificationEmails.map((email) => {
        const isSelected = notification.emailNotificationRecipients.includes(email);
        return (
          <label
            key={email}
            className={`notification-recipient-chip ${
              isSelected ? 'notification-recipient-chip--active' : ''
            } ${disabled ? 'notification-recipient-chip--disabled' : ''}`}
          >
            <input
              type="checkbox"
              checked={isSelected}
              disabled={disabled}
              onChange={() => onToggleRecipient(email)}
            />
            <span>{email}</span>
          </label>
        );
      })}
    </div>
  );
}

function NotificationRow({
  notification,
  index,
  canRemove,
  emailToggleDisabled,
  knownNotificationEmails,
  onUpdate,
  onRemove,
}) {
  const timing = getReminderTimingParts(notification.reminderMinutesBeforeStart);

  return (
    <article className="notification-item-card">
      <div className="notification-item-header">
        <label className="event-composer-field notification-item-timing">
          <span className="event-field-label">When</span>
          <div className="notification-timing-inputs">
            <input
              name={`notification-${notification.id}-amount`}
              type="number"
              inputMode="numeric"
              min="1"
              max={String(getReminderAmountLimit(timing.unit))}
              value={timing.amount}
              onChange={(event) =>
                onUpdate({
                  reminderMinutesBeforeStart: buildReminderMinutesFromParts(
                    event.target.value,
                    timing.unit
                  ),
                })
              }
              placeholder="1"
              className="app-input notification-timing-number rounded-xl px-4 py-3"
            />
            <select
              name={`notification-${notification.id}-unit`}
              value={timing.unit}
              onChange={(event) =>
                onUpdate({
                  reminderMinutesBeforeStart: buildReminderMinutesFromParts(
                    timing.amount,
                    event.target.value
                  ),
                })
              }
              className="app-input notification-timing-unit rounded-xl px-4 py-3"
            >
              {REMINDER_UNIT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </label>

        <div className="notification-item-actions">
          <span className="notification-item-index">Notification {index + 1}</span>
          {canRemove ? (
            <button
              type="button"
              className="app-button app-button--secondary"
              onClick={onRemove}
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>

      <div className="notification-settings-grid notification-settings-grid--stacked">
        <label className="notification-channel-row">
          <input
            type="checkbox"
            checked={Boolean(notification.desktopNotificationEnabled)}
            onChange={(event) =>
              onUpdate({ desktopNotificationEnabled: event.target.checked })
            }
          />
          <div>
            <strong>This machine</strong>
            <p>Show a desktop reminder here.</p>
          </div>
        </label>

        <label
          className={`notification-channel-row ${
            emailToggleDisabled ? 'notification-channel-row--disabled' : ''
          }`}
        >
          <input
            type="checkbox"
            checked={Boolean(notification.emailNotificationEnabled)}
            disabled={emailToggleDisabled}
            onChange={(event) =>
              onUpdate({ emailNotificationEnabled: event.target.checked })
            }
          />
          <div>
            <strong>Email</strong>
            <p>Send this reminder through your connected account.</p>
          </div>
        </label>
      </div>

      {notification.emailNotificationEnabled ? (
        <div className="notification-recipient-section">
          <p className="event-field-label">Recipients</p>
          <EmailRecipientList
            notification={notification}
            knownNotificationEmails={knownNotificationEmails}
            onToggleRecipient={(email) => {
              const nextRecipients = notification.emailNotificationRecipients.includes(email)
                ? notification.emailNotificationRecipients.filter((item) => item !== email)
                : [...notification.emailNotificationRecipients, email];
              onUpdate({
                emailNotificationRecipients: normalizeNotificationRecipients(nextRecipients),
              });
            }}
            disabled={!notification.emailNotificationEnabled}
          />
          {notification.emailNotificationRecipients.length === 0 ? (
            <p className="notification-helper-copy">
              Pick at least one email address for this notification.
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export default function NotificationSettingsFields({
  draftEvent,
  onFieldChange,
  knownNotificationEmails = [],
  connectedAccounts = [],
  onConnectProvider,
  onOpenConnectionSettings,
  oauthBusyProvider = '',
  oauthStatusMessage = '',
  compact = false,
}) {
  const requiredProviders = getScopeProviderRequirement(draftEvent.scope);
  const eligibleSenderAccount = getEligibleSenderAccount(draftEvent.scope, connectedAccounts);
  const emailToggleDisabled = !eligibleSenderAccount;
  const showConnectActions = !eligibleSenderAccount;
  const notifications = Array.isArray(draftEvent.notifications) ? draftEvent.notifications : [];

  const pushNotifications = (nextNotifications) => {
    onFieldChange('notifications', nextNotifications);
  };

  const updateNotificationAt = (targetIndex, patch) => {
    const nextNotifications = notifications.map((notification, index) => {
      if (index !== targetIndex) {
        return notification;
      }

      const nextNotification = {
        ...notification,
        ...patch,
      };

      if (
        patch.emailNotificationEnabled &&
        nextNotification.emailNotificationRecipients.length === 0
      ) {
        const defaultRecipient = buildDefaultRecipient(
          draftEvent.scope,
          connectedAccounts,
          knownNotificationEmails
        );
        nextNotification.emailNotificationRecipients = defaultRecipient
          ? [defaultRecipient]
          : [];
      }

      if (
        (patch.desktopNotificationEnabled || patch.emailNotificationEnabled) &&
        nextNotification.reminderMinutesBeforeStart === null
      ) {
        nextNotification.reminderMinutesBeforeStart = DEFAULT_NOTIFICATION_REMINDER_MINUTES;
      }

      return nextNotification;
    });

    pushNotifications(nextNotifications);
  };

  const handleAddNotification = () => {
    const defaultRecipient = buildDefaultRecipient(
      draftEvent.scope,
      connectedAccounts,
      knownNotificationEmails
    );
    pushNotifications([
      ...notifications,
      createNotificationDraft({
        reminderMinutesBeforeStart: DEFAULT_NOTIFICATION_REMINDER_MINUTES,
        emailNotificationRecipients: defaultRecipient ? [defaultRecipient] : [],
      }),
    ]);
  };

  return (
    <section
      className={`notification-settings ${compact ? 'notification-settings--compact' : ''}`}
    >
      <div className="notification-settings-header">
        <div>
          <p className="settings-section-eyebrow">Notifications</p>
          <h3 className="notification-settings-title">Reminder delivery</h3>
        </div>
        <div className="notification-settings-toolbar">
          {eligibleSenderAccount ? (
            <span className="notification-sender-pill">
              Sends from {eligibleSenderAccount.email || eligibleSenderAccount.displayName}
            </span>
          ) : (
            <span className="notification-sender-pill notification-sender-pill--muted">
              Email sender unavailable
            </span>
          )}
          <button
            type="button"
            className="app-button app-button--secondary"
            onClick={handleAddNotification}
          >
            Add notification
          </button>
        </div>
      </div>

      {notifications.length === 0 ? (
        <div className="notification-empty-state">
          <p className="notification-helper-copy">
            No notifications yet. Add one and keep going.
          </p>
        </div>
      ) : (
        <div className="notification-item-list">
          {notifications.map((notification, index) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              index={index}
              canRemove={notifications.length > 0}
              emailToggleDisabled={emailToggleDisabled}
              knownNotificationEmails={knownNotificationEmails}
              onUpdate={(patch) => updateNotificationAt(index, patch)}
              onRemove={() =>
                pushNotifications(notifications.filter((item) => item.id !== notification.id))
              }
            />
          ))}
        </div>
      )}

      {showConnectActions ? (
        <div className="notification-connect-block">
          <p className="notification-helper-copy">
            {onOpenConnectionSettings
              ? 'Open Settings to connect Google or Outlook for email reminders.'
              : requiredProviders.length === 1
              ? getProviderUpgradeCopy(requiredProviders[0], connectedAccounts)
              : 'Connect Google or Microsoft with mail access to send email reminders.'}
          </p>
          <div className="notification-connect-actions">
            {requiredProviders.map((providerId) => {
              const label = getProviderLabel(providerId);
              const providerAccounts = connectedAccounts.filter(
                (account) => account.provider === providerId
              );
              const actionLabel =
                providerAccounts.length > 0 ? `Reconnect ${label}` : `Connect ${label}`;

              return (
                <button
                  key={providerId}
                  type="button"
                  className="app-button app-button--secondary"
                  onClick={() =>
                    onOpenConnectionSettings
                      ? onOpenConnectionSettings(providerId)
                      : onConnectProvider?.(providerId)
                  }
                  disabled={!onOpenConnectionSettings && oauthBusyProvider === providerId}
                  title="Manage Google and Outlook connections in Settings"
                >
                  {onOpenConnectionSettings
                    ? 'Open settings'
                    : oauthBusyProvider === providerId
                      ? `Connecting ${label}...`
                      : actionLabel}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {oauthStatusMessage ? <p className="notification-helper-copy">{oauthStatusMessage}</p> : null}
    </section>
  );
}
