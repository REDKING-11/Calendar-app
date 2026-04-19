import React, { useEffect } from 'react';
import EventComposerFields from './EventComposerFields';

export default function EventComposerDrawer({
  isOpen,
  mode = 'create',
  draftEvent,
  preferences,
  onClose,
  onFieldChange,
  onSelectDuration,
  onFindFreeSlot,
  conflictSummary,
  knownNotificationEmails,
  connectedAccounts,
  providers,
  onConnectProvider,
  oauthBusyProvider,
  oauthStatusMessage,
  onDelete,
  onSubmit,
}) {
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        onClose?.();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  return (
    <aside
      className={`event-drawer ${isOpen ? 'event-drawer--open' : ''}`}
      aria-hidden={!isOpen}
      role="dialog"
      aria-modal="true"
      aria-labelledby="event-composer-dialog-title"
    >
      <section className="app-drawer-panel event-drawer-panel">
        <div className="event-composer-top event-composer-modal-header">
          <div>
            <p className="settings-section-eyebrow">
              {mode === 'edit' ? 'Full details' : 'Create event'}
            </p>
            <h2
              id="event-composer-dialog-title"
              className="event-composer-modal-title"
            >
              {mode === 'edit' ? 'Edit event details' : 'Create event from sidebar'}
            </h2>
          </div>
          <button
            type="button"
            className="app-button app-button--secondary"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <form className="event-composer-layout event-composer-layout--modal" onSubmit={onSubmit}>
          <div className="event-composer-scroll event-composer-scroll--modal">
            <EventComposerFields
              draftEvent={draftEvent}
              onFieldChange={onFieldChange}
              onSelectDuration={onSelectDuration}
              conflictSummary={conflictSummary}
              onFindFreeSlot={onFindFreeSlot}
              titleAutoFocus={isOpen}
              variant="full"
              preferences={preferences}
              knownNotificationEmails={knownNotificationEmails}
              connectedAccounts={connectedAccounts}
              providers={providers}
              onConnectProvider={onConnectProvider}
              oauthBusyProvider={oauthBusyProvider}
              oauthStatusMessage={oauthStatusMessage}
            />
          </div>

          <div className="event-composer-footer event-composer-footer--modal">
            <div className="event-composer-footer-row">
              <div>
                {mode === 'edit' ? (
                  <button
                    type="button"
                    onClick={onDelete}
                    className="app-button app-danger-button"
                  >
                    Delete
                  </button>
                ) : null}
              </div>
              <div className="event-composer-footer-actions">
                <button
                  type="button"
                  onClick={onClose}
                  className="app-button app-button--secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="app-button app-button--primary"
                >
                  {mode === 'edit' ? 'Save changes' : 'Create event'}
                </button>
              </div>
            </div>
          </div>
        </form>
      </section>
    </aside>
  );
}
