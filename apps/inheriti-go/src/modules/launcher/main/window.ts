import type { BrowserWindow } from 'electron';
import type { TrayAction } from './launcher-window.js';

export function registerWindowEvents(window: BrowserWindow, action: TrayAction | undefined, isQuitting: () => boolean): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('did-finish-load', () => {
    if (action) window.webContents.send('tray:action', action);
  });
  window.on('close', (event) => {
    if (isQuitting()) return;
    event.preventDefault();
    window.webContents.send('tray:hidden');
    window.hide();
  });
}
