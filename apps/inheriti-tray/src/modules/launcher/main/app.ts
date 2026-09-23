import { app, globalShortcut } from 'electron';
import { currentWindow, prepareToQuit, showLauncher } from './launcher-window.js';
import type { TraySession } from './state.js';
import { trayMessages as messages } from '../../../messages.js';
import { registerTrayEvents } from './tray.js';
import { registerTrayIpc } from './ipc.js';

export function registerAppEvents(session: TraySession, appUrl?: string): void {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => showLauncher());
  app.whenReady().then(async () => {
    app.setAppUserModelId('com.safetech.inheriti.tray');
    registerTrayEvents(appUrl);
    registerTrayIpc(session, currentWindow, () => publish(session), appUrl);
    registerShortcut();
    await session.restore();
    showLauncher();
  });
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    prepareToQuit();
    globalShortcut.unregisterAll();
  });
}

function registerShortcut(): void {
  const shortcut = process.env.INHERITI_TRAY_SHORTCUT ?? 'CommandOrControl+Alt+Shift+I';
  try {
    if (!globalShortcut.register(shortcut, () => showLauncher())) console.warn(messages.shortcutUnavailable(shortcut));
  } catch {
    console.warn(messages.shortcutUnavailable(shortcut));
  }
}

function publish(session: TraySession): void {
  const window = currentWindow();
  if (window && !window.isDestroyed()) window.webContents.send('tray:state-changed', session.state());
}
