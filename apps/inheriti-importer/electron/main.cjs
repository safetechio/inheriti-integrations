const { app, BrowserWindow, Menu } = require('electron');

const { loadEnvironment } = require('./lib/environment.cjs');

loadEnvironment({ isPackaged: app.isPackaged, electronDir: __dirname });

const { OperatorRuntime } = require('./lib/operator-runtime.cjs');
const { createWindow } = require('./lib/window.cjs');
const { register: registerVault } = require('./ipc/vault.cjs');
const { register: registerApi } = require('./ipc/api.cjs');
const { register: registerSocket } = require('./ipc/socket.cjs');
const { register: registerAuth } = require('./ipc/auth.cjs');
const { register: registerUpdates } = require('./ipc/updates.cjs');

const deployment = process.env.INHERITI_ENV || 'local';
const environment = deployment === 'prod' ? 'LIVE' : 'TEST';
const issuer = `${(process.env.SAFEID_URL || '').replace(/\/$/, '')}/realms/${process.env.SAFEID_REALM || ''}`;
const runtime = new OperatorRuntime({
  environment,
  apiOrigin: process.env.INHERITI_API_ORIGIN || '',
  issuer,
});
const runtimeReady = app.whenReady().then(() => runtime.initialize());

runtimeReady.then(() => {
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
registerApi(runtimeReady, runtime);
registerSocket(runtimeReady, runtime);
registerAuth(runtimeReady, runtime);
registerUpdates(runtimeReady, runtime);
