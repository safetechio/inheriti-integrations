import type { BrowserWindow } from 'electron';

export function registerWindowEvents(window: BrowserWindow, action: string | undefined, isQuitting: () => boolean): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('did-finish-load', () => {
    if (action) window.webContents.send('tray:action', action);
  });
  window.on('close', (event) => {
    if (isQuitting()) return;
    event.preventDefault();
    window.hide();
  });
}
