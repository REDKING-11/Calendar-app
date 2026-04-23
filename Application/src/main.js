const path = require('path');
const { app, BrowserWindow, Notification, dialog, ipcMain, safeStorage, shell } = require('electron');
const { CalendarStore } = require('./data/calendar-store');
const { registerCalendarHandlers } = require('./ipc/calendar-ipc');
const { ReminderService } = require('./reminder-service');

let mainWindow = null;
let settingsWindow = null;
let reminderService = null;
let memoryDiagnosticsInterval = null;

const ALLOWED_EXTERNAL_LINK_HOSTS = new Set([
  'azure.microsoft.com',
  'portal.azure.com',
  'entra.microsoft.com',
  'learn.microsoft.com',
  'console.cloud.google.com',
  'cloud.google.com',
  'support.google.com',
]);

function withWindowMode(url, mode) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}window=${mode}`;
}

function sanitizeExternalLink(url) {
  const parsed = new URL(String(url || '').trim());
  if (parsed.protocol !== 'https:' || !ALLOWED_EXTERNAL_LINK_HOSTS.has(parsed.hostname)) {
    throw new Error('External link is not allowed.');
  }

  return parsed.toString();
}

function isAppRendererUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    const rendererEntry = new URL(MAIN_WINDOW_WEBPACK_ENTRY);

    if (rendererEntry.protocol === 'file:') {
      return parsed.protocol === 'file:' && parsed.pathname === rendererEntry.pathname;
    }

    return parsed.origin === rendererEntry.origin && parsed.pathname === rendererEntry.pathname;
  } catch {
    return false;
  }
}

function maybeOpenAllowedExternalLink(url) {
  try {
    const safeUrl = sanitizeExternalLink(url);
    void shell.openExternal(safeUrl);
    return true;
  } catch {
    return false;
  }
}

function installNavigationGuards(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppRendererUrl(url)) {
      return { action: 'allow' };
    }

    if (maybeOpenAllowedExternalLink(url)) {
      return { action: 'deny' };
    }

    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (isAppRendererUrl(url)) {
      return;
    }

    event.preventDefault();
    maybeOpenAllowedExternalLink(url);
  });
}

function startMemoryDiagnostics() {
  if (app.isPackaged || process.env.CALENDAR_MEMORY_LOG !== '1' || memoryDiagnosticsInterval) {
    return;
  }

  const logMemory = async () => {
    const mainMemory = process.memoryUsage();
    const rendererMemory = await Promise.all(
      BrowserWindow.getAllWindows().map(async (window) => {
        try {
          const metrics = await window.webContents.executeJavaScript(
            `JSON.stringify({
              usedJSHeapSize: performance?.memory?.usedJSHeapSize || 0,
              totalJSHeapSize: performance?.memory?.totalJSHeapSize || 0,
              jsHeapSizeLimit: performance?.memory?.jsHeapSizeLimit || 0
            })`,
            true
          );
          return {
            title: window.getTitle(),
            destroyed: window.isDestroyed(),
            memory: JSON.parse(metrics),
          };
        } catch {
          return {
            title: window.getTitle(),
            destroyed: window.isDestroyed(),
            memory: null,
          };
        }
      })
    );

    console.info('[calendar-memory]', {
      main: {
        rss: mainMemory.rss,
        heapUsed: mainMemory.heapUsed,
        heapTotal: mainMemory.heapTotal,
        external: mainMemory.external,
      },
      renderers: rendererMemory,
    });
  };

  memoryDiagnosticsInterval = setInterval(() => {
    void logMemory();
  }, 2 * 60 * 1000);
  void logMemory();
}

const createWindow = (mode = 'main') => {
  const preloadPath = path.join(
    __dirname,
    '..',
    'renderer',
    'main_window',
    'preload.js'
  );

  const windowOptions =
    mode === 'settings'
      ? {
          width: 980,
          height: 900,
          minWidth: 860,
          minHeight: 720,
          title: 'Calendar Settings',
          backgroundColor: '#e8f3ff',
        }
      : {
          width: 1280,
          height: 780,
          minWidth: 1278,
          minHeight: 638,
          title: 'Calendar App',
          backgroundColor: '#e8f3ff',
        };

  const window = new BrowserWindow({
    ...windowOptions,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  installNavigationGuards(window);
  window.loadURL(withWindowMode(MAIN_WINDOW_WEBPACK_ENTRY, mode));

  if (!app.isPackaged && process.env.CALENDAR_OPEN_DEVTOOLS === '1') {
    window.webContents.openDevTools({ mode: 'detach' });
  }

  if (mode === 'settings') {
    settingsWindow = window;
    settingsWindow.on('closed', () => {
      settingsWindow = null;
    });
  } else {
    mainWindow = window;
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  }

  return window;
};

app.whenReady().then(() => {
  const store = new CalendarStore(app.getPath('userData'), {
    dialog,
    safeStorage,
    shell,
  });
  registerCalendarHandlers(store);
  reminderService = new ReminderService({
    store,
    oauthService: store.oauthService,
    NotificationClass: Notification,
  });
  reminderService.start();
  createWindow();
  startMemoryDiagnostics();

  ipcMain.removeHandler('app:openSettingsWindow');
  ipcMain.removeHandler('app:closeCurrentWindow');
  ipcMain.removeHandler('app:openExternalLink');

  ipcMain.handle('app:openSettingsWindow', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.show();
      settingsWindow.focus();
      return { opened: true, reused: true };
    }

    createWindow('settings');
    return { opened: true, reused: false };
  });

  ipcMain.handle('app:closeCurrentWindow', (event) => {
    const currentWindow = BrowserWindow.fromWebContents(event.sender);
    currentWindow?.close();
    return { closed: true };
  });

  ipcMain.handle('app:openExternalLink', async (_event, url) => {
    const safeUrl = sanitizeExternalLink(url);
    await shell.openExternal(safeUrl);
    return { opened: true, url: safeUrl };
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  reminderService?.stop?.();
  if (memoryDiagnosticsInterval) {
    clearInterval(memoryDiagnosticsInterval);
    memoryDiagnosticsInterval = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  reminderService?.stop?.();
  if (memoryDiagnosticsInterval) {
    clearInterval(memoryDiagnosticsInterval);
    memoryDiagnosticsInterval = null;
  }
});
