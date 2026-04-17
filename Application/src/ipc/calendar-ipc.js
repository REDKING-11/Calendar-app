const { ipcMain } = require('electron');

function registerCalendarHandlers(store) {
  for (const channel of [
    'calendar:getSnapshot',
    'calendar:createEvent',
    'calendar:updateEvent',
    'calendar:deleteEvent',
    'calendar:renameTag',
    'calendar:deleteTag',
    'calendar:getHolidayCountries',
    'calendar:preloadHolidays',
    'calendar:importHolidays',
    'security:getSnapshot',
    'security:getProviders',
    'security:listAccounts',
    'security:startOAuthConnect',
    'security:finishOAuthConnect',
    'security:disconnectAccount',
    'security:revokeAccount',
    'security:listTrustedDevices',
    'security:createPairingApproval',
    'security:approvePairing',
    'security:revokeTrustedDevice',
    'hosted:getState',
    'hosted:testConnection',
    'hosted:register',
    'hosted:login',
    'hosted:syncNow',
    'hosted:disconnect',
    'hosted:exportEnv',
    'security:beginReauth',
    'security:completeReauth',
    'security:exportSecureData',
    'security:rotateMasterKey',
  ]) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle('calendar:getSnapshot', () => store.snapshot());
  ipcMain.handle('calendar:createEvent', (_event, input) => store.createEvent(input));
  ipcMain.handle('calendar:updateEvent', (_event, input) => store.updateEvent(input));
  ipcMain.handle('calendar:deleteEvent', (_event, eventId) => store.deleteEvent(eventId));
  ipcMain.handle('calendar:renameTag', (_event, input) =>
    store.renameTagSystemWide(input?.tagId, input?.label)
  );
  ipcMain.handle('calendar:deleteTag', (_event, tagId) => store.deleteTagSystemWide(tagId));
  ipcMain.handle('calendar:getHolidayCountries', () => store.getHolidayCountries());
  ipcMain.handle('calendar:preloadHolidays', (_event, input) => store.preloadHolidays(input));
  ipcMain.handle('calendar:importHolidays', (_event, input) => store.importHolidays(input));
  ipcMain.handle('security:getSnapshot', () => store.getSecuritySnapshot());
  ipcMain.handle('security:getProviders', () => store.getAvailableProviders());
  ipcMain.handle('security:listAccounts', () => store.listConnectedAccounts());
  ipcMain.handle('security:startOAuthConnect', (_event, provider, accessLevel) =>
    store.startOAuthConnect(provider, accessLevel)
  );
  ipcMain.handle('security:finishOAuthConnect', (_event, input) =>
    store.finishOAuthConnect(input)
  );
  ipcMain.handle('security:disconnectAccount', (_event, accountId) =>
    store.disconnectAccount(accountId)
  );
  ipcMain.handle('security:revokeAccount', (_event, accountId) =>
    store.revokeAccount(accountId)
  );
  ipcMain.handle('security:listTrustedDevices', () => store.listTrustedDevices());
  ipcMain.handle('security:createPairingApproval', (_event, label) =>
    store.createPairingApproval(label)
  );
  ipcMain.handle('security:approvePairing', (_event, input) => store.approvePairing(input));
  ipcMain.handle('security:revokeTrustedDevice', (_event, deviceId) =>
    store.revokeTrustedDevice(deviceId)
  );
  ipcMain.handle('hosted:getState', () => store.getHostedSyncState());
  ipcMain.handle('hosted:testConnection', (_event, baseUrl) => store.testHostedBackend(baseUrl));
  ipcMain.handle('hosted:register', (_event, input) => store.registerHostedAccount(input));
  ipcMain.handle('hosted:login', (_event, input) => store.loginHostedAccount(input));
  ipcMain.handle('hosted:syncNow', () => store.syncHostedNow());
  ipcMain.handle('hosted:disconnect', () => store.disconnectHostedSync());
  ipcMain.handle('hosted:exportEnv', (_event, values) => store.exportHostedEnvFile(values));
  ipcMain.handle('security:beginReauth', (_event, action) => store.beginReauth(action));
  ipcMain.handle('security:completeReauth', (_event, challengeId, response) =>
    store.completeReauth(challengeId, response)
  );
  ipcMain.handle('security:exportSecureData', (_event, approvalId) =>
    store.exportSecureData(approvalId)
  );
  ipcMain.handle('security:rotateMasterKey', (_event, approvalId) =>
    store.rotateMasterKey(approvalId)
  );
}

module.exports = { registerCalendarHandlers };
