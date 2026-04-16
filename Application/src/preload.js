const { contextBridge } = require('electron');
const { ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('calendarApp', {
  platform: process.platform,
  getSnapshot: () => ipcRenderer.invoke('calendar:getSnapshot'),
  createEvent: (input) => ipcRenderer.invoke('calendar:createEvent', input),
  updateEvent: (input) => ipcRenderer.invoke('calendar:updateEvent', input),
  deleteEvent: (eventId) => ipcRenderer.invoke('calendar:deleteEvent', eventId),
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
  startHostedSyncConnect: (baseUrl, provider) =>
    ipcRenderer.invoke('hosted:startConnect', baseUrl, provider),
  pollHostedSyncAuth: () => ipcRenderer.invoke('hosted:pollAuth'),
  syncHostedNow: () => ipcRenderer.invoke('hosted:syncNow'),
  disconnectHostedSync: () => ipcRenderer.invoke('hosted:disconnect'),
  beginReauth: (action) => ipcRenderer.invoke('security:beginReauth', action),
  completeReauth: (challengeId, response) =>
    ipcRenderer.invoke('security:completeReauth', challengeId, response),
  exportSecureData: (approvalId) => ipcRenderer.invoke('security:exportSecureData', approvalId),
  rotateMasterKey: (approvalId) => ipcRenderer.invoke('security:rotateMasterKey', approvalId),
});
