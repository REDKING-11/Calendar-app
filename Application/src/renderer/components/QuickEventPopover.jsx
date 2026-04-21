import React, { useCallback, useEffect, useRef, useState } from 'react';
import EventComposerFields from './EventComposerFields';
import NotificationSidecar from './NotificationSidecar';

const DEFAULT_POPOVER_WIDTH = 640;
const DEFAULT_POPOVER_HEIGHT = 360;
const VIEWPORT_MARGIN = 16;

function getViewportConstrainedSize() {
  return {
    width: Math.min(DEFAULT_POPOVER_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2),
    height: Math.min(DEFAULT_POPOVER_HEIGHT, window.innerHeight - VIEWPORT_MARGIN * 2),
  };
}

function clampPopoverPosition(position) {
  const { width, height } = getViewportConstrainedSize();
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(Number(position?.left || VIEWPORT_MARGIN), window.innerWidth - width - VIEWPORT_MARGIN)
  );
  const top = Math.max(
    VIEWPORT_MARGIN,
    Math.min(Number(position?.top || VIEWPORT_MARGIN), window.innerHeight - height - VIEWPORT_MARGIN)
  );

  return { left, top };
}

function getInitialPopoverPosition(anchorPoint) {
  return clampPopoverPosition({
    left: Number(anchorPoint?.x || VIEWPORT_MARGIN),
    top: Number(anchorPoint?.y || VIEWPORT_MARGIN) + 10,
  });
}

export default function QuickEventPopover({
  isOpen,
  mode = 'create',
  anchorPoint,
  draftEvent,
  preferences,
  onClose,
  onFieldChange,
  onSelectDuration,
  conflictSummary,
  onOpenFullDetails,
  knownNotificationEmails,
  connectedAccounts,
  providers,
  onConnectProvider,
  onOpenConnectionSettings,
  oauthBusyProvider,
  oauthStatusMessage,
  onSubmit,
  popoverRef,
}) {
  const localPopoverRef = useRef(null);
  const dragStateRef = useRef(null);
  const [position, setPosition] = useState(() => getInitialPopoverPosition(anchorPoint));
  const [isDragging, setIsDragging] = useState(false);
  const [isNotificationOpen, setIsNotificationOpen] = useState(false);

  const setCombinedRef = useCallback(
    (node) => {
      localPopoverRef.current = node;
      if (!popoverRef) {
        return;
      }

      if (typeof popoverRef === 'function') {
        popoverRef(node);
        return;
      }

      popoverRef.current = node;
    },
    [popoverRef]
  );

  useEffect(() => {
    if (!isOpen || !draftEvent) {
      return;
    }

    setPosition(getInitialPopoverPosition(anchorPoint));
    setIsNotificationOpen(false);
  }, [isOpen, anchorPoint?.x, anchorPoint?.y, mode]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleResize = () => {
      setPosition((current) => clampPopoverPosition(current));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isOpen]);

  if (!isOpen || !draftEvent) {
    return null;
  }

  const estimatedWidth = 360;
  const remainingRightSpace =
    window.innerWidth - position.left - DEFAULT_POPOVER_WIDTH - VIEWPORT_MARGIN;
  const sidecarSide = remainingRightSpace >= estimatedWidth ? 'right' : 'left';

  const handleDragStart = (event) => {
    if (event.button !== 0) {
      return;
    }

    const rect = localPopoverRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    setIsDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handleDragMove = (event) => {
    if (!dragStateRef.current || dragStateRef.current.pointerId !== event.pointerId) {
      return;
    }

    setPosition(
      clampPopoverPosition({
        left: event.clientX - dragStateRef.current.offsetX,
        top: event.clientY - dragStateRef.current.offsetY,
      })
    );
  };

  const handleDragEnd = (event) => {
    if (!dragStateRef.current || dragStateRef.current.pointerId !== event.pointerId) {
      return;
    }

    dragStateRef.current = null;
    setIsDragging(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  return (
    <section
      ref={setCombinedRef}
      className={`app-popover fixed z-[45] w-[min(640px,calc(100vw-32px))] max-h-[calc(100vh-32px)] overflow-visible rounded-3xl p-3.5 ${
        isDragging ? 'quick-event-popover--dragging' : ''
      }`}
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
      }}
    >
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div
          className="quick-event-popover-drag"
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
        >
          <span className="quick-event-popover-handle" aria-hidden="true" />
          <div>
            <p className="settings-section-eyebrow">
              {mode === 'edit' ? 'Quick edit' : 'Quick create'}
            </p>
            <h2 className="m-0 text-[1.16rem] leading-none">
              {mode === 'edit' ? 'Update event' : 'Create event'}
            </h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`app-button app-button--secondary px-[0.84rem] py-[0.52rem] text-[0.84rem] ${
              isNotificationOpen
                ? 'border-[var(--border-color-strong)] bg-[var(--interactive-active)]'
                : ''
            }`}
            onClick={() => setIsNotificationOpen((current) => !current)}
          >
            Notifications
          </button>
          <button
            type="button"
            className="app-button app-button--secondary px-[0.84rem] py-[0.52rem] text-[0.84rem]"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>

      <form className="grid gap-2.5" onSubmit={onSubmit}>
        <EventComposerFields
          draftEvent={draftEvent}
          onFieldChange={onFieldChange}
          onSelectDuration={onSelectDuration}
          conflictSummary={conflictSummary}
          titleAutoFocus
          variant="quick"
          preferences={preferences}
        />

        <NotificationSidecar
          isOpen={isNotificationOpen}
          side={sidecarSide}
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

        <div className="static m-0 flex flex-wrap justify-end gap-2.5 bg-transparent p-0 backdrop-blur-none">
          <button
            type="button"
            className="app-button app-button--secondary px-[0.88rem] py-[0.58rem] text-[0.9rem]"
            onClick={onOpenFullDetails}
          >
            More options
          </button>
          <button
            type="button"
            className="app-button app-button--secondary px-[0.88rem] py-[0.58rem] text-[0.9rem]"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="app-button app-button--primary px-[0.88rem] py-[0.58rem] text-[0.9rem]"
          >
            {mode === 'edit' ? 'Save changes' : 'Create event'}
          </button>
        </div>
      </form>
    </section>
  );
}
