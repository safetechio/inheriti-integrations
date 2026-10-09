import { app, Menu, Tray, nativeImage, shell } from 'electron';
import { join } from 'node:path';
import { showLauncher } from './launcher-window.js';
import { trayMessages as messages } from '../../../messages.js';

let tray: Tray | undefined;
let normalIcon: Electron.NativeImage | undefined;
let unreadIcon: Electron.NativeImage | undefined;

export function setTrayUnread(unread: boolean): void {
  if (tray) tray.setImage(unread ? unreadIcon! : normalIcon!);
}

export function registerTrayEvents(appUrl?: string, deployment = 'prod', onCheckUpdates?: () => void): void {
  normalIcon = nativeImage.createFromPath(join(import.meta.dirname, deployment === 'prod' ? 'tray.png' : `tray-${deployment}.png`)).resize({ width: 22, height: 22 });
  const pixels = Buffer.from(normalIcon.toBitmap());
  for (let y = 0; y < 9; y++) for (let x = 13; x < 22; x++) {
    const distance = (x - 17) ** 2 + (y - 4) ** 2;
    if (distance > 20) continue;
    const offset = (y * 22 + x) * 4;
    pixels.set(distance > 10 ? [255, 255, 255, 255] : [54, 48, 230, 255], offset);
  }
  unreadIcon = nativeImage.createFromBitmap(pixels, { width: 22, height: 22 });
  tray = new Tray(normalIcon);
  tray.setToolTip(messages.appName);
  tray.on('click', () => showLauncher());
  tray.on('double-click', () => showLauncher());
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `${messages.appName} ${deployment.toUpperCase()} · v${app.getVersion()}`, enabled: false },
    { type: 'separator' },
    { label: messages.openLauncher, click: () => showLauncher() },
    { type: 'separator' },
    { label: messages.createPrivatePlanMenu, click: () => showLauncher(messages.savePrivately) },
    { label: messages.createTeamPlanMenu, click: () => showLauncher(messages.shareWithTeam) },
    { label: messages.editPlanAssetMenu, click: () => showLauncher(messages.addOrEditAsset) },
    { label: messages.openSecureInbox, click: () => showLauncher(messages.openSecureInbox) },
    { type: 'separator' },
    { label: messages.openApp, enabled: Boolean(appUrl), click: () => { if (appUrl) void shell.openExternal(appUrl); } },
    { label: 'Check for updates', enabled: Boolean(onCheckUpdates), click: () => onCheckUpdates?.() },
    { label: messages.quit, click: () => app.quit() },
  ]));
}
