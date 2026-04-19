import React from 'react';
import NotificationSettingsFields from './NotificationSettingsFields';

export default function NotificationSidecar({
  isOpen,
  side = 'right',
  draftEvent,
  onFieldChange,
  knownNotificationEmails,
  connectedAccounts,
  providers,
  onConnectProvider,
  oauthBusyProvider,
  oauthStatusMessage,
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <aside
      className={`notification-sidecar app-popover notification-sidecar--${side}`}
      aria-label="Notification settings"
    >
      <NotificationSettingsFields
        draftEvent={draftEvent}
        onFieldChange={onFieldChange}
        knownNotificationEmails={knownNotificationEmails}
        connectedAccounts={connectedAccounts}
        providers={providers}
        onConnectProvider={onConnectProvider}
        oauthBusyProvider={oauthBusyProvider}
        oauthStatusMessage={oauthStatusMessage}
        compact
      />
    </aside>
  );
}
