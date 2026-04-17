const path = require('path');
const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require('electron');
const { CalendarStore } = require('./data/calendar-store');
const { registerCalendarHandlers } = require('./ipc/calendar-ipc');

let mainWindow = null;
let settingsWindow = null;

function withWindowMode(url, mode) {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}window=${mode}`;
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

  window.loadURL(withWindowMode(MAIN_WINDOW_WEBPACK_ENTRY, mode));

  if (!app.isPackaged) {
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
  createWindow();

  ipcMain.removeHandler('app:openSettingsWindow');
  ipcMain.removeHandler('app:closeCurrentWindow');

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
