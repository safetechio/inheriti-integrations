import { app, Menu, Tray, nativeImage, shell } from 'electron';
import { join } from 'node:path';
import { showLauncher } from './launcher-window.js';
import { trayMessages as messages } from '../../../messages.js';

let tray: Tray | undefined;

export function registerTrayEvents(appUrl?: string): void {
  const icon = nativeImage.createFromPath(join(import.meta.dirname, '../../../tray.png')).resize({ width: 22, height: 22 });
  tray = new Tray(icon);
  tray.setToolTip(messages.appName);
  tray.on('click', () => showLauncher());
  tray.on('double-click', () => showLauncher());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: messages.openLauncher, click: () => showLauncher() },
    { type: 'separator' },
    { label: messages.savePrivately, click: () => showLauncher(messages.savePrivately) },
    { label: messages.shareWithTeam, click: () => showLauncher(messages.shareWithTeam) },
    { label: messages.addOrEditAsset, click: () => showLauncher(messages.addOrEditAsset) },
    { type: 'separator' },
    { label: messages.openApp, enabled: Boolean(appUrl), click: () => { if (appUrl) void shell.openExternal(appUrl); } },
    { label: messages.settings, click: () => showLauncher(messages.settings) },
    { label: messages.quit, click: () => app.quit() },
  ]));
}
