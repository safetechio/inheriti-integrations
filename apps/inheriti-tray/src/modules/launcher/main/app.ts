import { app, globalShortcut, Notification, powerMonitor } from 'electron';
import { currentWindow, prepareToQuit, showLauncher } from './launcher-window.js';
import type { TraySession } from './state.js';
import { trayMessages as messages } from '../../../messages.js';
import { registerTrayEvents } from './tray.js';
import { registerTrayIpc } from './ipc.js';
import { watchLinuxLock } from './linux-lock.js';

export function registerAppEvents(session: TraySession, appUrl: string | undefined, deployment: string): void {
  let stopLinuxLock: (() => void) | undefined;
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => showLauncher());
  app.on('browser-window-created', (_event, window) => window.on('hide', () => session.clearRevealed()));
  app.whenReady().then(async () => {
    app.setAppUserModelId(`com.safetech.inheriti.tray.${deployment}`);
    registerTrayEvents(appUrl);
    registerTrayIpc(session, currentWindow, () => publish(session), appUrl, notify);
    powerMonitor.on('lock-screen', () => hideForLock(session));
    powerMonitor.on('suspend', () => hideForLock(session));
    if (process.platform === 'linux') stopLinuxLock = watchLinuxLock(() => hideForLock(session));
    registerShortcut();
    await session.restore();
    showLauncher();
  });
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    stopLinuxLock?.();
    session.clearRevealed();
    prepareToQuit();
    globalShortcut.unregisterAll();
  });
}

function hideForLock(session: TraySession): void {
  session.clearOnLock();
  const window = currentWindow();
  if (!window || window.isDestroyed()) return;
  window.hide();
  window.webContents.reload();
}

function notify(body: string): void {
  if (Notification.isSupported()) new Notification({ title: messages.appName, body }).show();
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
