import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { registerWindowEvents } from './window.js';

let window: BrowserWindow | undefined;
let quitting = false;

export function currentWindow(): BrowserWindow | undefined {
  return window;
}

export function prepareToQuit(): void {
  quitting = true;
}

export function showLauncher(action?: string): void {
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
    registerWindowEvents(window, action, () => quitting);
    void window.loadFile(join(import.meta.dirname, 'launcher.html'));
  }
  window.show();
  window.focus();
  if (action) window.webContents.send('tray:action', action);
}
