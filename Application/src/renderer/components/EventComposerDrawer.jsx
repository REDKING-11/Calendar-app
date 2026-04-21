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
  externalCalendarsByAccount,
  onLoadExternalCalendars,
  onConnectProvider,
  onOpenConnectionSettings,
  oauthBusyProvider,
  oauthStatusMessage,
  composerStatusMessage,
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
      <section className="app-drawer-panel event-drawer-panel pointer-events-none flex h-[min(960px,calc(100vh-48px))] max-h-[calc(100vh-48px)] w-[min(1520px,calc(100vw-48px))] flex-col overflow-hidden rounded-[32px] p-0 max-[900px]:h-[calc(100vh-24px)] max-[900px]:max-h-[calc(100vh-24px)] max-[900px]:w-[calc(100vw-24px)] max-[900px]:rounded-[26px]">
        <div className="flex shrink-0 items-start justify-between gap-4 px-7 pt-6 max-[900px]:gap-3 max-[900px]:px-5 max-[900px]:pt-5">
          <div>
            <p className="settings-section-eyebrow">
              {mode === 'edit' ? 'Full details' : 'Create event'}
            </p>
            <h2
              id="event-composer-dialog-title"
              className="m-0 text-[clamp(1.85rem,2vw,2.3rem)] font-bold leading-[1.04] tracking-[-0.03em] text-[var(--text-primary)] max-[900px]:text-[clamp(1.55rem,5vw,1.95rem)]"
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

        <form
          className="flex min-h-0 flex-1 flex-col px-7 pb-6 pt-[18px] max-[900px]:px-5 max-[900px]:pb-5 max-[900px]:pt-4"
          onSubmit={onSubmit}
        >
          <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto pb-2 pr-2.5">
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
              externalCalendarsByAccount={externalCalendarsByAccount}
              onLoadExternalCalendars={onLoadExternalCalendars}
              onConnectProvider={onConnectProvider}
              onOpenConnectionSettings={onOpenConnectionSettings}
              oauthBusyProvider={oauthBusyProvider}
              oauthStatusMessage={oauthStatusMessage}
            />
            {composerStatusMessage ? (
              <p className="settings-inline-warning event-composer-status">
                {composerStatusMessage}
              </p>
            ) : null}
          </div>

          <div className="static mt-[18px] shrink-0 border-t border-[var(--border-color)] bg-[linear-gradient(180deg,transparent,var(--surface-overlay)_35%,transparent_100%)] px-0 pb-0 pt-4 backdrop-blur-none">
            <div className="flex items-center justify-between gap-2.5 max-[900px]:flex-col max-[900px]:items-stretch">
              <div>
                {mode === 'edit' ? (
                  <button
                    type="button"
                    onClick={onDelete}
                    className="app-button app-danger-button max-[900px]:flex-1 max-[900px]:basis-[180px]"
                  >
                    Delete
                  </button>
                ) : null}
              </div>
              <div className="flex justify-end gap-2.5 max-[900px]:w-full max-[900px]:flex-wrap max-[900px]:justify-stretch">
                <button
                  type="button"
                  onClick={onClose}
                  className="app-button app-button--secondary max-[900px]:flex-1 max-[900px]:basis-[180px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="app-button app-button--primary max-[900px]:flex-1 max-[900px]:basis-[180px]"
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
