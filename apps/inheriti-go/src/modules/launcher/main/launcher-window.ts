import { app, BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { registerWindowEvents } from './window.js';

let window: BrowserWindow | undefined;
let quitting = false;
declare const __INHERITI_DEPLOYMENT__: string | undefined;
const deployment = typeof __INHERITI_DEPLOYMENT__ === 'undefined' ? 'dev' : __INHERITI_DEPLOYMENT__;

export function currentWindow(): BrowserWindow | undefined {
  return window;
}

export function prepareToQuit(): void {
  quitting = true;
}

export function showLauncher(action?: string): void {
  if (!app.isReady()) return;
  if (!window || window.isDestroyed()) {
    const linuxWindow = process.platform === 'linux';
    window = new BrowserWindow({
      width: linuxWindow ? 448 : 404,
      height: linuxWindow ? 756 : 676,
      useContentSize: !linuxWindow,
      show: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      title: deployment === 'prod' ? app.getName() : `${app.getName()} · ${deployment.toUpperCase()}`,
      icon: join(import.meta.dirname, deployment === 'prod' ? 'tray.png' : `tray-${deployment}.png`),
      webPreferences: {
        preload: join(import.meta.dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.setMenu(null);
    registerWindowEvents(window, action, () => quitting);
    void window.loadFile(join(import.meta.dirname, 'launcher.html'));
    const { x, y, width } = screen.getPrimaryDisplay().workArea;
    window.setPosition(x + width - window.getBounds().width, y);
  }
  window.show();
  window.focus();
  if (action) window.webContents.send('tray:action', action);
}
