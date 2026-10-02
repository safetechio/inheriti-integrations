import { app, globalShortcut, Notification, powerMonitor } from 'electron';
import { currentWindow, prepareToQuit, showLauncher } from './launcher-window.js';
import type { TraySession } from './state.js';
import type { TrayInboxSignal } from '../../inbox/main/inbox.js';
import { trayMessages as messages } from '../../../messages.js';
import { registerTrayEvents } from './tray.js';
import { registerTrayIpc } from './ipc.js';
import { watchLinuxLock } from './linux-lock.js';

export function registerAppEvents(session: TraySession, appUrl: string | undefined, deployment: string): void {
  let stopLinuxLock: (() => void) | undefined;
  const seenInboxMessages = new Set<string>();
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => showLauncher());
  app.on('browser-window-created', (_event, window) => window.on('hide', () => {
    session.clearRevealed();
    void session.cancelPlanEdit().catch(() => {});
  }));
  app.whenReady().then(async () => {
    app.setAppUserModelId(`com.safetech.inheriti.tray.${deployment}`);
    session.setPublisher(() => publish(session));
    session.setInboxPublisher((signal) => {
      publishInboxChanged(signal);
      void notifyNewInboxMessage(session, signal, seenInboxMessages);
    });
    session.setInboxStatePublisher(() => publishInbox(session));
    registerTrayEvents(appUrl);
    registerTrayIpc(session, currentWindow, () => publish(session), appUrl, notify, () => publishInbox(session));
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

function publishInbox(session: TraySession): void {
  const window = currentWindow();
  if (window && !window.isDestroyed()) window.webContents.send('tray:inbox-state-changed', session.inboxState());
}

function publishInboxChanged(signal?: TrayInboxSignal): void {
  const window = currentWindow();
  if (window && !window.isDestroyed()) window.webContents.send('tray:inbox-changed', signal ?? null);
}

async function notifyNewInboxMessage(session: TraySession, signal: TrayInboxSignal | undefined, seen: Set<string>): Promise<void> {
  if (!signal || !('messageId' in signal) || signal.status !== 'AVAILABLE' || signal.recipientStatus) return;
  const organizationId = session.state().selectedId;
  if (!organizationId) return;
  const key = `${organizationId}:${signal.messageId}`;
  if (seen.has(key)) return;
  seen.add(key);
  try {
    const memberId = await session.registeredInboxMemberId();
    if (!memberId || session.state().selectedId !== organizationId) { seen.delete(key); return; }
    if (signal.senderMemberId === memberId) return;
    const page = await session.listInboxMessages(signal.conversationId, { status: 'AVAILABLE' });
    if (session.state().selectedId !== organizationId) return;
    const message = page.items.find((item: { id: string; senderMemberId: string; recipientStatus?: string }) => item.id === signal.messageId);
    if (!message || message.senderMemberId === memberId || message.recipientStatus !== 'UNREAD') return;
    publishInboxChanged({ kind: 'NEW_MESSAGE' });
    const window = currentWindow();
    if (!window || window.isDestroyed() || !window.isVisible()) notify('A protected message is ready in Secure Inbox.');
  } catch {
    seen.delete(key);
  }
}
