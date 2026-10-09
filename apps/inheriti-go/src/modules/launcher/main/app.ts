import { app, dialog, globalShortcut, Notification, powerMonitor } from 'electron';
import { basename, join } from 'node:path';
import { currentWindow, prepareToQuit, showLauncher } from './launcher-window.js';
import type { TraySession } from './state.js';
import type { TrayInboxSignal } from '../../inbox/main/inbox.js';
import { trayMessages as messages } from '../../../messages.js';
import { registerTrayEvents, setTrayUnread } from './tray.js';
import { registerTrayIpc } from './ipc.js';
import { watchLinuxLock } from './linux-lock.js';
import { downloadGoUpdate } from './update.js';
import { ensureStartAtLogin, isBackgroundLaunch } from './start-at-login.js';

export function registerAppEvents(session: TraySession, appUrl: string | undefined, deployment: string): void {
  let stopLinuxLock: (() => void) | undefined;
  const seenInboxMessages = new Set<string>();
  const notices = new Set<Notification>();
  const unreadNotices = new Map<string, Notification>();
  const notify = (body: string, target?: { organizationId: string; conversationId: string }, untilRead = false): void => {
    if (!Notification.isSupported()) return;
    const key = untilRead && target ? `${target.organizationId}:${target.conversationId}` : undefined;
    if (key) unreadNotices.get(key)?.close();
    const notice = new Notification({ title: messages.appName, body, timeoutType: untilRead ? 'never' : 'default' });
    notices.add(notice);
    if (key) unreadNotices.set(key, notice);
    notice.on('close', () => {
      notices.delete(notice);
      if (key && unreadNotices.get(key) === notice) unreadNotices.delete(key);
    });
    notice.on('click', () => {
      notice.close();
      showLauncher(target ? { kind: 'OPEN_INBOX', ...target } : undefined);
    });
    notice.show();
    if (!untilRead) {
      const timer = setTimeout(() => notice.close(), 8_000);
      timer.unref();
      notice.on('close', () => clearTimeout(timer));
    }
  };
  let badgeOrganization: string | undefined;
  let badgeRequest = 0;
  const refreshBadge = async () => {
    const organization = session.state().selectedId;
    const request = ++badgeRequest;
    if (organization !== badgeOrganization) {
      badgeOrganization = organization;
      setTrayUnread(false);
    }
    if (!organization) return;
    try {
      let offset = 0;
      let unread = false;
      const unresolved = new Set([...unreadNotices.keys()].filter((key) => key.startsWith(`${organization}:`)));
      const dismiss: string[] = [];
      do {
        const page = await session.listInboxConversations({ limit: 100, offset });
        for (const item of page.items as { id?: string; unreadCount: number }[]) {
          if (item.unreadCount > 0) unread = true;
          const key = `${organization}:${item.id}`;
          if (unresolved.delete(key) && item.unreadCount === 0) dismiss.push(key);
        }
        offset += page.items.length;
        if ((unread && !unresolved.size) || !page.items.length || offset >= page.total) break;
      } while (true);
      if (request === badgeRequest && session.state().selectedId === organization) {
        setTrayUnread(unread);
        for (const key of dismiss.concat([...unresolved])) unreadNotices.get(key)?.close();
      }
    } catch { /* Keep the last confirmed unread state until the next refresh. */ }
  };
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', (_event, argv: string[]) => { if (!isBackgroundLaunch(argv)) showLauncher(); });
  app.on('browser-window-created', (_event, window) => window.on('hide', () => {
    session.clearRevealed();
    void session.cancelPlanEdit().catch(() => {});
  }));
  app.whenReady().then(async () => {
    app.setAppUserModelId(`com.safetech.inheriti.go.${deployment}`);
    try { ensureStartAtLogin(deployment); }
    catch { console.warn('Could not enable Inheriti Go launch at login.'); }
    const publishState = () => {
      if (session.state().status === 'signed-out') for (const notice of notices) notice.close();
      publish(session);
      void refreshBadge();
    };
    session.setPublisher(publishState);
    session.setInboxPublisher((signal) => {
      publishInboxChanged(signal);
      if (signal && 'kind' in signal && signal.kind === 'PRESENCE') return;
      void notifyInboxEvent(session, signal, seenInboxMessages, notify).finally(() => { void refreshBadge(); });
    });
    session.setInboxStatePublisher(() => publishInbox(session));
    registerTrayEvents(appUrl, deployment, () => { void checkForUpdates(session); });
    registerTrayIpc(session, currentWindow, publishState, appUrl, notify,
      () => publishInbox(session), () => { void refreshBadge(); });
    powerMonitor.on('lock-screen', () => hideForLock(session));
    powerMonitor.on('suspend', () => hideForLock(session));
    if (process.platform === 'linux') stopLinuxLock = watchLinuxLock(() => hideForLock(session));
    registerShortcut();
    if (!isBackgroundLaunch()) showLauncher();
    await session.restore();
    publish(session);
    void refreshBadge();
  });
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    stopLinuxLock?.();
    for (const notice of notices) notice.close();
    session.clearRevealed();
    prepareToQuit();
    globalShortcut.unregisterAll();
  });
}

async function checkForUpdates(session: TraySession): Promise<void> {
  if (session.state().status !== 'signed-in') {
    await dialog.showMessageBox({ type: 'info', title: 'Inheriti Go updates', message: 'Sign in to check for updates.' });
    return;
  }
  try {
    const build = await session.availableUpdate(app.getVersion());
    if (!build) {
      await dialog.showMessageBox({ type: 'info', title: 'Inheriti Go updates', message: `Version ${app.getVersion()} is up to date.` });
      return;
    }
    const extension = ({ linux: '.AppImage', darwin: '.dmg', win32: '.exe' } as Record<string, string>)[process.platform];
    if (!extension || basename(build.fileName) !== build.fileName || !build.fileName.endsWith(extension)) throw new Error('Invalid update artifact.');
    const answer = await dialog.showMessageBox({ type: 'info', title: 'Inheriti Go update',
      message: `Version ${build.version} is available.`, detail: 'Download the installer now?', buttons: ['Download', 'Later'], defaultId: 0, cancelId: 1 });
    if (answer.response !== 0) return;
    const selected = await dialog.showSaveDialog({ title: 'Download Inheriti Go', defaultPath: join(app.getPath('downloads'), build.fileName), buttonLabel: 'Download' });
    if (selected.canceled || !selected.filePath) return;
    const { url } = await session.requestUpdateDownload(build.id);
    await downloadGoUpdate(build, url, selected.filePath);
    await dialog.showMessageBox({ type: 'info', title: 'Inheriti Go update', message: `Version ${build.version} downloaded.`, detail: selected.filePath });
  } catch {
    await dialog.showMessageBox({ type: 'error', title: 'Inheriti Go updates', message: 'The update could not be checked or downloaded. Please try again.' });
  }
}

function hideForLock(session: TraySession): void {
  session.clearOnLock();
  const window = currentWindow();
  if (!window || window.isDestroyed()) return;
  window.hide();
  window.webContents.reload();
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

async function notifyInboxEvent(session: TraySession, signal: TrayInboxSignal | undefined, seen: Set<string>,
  notify: (body: string, target?: { organizationId: string; conversationId: string }, untilRead?: boolean) => void): Promise<void> {
  if (!signal) return;
  const organizationId = session.state().selectedId;
  if (!organizationId) return;
  if ('kind' in signal) {
    if (signal.kind !== 'CONVERSATIONS' || !signal.conversationId || !signal.action ||
      !signal.memberId || !Number.isSafeInteger(signal.participantRevision)) return;
    const key = `${organizationId}:${signal.conversationId}:${signal.action}:${signal.memberId}:${signal.participantRevision}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > 500) seen.delete(seen.values().next().value!);
    let ownId: string | undefined;
    try { ownId = await session.registeredInboxMemberId(); }
    catch { seen.delete(key); return; }
    if (session.state().selectedId !== organizationId) return;
    if (signal.action === 'CREATED' && signal.memberId === ownId) return;
    const name = signal.memberId === ownId ? 'You' : /^[\p{L}\p{M}][\p{L}\p{M} .'-]{0,59}$/u.test(signal.memberName ?? '')
      ? signal.memberName : 'A member';
    const target = { organizationId, conversationId: signal.conversationId };
    if (signal.action === 'ADD') notify(`${name} ${name === 'You' ? 'were' : 'was'} added.`, target);
    else if (signal.action === 'REMOVE') notify(`${name} ${name === 'You' ? 'were' : 'was'} removed.`, target);
    else if (signal.action === 'CREATED') notify(`${name} started a conversation.`, target);
    return;
  }
  const key = `${organizationId}:${signal.messageId}:${signal.recipientStatus ?? signal.status}:${signal.memberId ?? ''}`;
  if (seen.has(key)) return;
  seen.add(key);
  try {
    const memberId = await session.registeredInboxMemberId();
    if (!memberId || session.state().selectedId !== organizationId) { seen.delete(key); return; }
    if (signal.recipientStatus === 'CONSUMED' && signal.senderMemberId === memberId && signal.memberId !== memberId) {
      notify('A member opened your Secure Chat message.', { organizationId, conversationId: signal.conversationId });
      return;
    }
    if (signal.status === 'FAILED' && signal.senderMemberId === memberId) {
      notify('A Secure Chat message could not be sent.', { organizationId, conversationId: signal.conversationId });
      return;
    }
    if (signal.status !== 'AVAILABLE' || signal.recipientStatus || signal.senderMemberId === memberId) return;
    const page = await session.listInboxMessages(signal.conversationId, { status: 'AVAILABLE' });
    if (session.state().selectedId !== organizationId) return;
    const message = page.items.find((item: { id: string; senderMemberId: string; recipientStatus?: string }) => item.id === signal.messageId);
    if (message && (message.senderMemberId === memberId || message.recipientStatus !== 'UNREAD')) return;
    if (!message) {
      const parents = await session.listInboxParentMetadata(signal.conversationId);
      const parent = parents.items.find((item: { parentId: string; senderMemberId: string; sequence: number }) =>
        item.parentId === signal.messageId);
      if (parent) {
        if (parent.senderMemberId === memberId || parent.sequence <= parents.readThroughSequence) return;
      } else {
        const normal = await session.listNormalInboxMetadata(signal.conversationId);
        const normalParent = normal.items.find((item: { parentId: string; senderMemberId: string; sequence: number }) =>
          item.parentId === signal.messageId);
        if (!normalParent || normalParent.senderMemberId === memberId || normalParent.sequence <= normal.readThroughSequence) return;
      }
    }
    publishInboxChanged({ kind: 'NEW_MESSAGE' });
    notify('A new message is ready in Secure Chat.', { organizationId, conversationId: signal.conversationId }, true);
  } catch {
    seen.delete(key);
  }
}
