const { app, BrowserWindow, Menu } = require('electron');

const { loadEnvironment } = require('./lib/environment.cjs');

// Populates `process.env` before any other module below captures an
// env-derived constant (API_ORIGIN, SAFEID_*) at its own module-load time.
loadEnvironment({ isPackaged: app.isPackaged, electronDir: __dirname });

const { initializeSessions } = require('./lib/api-session.cjs');
const { createWindow } = require('./lib/window.cjs');
const { register: registerVault } = require('./ipc/vault.cjs');
const { register: registerApi } = require('./ipc/api.cjs');
const { register: registerSocket } = require('./ipc/socket.cjs');
const { register: registerAuth } = require('./ipc/auth.cjs');
const { register: registerUpdates } = require('./ipc/updates.cjs');

const sessionsReady = app.whenReady().then(initializeSessions);

sessionsReady.then(() => {
  if (app.isPackaged) Menu.setApplicationMenu(null);
  createWindow(__dirname);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(__dirname);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

registerVault();
registerApi(sessionsReady);
registerSocket(sessionsReady);
registerAuth(sessionsReady);
registerUpdates();
