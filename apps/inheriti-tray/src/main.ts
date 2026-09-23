import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell, globalShortcut } from 'electron';
import { join } from 'node:path';
import { TraySession } from './state.js';
import type { Deployment } from './state.js';
import { BUSINESS_DEPLOYMENTS } from '@safetech/inheriti-elements-core/node';

const deployment = process.env.INHERITI_BUSINESS_DEPLOYMENT ?? 'dev';
if (!Object.hasOwn(BUSINESS_DEPLOYMENTS, deployment)) throw new Error('Invalid Business deployment');
const session = new TraySession(deployment as Deployment);
const businessUrls: Record<Deployment, string | undefined> = {
  dev: 'https://business-dev.inheriti.com',
  stg: 'https://business-stg.inheriti.com',
  prod: 'https://business.inheriti.com',
  local: undefined,
};
const businessUrl = process.env.INHERITI_BUSINESS_URL ?? businessUrls[deployment as Deployment];
if (businessUrl && !/^https:\/\//u.test(businessUrl) && !/^http:\/\/localhost(?::\d+)?$/u.test(businessUrl)) throw new Error('Invalid Business URL');
let window: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => showLauncher());
  app.whenReady().then(async () => {
    app.setAppUserModelId('com.safetech.inheriti.tray');
    const icon = nativeImage.createFromPath(join(import.meta.dirname, 'tray.png')).resize({ width: 22, height: 22 });
    tray = new Tray(icon);
    tray.setToolTip('Inheriti');
    tray.on('click', () => showLauncher());
    tray.on('double-click', () => showLauncher());
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open launcher', click: () => showLauncher() },
      { type: 'separator' },
      { label: 'Save privately', click: () => showLauncher('Save privately') },
      { label: 'Share with a team', click: () => showLauncher('Share with a team') },
      { label: 'Add or edit an asset', click: () => showLauncher('Add or edit an asset') },
      { type: 'separator' },
      { label: 'Open Business', enabled: Boolean(businessUrl), click: () => { if (businessUrl) void shell.openExternal(businessUrl); } },
      { label: 'Settings', click: () => showLauncher('Settings') },
      { label: 'Quit', click: () => app.quit() },
    ]));
    const trusted = (event: Electron.IpcMainInvokeEvent) => {
      if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted renderer');
    };
    ipcMain.handle('tray:state', (event) => { trusted(event); return session.state(); });
    ipcMain.handle('tray:sign-in', (event) => { trusted(event); void session.signIn(publish, (url) => shell.openExternal(url)); return session.state(); });
    ipcMain.handle('tray:select', async (event, id: unknown) => {
      trusted(event);
      if (typeof id !== 'string') throw new Error('Invalid organization');
      await session.select(id);
      publish();
      return session.state();
    });
    ipcMain.handle('tray:sign-out', async (event) => { trusted(event); await session.signOut(); publish(); return session.state(); });
    ipcMain.handle('tray:open-business', (event) => {
      trusted(event);
      if (!businessUrl) throw new Error('Business URL is not configured');
      return shell.openExternal(businessUrl);
    });
    const shortcut = process.env.INHERITI_TRAY_SHORTCUT ?? 'CommandOrControl+Alt+Shift+I';
    try {
      if (!globalShortcut.register(shortcut, () => showLauncher())) console.warn(`Shortcut unavailable: ${shortcut}`);
    } catch {
      console.warn(`Shortcut unavailable: ${shortcut}`);
    }
    await session.restore();
    showLauncher();
  });
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => { quitting = true; globalShortcut.unregisterAll(); });
}

function showLauncher(action?: string): void {
  if (!app.isReady()) return;
  if (!window || window.isDestroyed()) {
    window = new BrowserWindow({
      width: 380,
      height: 520,
      show: false,
      resizable: false,
      webPreferences: {
        preload: join(import.meta.dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.setMenu(null);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('did-finish-load', () => { if (action) window?.webContents.send('tray:action', action); });
    void window.loadFile(join(import.meta.dirname, 'launcher.html'));
    window.on('close', (event) => { if (quitting) return; event.preventDefault(); window?.hide(); });
  }
  window.show();
  window.focus();
  if (action) window.webContents.send('tray:action', action);
}

function publish(): void {
  if (window && !window.isDestroyed()) window.webContents.send('tray:state-changed', session.state());
}
