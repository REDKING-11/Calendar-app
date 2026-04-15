const { ipcMain } = require('electron');

function registerCalendarHandlers(store) {
  for (const channel of [
    'calendar:getSnapshot',
    'calendar:createEvent',
    'calendar:updateEvent',
    'calendar:deleteEvent',
  ]) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle('calendar:getSnapshot', () => store.snapshot());
  ipcMain.handle('calendar:createEvent', (_event, input) => store.createEvent(input));
  ipcMain.handle('calendar:updateEvent', (_event, input) => store.updateEvent(input));
  ipcMain.handle('calendar:deleteEvent', (_event, eventId) => store.deleteEvent(eventId));
}

module.exports = { registerCalendarHandlers };
