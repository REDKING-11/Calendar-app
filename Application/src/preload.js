const { contextBridge } = require('electron');
const { ipcRenderer } = require('electron');

async function openSettingsWindow() {
  try {
    return await ipcRenderer.invoke('app:openSettingsWindow');
  } catch (error) {
    if (String(error?.message || '').includes("No handler registered for 'app:openSettingsWindow'")) {
      return {
        opened: false,
        reused: false,
        fallbackRequired: true,
      };
    }

    throw error;
  }
}

contextBridge.exposeInMainWorld('calendarApp', {
  platform: process.platform,
  openSettingsWindow,
  closeCurrentWindow: () => ipcRenderer.invoke('app:closeCurrentWindow'),
  getSnapshot: () => ipcRenderer.invoke('calendar:getSnapshot'),
  createEvent: (input) => ipcRenderer.invoke('calendar:createEvent', input),
  updateEvent: (input) => ipcRenderer.invoke('calendar:updateEvent', input),
  deleteEvent: (eventId) => ipcRenderer.invoke('calendar:deleteEvent', eventId),
  renameTag: (input) => ipcRenderer.invoke('calendar:renameTag', input),
  deleteTag: (tagId) => ipcRenderer.invoke('calendar:deleteTag', tagId),
  getHolidayCountries: () => ipcRenderer.invoke('calendar:getHolidayCountries'),
  preloadHolidays: (input) => ipcRenderer.invoke('calendar:preloadHolidays', input),
  importHolidays: (input) => ipcRenderer.invoke('calendar:importHolidays', input),
  getSecuritySnapshot: () => ipcRenderer.invoke('security:getSnapshot'),
  getSecurityProviders: () => ipcRenderer.invoke('security:getProviders'),
  listConnectedAccounts: () => ipcRenderer.invoke('security:listAccounts'),
  startOAuthConnect: (provider, accessLevel) =>
    ipcRenderer.invoke('security:startOAuthConnect', provider, accessLevel),
  finishOAuthConnect: (input) => ipcRenderer.invoke('security:finishOAuthConnect', input),
  disconnectAccount: (accountId) => ipcRenderer.invoke('security:disconnectAccount', accountId),
  revokeAccount: (accountId) => ipcRenderer.invoke('security:revokeAccount', accountId),
  listTrustedDevices: () => ipcRenderer.invoke('security:listTrustedDevices'),
  createPairingApproval: (label) => ipcRenderer.invoke('security:createPairingApproval', label),
  approvePairing: (input) => ipcRenderer.invoke('security:approvePairing', input),
  revokeTrustedDevice: (deviceId) =>
    ipcRenderer.invoke('security:revokeTrustedDevice', deviceId),
  getHostedSyncState: () => ipcRenderer.invoke('hosted:getState'),
  testHostedConnection: (baseUrl) => ipcRenderer.invoke('hosted:testConnection', baseUrl),
  registerHostedAccount: (input) => ipcRenderer.invoke('hosted:register', input),
  loginHostedAccount: (input) => ipcRenderer.invoke('hosted:login', input),
  syncHostedNow: () => ipcRenderer.invoke('hosted:syncNow'),
  disconnectHostedSync: () => ipcRenderer.invoke('hosted:disconnect'),
  exportHostedEnv: (values) => ipcRenderer.invoke('hosted:exportEnv', values),
  beginReauth: (action) => ipcRenderer.invoke('security:beginReauth', action),
  completeReauth: (challengeId, response) =>
    ipcRenderer.invoke('security:completeReauth', challengeId, response),
  exportSecureData: (approvalId) => ipcRenderer.invoke('security:exportSecureData', approvalId),
  rotateMasterKey: (approvalId) => ipcRenderer.invoke('security:rotateMasterKey', approvalId),
});
