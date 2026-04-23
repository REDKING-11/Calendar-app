const { ipcMain } = require('electron');
const { ERROR_CODES, normalizeAppError } = require('../shared/app-errors');

function getFallbackErrorCode(channel) {
  if (channel === 'calendar:createEvent') {
    return ERROR_CODES.calendarCreate;
  }
  if (channel === 'calendar:updateEvent') {
    return ERROR_CODES.calendarUpdate;
  }
  if (channel === 'calendar:deleteEvent') {
    return ERROR_CODES.calendarDelete;
  }
  if (
    channel === 'calendar:importData' ||
    channel === 'calendar:importDataFromFilePicker' ||
    channel === 'calendar:exportData'
  ) {
    return ERROR_CODES.calendarImportExport;
  }
  if (
    channel === 'calendar:listExternalCalendars' ||
    channel === 'calendar:importExternalCalendar' ||
    channel === 'calendar:refreshExternalSource'
  ) {
    return ERROR_CODES.externalCalendar;
  }
  if (channel.startsWith('security:')) {
    return channel.includes('OAuth') || channel.includes('Account')
      ? ERROR_CODES.auth
      : ERROR_CODES.security;
  }
  if (channel.startsWith('hosted:')) {
    return ERROR_CODES.hosted;
  }
  return ERROR_CODES.unexpected;
}

function wrapIpcHandler(channel, handler) {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      throw normalizeAppError(error, getFallbackErrorCode(channel));
    }
  };
}

function handle(channel, handler) {
  ipcMain.handle(channel, wrapIpcHandler(channel, handler));
}

function registerCalendarHandlers(store) {
  for (const channel of [
    'calendar:getSnapshot',
    'calendar:createEvent',
    'calendar:updateEvent',
    'calendar:deleteEvent',
    'calendar:listExternalCalendars',
    'calendar:importExternalCalendar',
    'calendar:refreshExternalSource',
    'calendar:importData',
    'calendar:importDataFromFilePicker',
    'calendar:exportData',
    'calendar:renameTag',
    'calendar:deleteTag',
    'calendar:getHolidayCountries',
    'calendar:preloadHolidays',
    'calendar:importHolidays',
    'security:getSnapshot',
    'security:getProviders',
    'security:getOAuthClientConfig',
    'security:updateOAuthClientConfig',
    'security:listAccounts',
    'security:startOAuthConnect',
    'security:finishOAuthConnect',
    'security:disconnectAccount',
    'security:revokeAccount',
    'security:listTrustedDevices',
    'security:createPairingApproval',
    'security:approvePairing',
    'security:revokeTrustedDevice',
    'transport:createLocalSession',
    'transport:consumeLocalSession',
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

  handle('calendar:getSnapshot', () => store.snapshot());
  handle('calendar:createEvent', (_event, input) => store.createEvent(input));
  handle('calendar:updateEvent', (_event, input) => store.updateEvent(input));
  handle('calendar:deleteEvent', (_event, eventId) => store.deleteEvent(eventId));
  handle('calendar:listExternalCalendars', (_event, input) =>
    store.listExternalCalendars(input || {})
  );
  handle('calendar:importExternalCalendar', (_event, input) =>
    store.importExternalCalendar(input || {})
  );
  handle('calendar:refreshExternalSource', (_event, input) =>
    store.refreshExternalSource(input || {})
  );
  handle('calendar:importData', (_event, input) => store.importData(input || {}));
  handle('calendar:importDataFromFilePicker', () => store.importDataFromFilePicker());
  handle('calendar:exportData', (_event, input) => store.exportData(input || {}));
  handle('calendar:renameTag', (_event, input) =>
    store.renameTagSystemWide(input?.tagId, input?.label)
  );
  handle('calendar:deleteTag', (_event, tagId) => store.deleteTagSystemWide(tagId));
  handle('calendar:getHolidayCountries', () => store.getHolidayCountries());
  handle('calendar:preloadHolidays', (_event, input) => store.preloadHolidays(input));
  handle('calendar:importHolidays', (_event, input) => store.importHolidays(input));
  handle('security:getSnapshot', () => store.getSecuritySnapshot());
  handle('security:getProviders', () => store.getAvailableProviders());
  handle('security:getOAuthClientConfig', () => store.getOAuthClientConfig());
  handle('security:updateOAuthClientConfig', (_event, input) =>
    store.updateOAuthClientConfig(input || {})
  );
  handle('security:listAccounts', () => store.listConnectedAccounts());
  handle('security:startOAuthConnect', (_event, provider, accessLevel) =>
    store.startOAuthConnect(provider, accessLevel)
  );
  handle('security:finishOAuthConnect', (_event, input) =>
    store.finishOAuthConnect(input)
  );
  handle('security:disconnectAccount', (_event, accountId) =>
    store.disconnectAccount(accountId)
  );
  handle('security:revokeAccount', (_event, accountId) =>
    store.revokeAccount(accountId)
  );
  handle('security:listTrustedDevices', () => store.listTrustedDevices());
  handle('security:createPairingApproval', (_event, label) =>
    store.createPairingApproval(label)
  );
  handle('security:approvePairing', (_event, input) => store.approvePairing(input));
  handle('security:revokeTrustedDevice', (_event, deviceId) =>
    store.revokeTrustedDevice(deviceId)
  );
  handle('transport:createLocalSession', (_event, input) =>
    store.createLocalSession(input || {})
  );
  handle('transport:consumeLocalSession', (_event, input) =>
    store.consumeLocalSession(input || {})
  );
  handle('hosted:getState', () => store.getHostedSyncState());
  handle('hosted:testConnection', (_event, baseUrl) => store.testHostedBackend(baseUrl));
  handle('hosted:register', (_event, input) => store.registerHostedAccount(input));
  handle('hosted:login', (_event, input) => store.loginHostedAccount(input));
  handle('hosted:syncNow', () => store.syncHostedNow());
  handle('hosted:disconnect', () => store.disconnectHostedSync());
  handle('hosted:exportEnv', (_event, values) => store.exportHostedEnvFile(values));
  handle('security:beginReauth', (_event, action) => store.beginReauth(action));
  handle('security:completeReauth', (_event, challengeId, response) =>
    store.completeReauth(challengeId, response)
  );
  handle('security:exportSecureData', (_event, approvalId) =>
    store.exportSecureData(approvalId)
  );
  handle('security:rotateMasterKey', (_event, approvalId) =>
    store.rotateMasterKey(approvalId)
  );
}

module.exports = {
  getFallbackErrorCode,
  registerCalendarHandlers,
  wrapIpcHandler,
};
