/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ "./src/data/calendar-store.js"
/*!************************************!*\
  !*** ./src/data/calendar-store.js ***!
  \************************************/
(module, __unused_webpack_exports, __webpack_require__) {

const fs = __webpack_require__(/*! node:fs */ "node:fs");
const path = __webpack_require__(/*! node:path */ "node:path");
const crypto = __webpack_require__(/*! node:crypto */ "node:crypto");
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
  return [{
    title: 'Local-first architecture review',
    description: 'Walk through the sync model, local data ownership, and next implementation risks.',
    type: 'event',
    completed: false,
    repeat: 'none',
    hasDeadline: false,
    groupName: '',
    startsAt: new Date(year, month, day, 10, 0, 0, 0).toISOString(),
    endsAt: new Date(year, month, day, 11, 0, 0, 0).toISOString(),
    color: '#4f9d69',
    tags: [{
      id: createId('tag'),
      label: 'Architecture',
      color: '#1d4ed8'
    }, {
      id: createId('tag'),
      label: 'Review',
      color: '#9a3412'
    }]
  }, {
    title: 'Phone sync UX sketch',
    description: 'Map the pairing flow and identify where mobile editing should stay intentionally lightweight.',
    type: 'appointment',
    completed: false,
    repeat: 'none',
    hasDeadline: false,
    groupName: '',
    startsAt: new Date(year, month, day + 1, 14, 0, 0, 0).toISOString(),
    endsAt: new Date(year, month, day + 1, 15, 0, 0, 0).toISOString(),
    color: '#4d8cf5',
    tags: [{
      id: createId('tag'),
      label: 'UX',
      color: '#7c3aed'
    }]
  }, {
    title: 'Pairing flow test',
    description: 'Run through QR-based pairing and confirm the basic LAN sync handoff works.',
    type: 'task',
    completed: false,
    repeat: 'weekly',
    hasDeadline: true,
    groupName: 'Launch prep',
    startsAt: new Date(year, month, day + 3, 9, 30, 0, 0).toISOString(),
    endsAt: new Date(year, month, day + 3, 10, 0, 0, 0).toISOString(),
    color: '#e3a13b',
    tags: [{
      id: createId('tag'),
      label: 'Testing',
      color: '#be123c'
    }]
  }];
}
function normalizeTagLabel(label) {
  return typeof label === 'string' ? label.trim() : '';
}
function buildTagLookup(tags = []) {
  const lookup = new Map();
  for (const tag of tags) {
    const normalizedLabel = normalizeTagLabel(tag?.label).toLowerCase();
    if (!normalizedLabel) {
      continue;
    }
    lookup.set(normalizedLabel, {
      id: tag.id || createId('tag'),
      label: normalizeTagLabel(tag.label),
      color: tag.color || '#475569'
    });
  }
  return lookup;
}
function normalizeTags(tags = [], tagCatalog = []) {
  const knownTags = buildTagLookup(tagCatalog);
  return tags.filter(tag => normalizeTagLabel(tag?.label)).map(tag => {
    const label = normalizeTagLabel(tag.label);
    const knownTag = knownTags.get(label.toLowerCase());
    if (knownTag) {
      return {
        id: knownTag.id,
        label: knownTag.label,
        color: tag.color || knownTag.color
      };
    }
    return {
      id: tag.id || createId('tag'),
      label,
      color: tag.color || '#475569'
    };
  });
}
function mergeTagCatalog(existingTags = [], incomingTags = []) {
  const merged = buildTagLookup(existingTags);
  for (const tag of incomingTags) {
    const label = normalizeTagLabel(tag?.label);
    if (!label) {
      continue;
    }
    merged.set(label.toLowerCase(), {
      id: tag.id || merged.get(label.toLowerCase())?.id || createId('tag'),
      label,
      color: tag.color || merged.get(label.toLowerCase())?.color || '#475569'
    });
  }
  return Array.from(merged.values()).sort((left, right) => left.label.localeCompare(right.label));
}
function createEmptyState() {
  return {
    schemaVersion: 2,
    deviceId: createId('device'),
    lastSequence: 0,
    events: [],
    changes: [],
    tags: []
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
        return this.migrateState(JSON.parse(raw));
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
  migrateState(state) {
    const nextState = {
      ...createEmptyState(),
      ...state
    };
    nextState.tags = mergeTagCatalog(state.tags || [], (state.events || []).flatMap(event => event.tags || []));
    nextState.schemaVersion = 2;
    return nextState;
  }
  persist(state = this.state) {
    fs.mkdirSync(path.dirname(this.filePath), {
      recursive: true
    });
    fs.writeFileSync(this.filePath, JSON.stringify(state, null, 2));
  }
  createChange({
    entity,
    entityId,
    operation,
    patch
  }) {
    this.state.lastSequence += 1;
    return {
      changeId: createId('change'),
      sequence: this.state.lastSequence,
      deviceId: this.state.deviceId,
      entity,
      entityId,
      operation,
      patch,
      timestamp: nowIso()
    };
  }
  applyLocalCreate(state, input) {
    const timestamp = nowIso();
    const tags = normalizeTags(input.tags, state.tags);
    const event = {
      id: createId('event'),
      title: input.title,
      description: input.description || '',
      type: input.type || 'event',
      completed: Boolean(input.completed),
      repeat: input.repeat || 'none',
      hasDeadline: Boolean(input.hasDeadline),
      groupName: input.groupName || '',
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      color: input.color || '#4f9d69',
      tags,
      deleted: false,
      updatedAt: timestamp,
      updatedBy: state.deviceId
    };
    state.lastSequence += 1;
    state.tags = mergeTagCatalog(state.tags, tags);
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
        description: event.description,
        type: event.type,
        completed: event.completed,
        repeat: event.repeat,
        hasDeadline: event.hasDeadline,
        groupName: event.groupName,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        color: event.color,
        tags: event.tags
      },
      timestamp
    });
  }
  snapshot() {
    const activeEvents = this.state.events.filter(event => !event.deleted).sort((left, right) => left.startsAt.localeCompare(right.startsAt));
    return {
      deviceId: this.state.deviceId,
      lastSequence: this.state.lastSequence,
      events: activeEvents,
      tags: this.state.tags,
      changes: this.state.changes,
      stats: {
        activeEventCount: activeEvents.length,
        changeCount: this.state.changes.length
      }
    };
  }
  createEvent(input) {
    const timestamp = nowIso();
    const tags = normalizeTags(input.tags, this.state.tags);
    const event = {
      id: createId('event'),
      title: input.title,
      description: input.description || '',
      type: input.type || 'event',
      completed: Boolean(input.completed),
      repeat: input.repeat || 'none',
      hasDeadline: Boolean(input.hasDeadline),
      groupName: input.groupName || '',
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      color: input.color || '#4f9d69',
      tags,
      deleted: false,
      updatedAt: timestamp,
      updatedBy: this.state.deviceId
    };
    this.state.tags = mergeTagCatalog(this.state.tags, tags);
    this.state.events.push(event);
    this.state.changes.push(this.createChange({
      entity: 'event',
      entityId: event.id,
      operation: 'create',
      patch: {
        title: event.title,
        description: event.description,
        type: event.type,
        completed: event.completed,
        repeat: event.repeat,
        hasDeadline: event.hasDeadline,
        groupName: event.groupName,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        color: event.color,
        tags: event.tags
      }
    }));
    this.persist();
    return this.snapshot();
  }
  updateEvent(input) {
    const event = this.state.events.find(candidate => candidate.id === input.id);
    if (!event || event.deleted) {
      throw new Error('Event not found');
    }
    const patch = {};
    for (const field of ['title', 'description', 'type', 'completed', 'repeat', 'hasDeadline', 'groupName', 'startsAt', 'endsAt', 'color']) {
      if (input[field] !== undefined && input[field] !== event[field]) {
        patch[field] = input[field];
        event[field] = input[field];
      }
    }
    if (input.tags !== undefined) {
      const nextTags = normalizeTags(input.tags, this.state.tags);
      const previousTags = JSON.stringify(event.tags || []);
      const nextTagsSerialized = JSON.stringify(nextTags);
      if (previousTags !== nextTagsSerialized) {
        patch.tags = nextTags;
        event.tags = nextTags;
        this.state.tags = mergeTagCatalog(this.state.tags, nextTags);
      }
    }
    if (Object.keys(patch).length === 0) {
      return this.snapshot();
    }
    event.updatedAt = nowIso();
    event.updatedBy = this.state.deviceId;
    this.state.changes.push(this.createChange({
      entity: 'event',
      entityId: event.id,
      operation: 'update',
      patch
    }));
    this.persist();
    return this.snapshot();
  }
  deleteEvent(eventId) {
    const event = this.state.events.find(candidate => candidate.id === eventId);
    if (!event || event.deleted) {
      throw new Error('Event not found');
    }
    event.deleted = true;
    event.updatedAt = nowIso();
    event.updatedBy = this.state.deviceId;
    this.state.changes.push(this.createChange({
      entity: 'event',
      entityId: event.id,
      operation: 'delete',
      patch: {
        deleted: true
      }
    }));
    this.persist();
    return this.snapshot();
  }
}
module.exports = {
  CalendarStore
};

/***/ },

/***/ "./src/ipc/calendar-ipc.js"
/*!*********************************!*\
  !*** ./src/ipc/calendar-ipc.js ***!
  \*********************************/
(module, __unused_webpack_exports, __webpack_require__) {

const {
  ipcMain
} = __webpack_require__(/*! electron */ "electron");
function registerCalendarHandlers(store) {
  for (const channel of ['calendar:getSnapshot', 'calendar:createEvent', 'calendar:updateEvent', 'calendar:deleteEvent']) {
    ipcMain.removeHandler(channel);
  }
  ipcMain.handle('calendar:getSnapshot', () => store.snapshot());
  ipcMain.handle('calendar:createEvent', (_event, input) => store.createEvent(input));
  ipcMain.handle('calendar:updateEvent', (_event, input) => store.updateEvent(input));
  ipcMain.handle('calendar:deleteEvent', (_event, eventId) => store.deleteEvent(eventId));
}
module.exports = {
  registerCalendarHandlers
};

/***/ },

/***/ "electron"
/*!***************************!*\
  !*** external "electron" ***!
  \***************************/
(module) {

"use strict";
module.exports = require("electron");

/***/ },

/***/ "node:crypto"
/*!******************************!*\
  !*** external "node:crypto" ***!
  \******************************/
(module) {

"use strict";
module.exports = require("node:crypto");

/***/ },

/***/ "node:fs"
/*!**************************!*\
  !*** external "node:fs" ***!
  \**************************/
(module) {

"use strict";
module.exports = require("node:fs");

/***/ },

/***/ "node:path"
/*!****************************!*\
  !*** external "node:path" ***!
  \****************************/
(module) {

"use strict";
module.exports = require("node:path");

/***/ },

/***/ "path"
/*!***********************!*\
  !*** external "path" ***!
  \***********************/
(module) {

"use strict";
module.exports = require("path");

/***/ }

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		if (!(moduleId in __webpack_modules__)) {
/******/ 			delete __webpack_module_cache__[moduleId];
/******/ 			var e = new Error("Cannot find module '" + moduleId + "'");
/******/ 			e.code = 'MODULE_NOT_FOUND';
/******/ 			throw e;
/******/ 		}
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be isolated against other modules in the chunk.
(() => {
/*!*********************!*\
  !*** ./src/main.js ***!
  \*********************/
const path = __webpack_require__(/*! path */ "path");
const {
  app,
  BrowserWindow
} = __webpack_require__(/*! electron */ "electron");
const {
  CalendarStore
} = __webpack_require__(/*! ./data/calendar-store */ "./src/data/calendar-store.js");
const {
  registerCalendarHandlers
} = __webpack_require__(/*! ./ipc/calendar-ipc */ "./src/ipc/calendar-ipc.js");
const createWindow = () => {
  const preloadPath = path.join(__dirname, '..', 'renderer', 'main_window', 'preload.js');
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#f4efe7',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadURL('http://localhost:3001/main_window/index.html');
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({
      mode: 'detach'
    });
  }
};
app.whenReady().then(() => {
  const store = new CalendarStore(app.getPath('userData'));
  registerCalendarHandlers(store);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
})();

module.exports = __webpack_exports__;
/******/ })()
;
//# sourceMappingURL=index.js.map