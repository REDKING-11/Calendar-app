const { contextBridge } = require('electron');
const { ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('calendarApp', {
  platform: process.platform,
  getSnapshot: () => ipcRenderer.invoke('calendar:getSnapshot'),
  createEvent: (input) => ipcRenderer.invoke('calendar:createEvent', input),
  updateEvent: (input) => ipcRenderer.invoke('calendar:updateEvent', input),
  deleteEvent: (eventId) => ipcRenderer.invoke('calendar:deleteEvent', eventId),
});
