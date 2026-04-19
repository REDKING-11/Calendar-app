import { formatDateForInput, formatTimeForInput } from './eventDraft';

export function buildSlotSignature(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }

  return `${formatDateForInput(date)}T${formatTimeForInput(date)}`;
}

export function promoteComposerStateToDrawer(currentState) {
  return {
    ...currentState,
    variant: 'drawer',
    anchorPoint: null,
  };
}

export function shouldPromoteQuickCreateDraft({
  composerState,
  activeEvent,
  draftEvent,
  requestDate,
}) {
  if (
    composerState?.variant !== 'quick' ||
    composerState?.mode !== 'create' ||
    activeEvent ||
    !draftEvent?.date ||
    !draftEvent?.time
  ) {
    return false;
  }

  return `${draftEvent.date}T${draftEvent.time}` === buildSlotSignature(requestDate);
}

export function shouldPromoteQuickEditDraft({
  composerState,
  activeEvent,
  requestEvent,
}) {
  return Boolean(
    composerState?.variant === 'quick' &&
      composerState?.mode === 'edit' &&
      activeEvent?.id &&
      requestEvent?.id &&
      activeEvent.id === requestEvent.id
  );
}
