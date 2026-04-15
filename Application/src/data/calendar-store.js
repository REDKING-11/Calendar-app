const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function buildDemoEvents() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const day = today.getDate();

  return [
    {
      title: 'Local-first architecture review',
      startsAt: new Date(year, month, day, 10, 0, 0, 0).toISOString(),
      endsAt: new Date(year, month, day, 11, 0, 0, 0).toISOString(),
      color: '#4f9d69',
    },
    {
      title: 'Phone sync UX sketch',
      startsAt: new Date(year, month, day + 1, 14, 0, 0, 0).toISOString(),
      endsAt: new Date(year, month, day + 1, 15, 0, 0, 0).toISOString(),
      color: '#4d8cf5',
    },
    {
      title: 'Pairing flow test',
      startsAt: new Date(year, month, day + 3, 9, 30, 0, 0).toISOString(),
      endsAt: new Date(year, month, day + 3, 10, 0, 0, 0).toISOString(),
      color: '#e3a13b',
    },
  ];
}

function createEmptyState() {
  return {
    schemaVersion: 1,
    deviceId: createId('device'),
    lastSequence: 0,
    events: [],
    changes: [],
  };
}

class CalendarStore {
  constructor(baseDir) {
    this.filePath = path.join(baseDir, 'calendar-data.json');
    this.state = this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        return JSON.parse(raw);
      }
    } catch (error) {
      console.error('Failed to load calendar store:', error);
    }

    const state = createEmptyState();
    for (const eventInput of buildDemoEvents()) {
      this.applyLocalCreate(state, eventInput);
    }
    this.persist(state);
    return state;
  }

  persist(state = this.state) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2));
  }

  createChange({ entity, entityId, operation, patch }) {
    this.state.lastSequence += 1;
    return {
      changeId: createId('change'),
      sequence: this.state.lastSequence,
      deviceId: this.state.deviceId,
      entity,
      entityId,
      operation,
      patch,
      timestamp: nowIso(),
    };
  }

  applyLocalCreate(state, input) {
    const timestamp = nowIso();
    const event = {
      id: createId('event'),
      title: input.title,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      color: input.color || '#4f9d69',
      deleted: false,
      updatedAt: timestamp,
      updatedBy: state.deviceId,
    };

    state.lastSequence += 1;
    state.events.push(event);
    state.changes.push({
      changeId: createId('change'),
      sequence: state.lastSequence,
      deviceId: state.deviceId,
      entity: 'event',
      entityId: event.id,
      operation: 'create',
      patch: {
        title: event.title,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        color: event.color,
      },
      timestamp,
    });
  }

  snapshot() {
    const activeEvents = this.state.events
      .filter((event) => !event.deleted)
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt));

    return {
      deviceId: this.state.deviceId,
      lastSequence: this.state.lastSequence,
      events: activeEvents,
      changes: this.state.changes,
      stats: {
        activeEventCount: activeEvents.length,
        changeCount: this.state.changes.length,
      },
    };
  }

  createEvent(input) {
    const timestamp = nowIso();
    const event = {
      id: createId('event'),
      title: input.title,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      color: input.color || '#4f9d69',
      deleted: false,
      updatedAt: timestamp,
      updatedBy: this.state.deviceId,
    };

    this.state.events.push(event);
    this.state.changes.push(
      this.createChange({
        entity: 'event',
        entityId: event.id,
        operation: 'create',
        patch: {
          title: event.title,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          color: event.color,
        },
      })
    );
    this.persist();
    return this.snapshot();
  }

  updateEvent(input) {
    const event = this.state.events.find((candidate) => candidate.id === input.id);

    if (!event || event.deleted) {
      throw new Error('Event not found');
    }

    const patch = {};
    for (const field of ['title', 'startsAt', 'endsAt', 'color']) {
      if (input[field] !== undefined && input[field] !== event[field]) {
        patch[field] = input[field];
        event[field] = input[field];
      }
    }

    if (Object.keys(patch).length === 0) {
      return this.snapshot();
    }

    event.updatedAt = nowIso();
    event.updatedBy = this.state.deviceId;

    this.state.changes.push(
      this.createChange({
        entity: 'event',
        entityId: event.id,
        operation: 'update',
        patch,
      })
    );
    this.persist();
    return this.snapshot();
  }

  deleteEvent(eventId) {
    const event = this.state.events.find((candidate) => candidate.id === eventId);

    if (!event || event.deleted) {
      throw new Error('Event not found');
    }

    event.deleted = true;
    event.updatedAt = nowIso();
    event.updatedBy = this.state.deviceId;

    this.state.changes.push(
      this.createChange({
        entity: 'event',
        entityId: event.id,
        operation: 'delete',
        patch: { deleted: true },
      })
    );
    this.persist();
    return this.snapshot();
  }
}

module.exports = { CalendarStore };
