const path = require('path');
const { app, BrowserWindow, safeStorage, shell } = require('electron');
const { CalendarStore } = require('./data/calendar-store');
const { registerCalendarHandlers } = require('./ipc/calendar-ipc');

const createWindow = () => {
  const preloadPath = path.join(
    __dirname,
    '..',
    'renderer',
    'main_window',
    'preload.js'
  );

  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 780,
    minWidth: 1278,
    minHeight: 638,
    backgroundColor: '#f4efe7',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
};

app.whenReady().then(() => {
  const store = new CalendarStore(app.getPath('userData'), {
    safeStorage,
    shell,
  });
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
