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
  openExternalLink: (url) => ipcRenderer.invoke('app:openExternalLink', url),
  closeCurrentWindow: () => ipcRenderer.invoke('app:closeCurrentWindow'),
  getSnapshot: () => ipcRenderer.invoke('calendar:getSnapshot'),
  createEvent: (input) => ipcRenderer.invoke('calendar:createEvent', input),
  updateEvent: (input) => ipcRenderer.invoke('calendar:updateEvent', input),
  deleteEvent: (eventId, options) => ipcRenderer.invoke('calendar:deleteEvent', eventId, options),
  listExternalCalendars: (input) => ipcRenderer.invoke('calendar:listExternalCalendars', input),
  importExternalCalendar: (input) => ipcRenderer.invoke('calendar:importExternalCalendar', input),
  refreshExternalSource: (input) => ipcRenderer.invoke('calendar:refreshExternalSource', input),
  setExternalCalendarSourceSelected: (input) =>
    ipcRenderer.invoke('calendar:setExternalCalendarSourceSelected', input),
  deleteExternalCalendarSource: (input) =>
    ipcRenderer.invoke('calendar:deleteExternalCalendarSource', input),
  importData: (input) => ipcRenderer.invoke('calendar:importData', input),
  importDataFromFilePicker: () => ipcRenderer.invoke('calendar:importDataFromFilePicker'),
  exportData: (input) => ipcRenderer.invoke('calendar:exportData', input),
  renameTag: (input) => ipcRenderer.invoke('calendar:renameTag', input),
  deleteTag: (tagId) => ipcRenderer.invoke('calendar:deleteTag', tagId),
  getHolidayCountries: () => ipcRenderer.invoke('calendar:getHolidayCountries'),
  preloadHolidays: (input) => ipcRenderer.invoke('calendar:preloadHolidays', input),
  importHolidays: (input) => ipcRenderer.invoke('calendar:importHolidays', input),
  getSecuritySnapshot: () => ipcRenderer.invoke('security:getSnapshot'),
  getSecurityProviders: () => ipcRenderer.invoke('security:getProviders'),
  getOAuthClientConfig: () => ipcRenderer.invoke('security:getOAuthClientConfig'),
  updateOAuthClientConfig: (input) => ipcRenderer.invoke('security:updateOAuthClientConfig', input),
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
  createLocalSession: (input) => ipcRenderer.invoke('transport:createLocalSession', input),
  consumeLocalSession: (input) => ipcRenderer.invoke('transport:consumeLocalSession', input),
  getHostedSyncState: () => ipcRenderer.invoke('hosted:getState'),
  testHostedConnection: (baseUrl) => ipcRenderer.invoke('hosted:testConnection', baseUrl),
  registerHostedAccount: (input) => ipcRenderer.invoke('hosted:register', input),
  loginHostedAccount: (input) => ipcRenderer.invoke('hosted:login', input),
  syncHostedNow: () => ipcRenderer.invoke('hosted:syncNow'),
  disconnectHostedSync: () => ipcRenderer.invoke('hosted:disconnect'),
  exportHostedEnv: (values) => ipcRenderer.invoke('hosted:exportEnv', values),
  listHostedShares: () => ipcRenderer.invoke('hosted:listShares'),
  createHostedShare: (input) => ipcRenderer.invoke('hosted:createShare', input),
  updateHostedShare: (input) => ipcRenderer.invoke('hosted:updateShare', input),
  revokeHostedShare: (shareId) => ipcRenderer.invoke('hosted:revokeShare', shareId),
  rotateHostedShareToken: (shareId) => ipcRenderer.invoke('hosted:rotateShareToken', shareId),
  updateHostedShareRecipients: (input) => ipcRenderer.invoke('hosted:updateShareRecipients', input),
  publishHostedShare: (input) => ipcRenderer.invoke('hosted:publishShare', input),
  beginReauth: (action) => ipcRenderer.invoke('security:beginReauth', action),
  completeReauth: (challengeId, response) =>
    ipcRenderer.invoke('security:completeReauth', challengeId, response),
  exportSecureData: (approvalId) => ipcRenderer.invoke('security:exportSecureData', approvalId),
  rotateMasterKey: (approvalId) => ipcRenderer.invoke('security:rotateMasterKey', approvalId),
});
