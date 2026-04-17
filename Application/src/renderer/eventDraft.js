export const COLOR_PRESETS = ['#4f9d69', '#4d8cf5', '#e3a13b', '#7c3aed', '#ef4444', '#0f766e'];
export const TAG_COLOR_PRESETS = ['#1d4ed8', '#7c3aed', '#be123c', '#0f766e', '#9a3412', '#475569'];
export const EVENT_TYPE_OPTIONS = [
  { id: 'event', label: 'Event' },
  { id: 'task', label: 'Task' },
  { id: 'appointment', label: 'Appointment' },
];
export const TASK_REPEAT_OPTIONS = [
  { id: 'none', label: 'Does not repeat' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
];

export function formatDateForInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatTimeForInput(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

export function createDraftTagId() {
  return `draft_tag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createEmptyDraftEvent(date = new Date(), durationMinutes = 60) {
  const defaultTime =
    date.getHours() === 0 && date.getMinutes() === 0 ? '09:00' : formatTimeForInput(date);
  const endDate = new Date(date);
  endDate.setMinutes(endDate.getMinutes() + durationMinutes);

  return {
    title: '',
    description: '',
    type: 'event',
    date: formatDateForInput(date),
    time: defaultTime,
    endTime: formatTimeForInput(endDate),
    completed: false,
    repeat: 'none',
    hasDeadline: false,
    groupName: '',
    color: COLOR_PRESETS[0],
    tags: [],
  };
}

export function createDraftEventFromEvent(event) {
  const startsAt = new Date(event.startsAt);

  return {
    title: event.title || '',
    description: event.description || '',
    type: event.type || 'event',
    date: formatDateForInput(startsAt),
    time: formatTimeForInput(startsAt),
    endTime: formatTimeForInput(new Date(event.endsAt)),
    completed: Boolean(event.completed),
    repeat: event.repeat || 'none',
    hasDeadline: Boolean(event.hasDeadline),
    groupName: event.groupName || '',
    color: event.color || COLOR_PRESETS[0],
    tags: (event.tags || []).map((tag) => ({ ...tag })),
  };
}

export function createEmptyDraftTag() {
  return {
    label: '',
    color: TAG_COLOR_PRESETS[0],
  };
}
