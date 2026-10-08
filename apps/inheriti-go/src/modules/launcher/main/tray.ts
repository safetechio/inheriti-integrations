import { app, Menu, Tray, nativeImage, shell } from 'electron';
import { join } from 'node:path';
import { showLauncher } from './launcher-window.js';
import { trayMessages as messages } from '../../../messages.js';

let tray: Tray | undefined;

export function registerTrayEvents(appUrl?: string): void {
  const icon = nativeImage.createFromPath(join(import.meta.dirname, 'tray.png')).resize({ width: 22, height: 22 });
  tray = new Tray(icon);
  tray.setToolTip(messages.appName);
  tray.on('click', () => showLauncher());
  tray.on('double-click', () => showLauncher());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: messages.openLauncher, click: () => showLauncher() },
    { type: 'separator' },
    { label: messages.createPrivatePlanMenu, click: () => showLauncher(messages.savePrivately) },
    { label: messages.createTeamPlanMenu, click: () => showLauncher(messages.shareWithTeam) },
    { label: messages.editPlanAssetMenu, click: () => showLauncher(messages.addOrEditAsset) },
    { label: messages.openSecureInbox, click: () => showLauncher(messages.openSecureInbox) },
    { type: 'separator' },
    { label: messages.openApp, enabled: Boolean(appUrl), click: () => { if (appUrl) void shell.openExternal(appUrl); } },
    { label: messages.quit, click: () => app.quit() },
  ]));
}
