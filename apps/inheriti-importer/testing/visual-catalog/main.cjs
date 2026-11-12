const { app, BrowserWindow, Menu, session } = require('electron');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const {
  CATALOG_ORIGIN,
  isCatalogUrl,
  isCatalogRequest,
  catalogContentSecurityPolicy,
} = require('./policy.cjs');
const { version } = require('../../package.json');

if (app.isPackaged || process.env.INHERITI_VISUAL_CATALOG !== '1') {
  console.error(
    'The synthetic visual catalog is available only in an explicit development session.',
  );
  app.exit(1);
} else {
  const profile = mkdtempSync(join(tmpdir(), 'inheriti-visual-catalog-'));
  app.setPath('userData', profile);
  app.on('quit', () => rmSync(profile, { recursive: true, force: true }));

  app
    .whenReady()
    .then(() => {
      Menu.setApplicationMenu(null);
      const isolatedSession = session.fromPartition('inheriti-visual-catalog');
      isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      isolatedSession.on('will-download', (event) => event.preventDefault());
      isolatedSession.webRequest.onBeforeRequest((details, callback) => {
        callback({ cancel: !isCatalogRequest(details.url) && !details.url.startsWith('data:') });
      });
      isolatedSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [catalogContentSecurityPolicy()],
          },
        });
      });

      const win = new BrowserWindow({
        width: 1500,
        height: 980,
        minWidth: 980,
        minHeight: 680,
        title: `Inheriti® Importer visual catalog · synthetic data · v${version}`,
        backgroundColor: '#F8FBFF',
        webPreferences: {
          partition: 'inheriti-visual-catalog',
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          devTools: true,
        },
      });
      win.webContents.on('will-navigate', (event, url) => {
        if (!isCatalogUrl(url)) event.preventDefault();
      });
      win.webContents.on('will-attach-webview', (event) => event.preventDefault());
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.webContents.on('page-title-updated', (event) => event.preventDefault());
      win.webContents.on('render-process-gone', (_event, details) => {
        console.error(`Visual catalog renderer stopped: ${details.reason}`);
        app.exit(1);
      });
      win.loadURL(CATALOG_ORIGIN).catch((error) => {
        console.error(`Could not open the local visual catalog: ${error.message}`);
        app.exit(1);
      });
      win.on('closed', () => app.quit());
    })
    .catch((error) => {
      console.error(error);
      app.exit(1);
    });
}
