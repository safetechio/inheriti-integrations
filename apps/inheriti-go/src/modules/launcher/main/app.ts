import { app, autoUpdater, dialog, globalShortcut, Notification, powerMonitor, shell } from 'electron';
import { basename, join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { currentWindow, prepareToQuit, showLauncher } from './launcher-window.js';
import type { TraySession } from './state.js';
import type { TrayInboxSignal } from '../../inbox/main/inbox.js';
import { trayMessages as messages } from '../../../messages.js';
import { registerTrayEvents, setTrayUnread } from './tray.js';
import { registerTrayIpc } from './ipc.js';
import { watchLinuxLock } from './linux-lock.js';
import { downloadGoUpdate, installMacGoUpdate, relaunchGoAppImage, replaceGoAppImage, runWindowsGoInstaller } from './update.js';
import type { GoUpdateProgress } from './update.js';
import { ensureStartAtLogin, isBackgroundLaunch } from './start-at-login.js';

export function registerAppEvents(session: TraySession, appUrl: string | undefined, deployment: string): void {
  let updateProgress: GoUpdateProgress = null;
  const publishUpdateProgress = (progress: GoUpdateProgress) => {
    updateProgress = progress;
    const window = currentWindow();
    if (window && !window.isDestroyed()) window.webContents.send('tray:update-progress', progress);
  };
  let stopLinuxLock: (() => void) | undefined;
  let refreshOnShow: (() => void) | undefined;
  let seenInboxMessages = new Set<string>();
  const sessionRevision = () => session.inboxSessionRevision?.() ?? 0;
  let seenRevision = sessionRevision();
  const notices = new Set<Notification>();
  const unreadNotices = new Map<string, Notification>();
  const notify = (body: string, target?: { organizationId: string; conversationId: string }, untilRead = false): void => {
    if (!Notification.isSupported()) return;
    const revision = sessionRevision();
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
      if (revision !== sessionRevision()) return;
      showLauncher(target ? { kind: 'OPEN_INBOX', ...target } : undefined);
    });
    notice.show();
    if (!untilRead) {
      const timer = setTimeout(() => notice.close(), 8_000);
      timer.unref();
      notice.on('close', () => clearTimeout(timer));
    }
  };
  let badgeRequest = 0;
  let badgeRefreshing = false;
  let badgePending = false;
  const clearPreviousAccount = (): void => {
    seenInboxMessages = new Set<string>();
    seenRevision = sessionRevision();
    ++badgeRequest;
    setTrayUnread(false);
    for (const notice of notices) notice.close();
  };
  const scanBadge = async () => {
    const state = session.state();
    const revision = sessionRevision();
    const request = ++badgeRequest;
    if (state.status === 'signed-out') {
      setTrayUnread(false);
      for (const notice of unreadNotices.values()) notice.close();
      return;
    }
    if (state.status !== 'signed-in') return;
    try {
      let unread = false;
      const unresolved = new Set(unreadNotices.keys());
      const dismiss: string[] = [];
      for (const organization of state.organizations ?? []) {
        let offset = 0;
        do {
          const page = await session.listOrganizationInboxConversations(organization.id, { limit: 100, offset });
          for (const item of page.items as { id?: string; unreadCount: number }[]) {
            if (item.unreadCount > 0) unread = true;
            const key = `${organization.id}:${item.id}`;
            if (unresolved.delete(key) && item.unreadCount === 0) dismiss.push(key);
          }
          offset += page.items.length;
          if (!page.items.length || offset >= page.total) break;
        } while (true);
      }
      if (request === badgeRequest && revision === sessionRevision() && session.state().status === 'signed-in') {
        setTrayUnread(unread);
        for (const key of dismiss.concat([...unresolved])) unreadNotices.get(key)?.close();
      }
    } catch { /* Keep the last confirmed unread state until the next refresh. */ }
  };
  const refreshBadge = async () => {
    if (session.state().status === 'signed-out') {
      ++badgeRequest;
      setTrayUnread(false);
      for (const notice of unreadNotices.values()) notice.close();
      return;
    }
    if (badgeRefreshing) { badgePending = true; ++badgeRequest; return; }
    badgeRefreshing = true;
    try {
      do {
        badgePending = false;
        await scanBadge();
      } while (badgePending);
    } finally { badgeRefreshing = false; }
  };
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', (_event, argv: string[]) => { if (!isBackgroundLaunch(argv)) showLauncher(); });
  app.on('browser-window-created', (_event, window) => {
    window.on('hide', () => {
      session.clearRevealed();
      void session.cancelPlanEdit().catch(() => {});
    });
    window.on('show', () => refreshOnShow?.());
  });
  app.whenReady().then(async () => {
    app.setAppUserModelId(`com.safetech.inheriti.go.${deployment}`);
    try { ensureStartAtLogin(deployment, join(import.meta.dirname, deployment === 'prod' ? 'tray.png' : `tray-${deployment}.png`)); }
    catch { console.warn('Could not enable Inheriti Go launch at login.'); }
    const publishState = () => {
      const revision = sessionRevision();
      if (revision !== seenRevision) clearPreviousAccount();
      if (session.state().status === 'signed-out') {
        seenInboxMessages.clear();
        for (const notice of notices) notice.close();
      }
      publish(session);
      void refreshBadge();
    };
    refreshOnShow = () => { void session.refreshOrganizations().then((changed) => { if (changed) publishState(); }).catch(() => {}); };
    session.setPublisher(publishState);
    session.setInboxPublisher((signal) => {
      const revision = sessionRevision();
      if (revision !== seenRevision) clearPreviousAccount();
      const selectedId = session.state().selectedId;
      if (!signal || !('tenantId' in signal) || !signal.tenantId || signal.tenantId === selectedId) publishInboxChanged(signal);
      if (signal && 'kind' in signal && signal.kind === 'PRESENCE') return;
      void notifyInboxEvent(session, signal, seenInboxMessages, (body, target, untilRead) => {
        if (revision === sessionRevision()) notify(body, target, untilRead);
      }).finally(() => { void refreshBadge(); });
    });
    session.setInboxStatePublisher(() => publishInbox(session));
    registerTrayEvents(appUrl, deployment, () => { void checkForUpdates(session, publishUpdateProgress); });
    registerTrayIpc(session, currentWindow, publishState, appUrl, notify,
      () => publishInbox(session), () => { void refreshBadge(); }, () => updateProgress);
    powerMonitor.on('lock-screen', () => hideForLock(session));
    powerMonitor.on('suspend', () => hideForLock(session));
    if (process.platform === 'linux') stopLinuxLock = watchLinuxLock(() => hideForLock(session));
    registerShortcut();
    if (!isBackgroundLaunch()) showLauncher();
    if (process.platform === 'darwin') app.on('activate', () => showLauncher());
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

let updateRunning = false;
async function checkForUpdates(session: TraySession, publishProgress: (progress: GoUpdateProgress) => void): Promise<void> {
  if (updateRunning) return;
  updateRunning = true;
  try {
    if (session.state().status !== 'signed-in') {
      await dialog.showMessageBox({ type: 'info', title: 'Inheriti Go updates', message: 'Sign in to check for updates.' });
      return;
    }
    const build = await session.availableUpdate(app.getVersion());
    if (!build) {
      await dialog.showMessageBox({ type: 'info', title: 'Inheriti Go updates', message: `Version ${app.getVersion()} is up to date.` });
      return;
    }
    const extension = ({ linux: '.AppImage', darwin: '.zip', win32: '.exe' } as Record<string, string>)[process.platform];
    if (!extension || basename(build.fileName) !== build.fileName || !build.fileName.endsWith(extension)) throw new Error('Invalid update artifact.');
    const answer = await dialog.showMessageBox({ type: 'info', title: 'Inheriti Go update',
      message: `Version ${build.version} is available.`, detail: 'Install the update now?',
      buttons: ['Install', 'Later'], defaultId: 0, cancelId: 1 });
    if (answer.response !== 0) return;
    showLauncher();
    let lastPercent = -1;
    const onProgress = (downloaded: number, total: number) => {
      const percent = Math.floor(downloaded * 100 / total);
      if (percent === lastPercent) return;
      lastPercent = percent;
      publishProgress({ phase: 'downloading', version: build.version, percent });
    };
    onProgress(0, build.size);
    if (process.platform === 'darwin') {
      const { url } = await session.requestUpdateDownload(build.id);
      await installMacGoUpdate(build, url, autoUpdater,
        () => { publishProgress({ phase: 'restarting', version: build.version }); session.clearRevealed(); prepareToQuit(); },
        onProgress, () => publishProgress({ phase: 'installing', version: build.version }));
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'inheriti-go-update-'));
    const destination = join(directory, build.fileName);
    try {
      const { url } = await session.requestUpdateDownload(build.id);
      await downloadGoUpdate(build, url, destination, onProgress);
      publishProgress({ phase: 'installing', version: build.version });
      if (process.platform === 'linux') {
        const current = process.env.APPIMAGE;
        if (current && await replaceGoAppImage(destination, current)) {
          await rm(directory, { recursive: true, force: true });
          publishProgress({ phase: 'restarting', version: build.version });
          await relaunchGoAppImage(current, () => app.quit());
          return;
        }
        shell.showItemInFolder(destination);
        publishProgress(null);
        await dialog.showMessageBox({ type: 'info', title: 'Inheriti Go update', message: 'Open the downloaded AppImage to install the update.' });
        return;
      }
      if (process.platform === 'win32') {
        await runWindowsGoInstaller(destination, () => app.quit());
        return;
      }
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  } catch {
    publishProgress(null);
    await dialog.showMessageBox({ type: 'error', title: 'Inheriti Go updates', message: 'The update could not be installed. Please try again.' });
  } finally {
    updateRunning = false;
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
  const revision = session.inboxSessionRevision?.() ?? 0;
  const organizationId = ('tenantId' in signal && signal.tenantId) || session.state().selectedId;
  if (!organizationId) return;
  if (organizationId !== session.state().selectedId) {
    if ('kind' in signal || signal.status !== 'AVAILABLE' || signal.recipientStatus ||
      session.state().status !== 'signed-in' || !session.state().organizations.some(({ id }) => id === organizationId)) return;
    const key = `${revision}:${organizationId}:${signal.messageId}:AVAILABLE`;
    if (seen.has(key)) return;
    seen.add(key);
    let confirmed = false;
    try {
      let offset = 0;
      do {
        const page = await session.listOrganizationInboxConversations(organizationId, { limit: 100, offset });
        if (revision !== (session.inboxSessionRevision?.() ?? 0) || session.state().status !== 'signed-in' ||
          !session.state().organizations.some(({ id }) => id === organizationId)) return;
        const conversation = page.items.find((item: { id: string }) => item.id === signal.conversationId);
        if (conversation) {
          if (conversation.unreadCount > 0) {
            confirmed = true;
            notify('You have unread Secure Chat messages.', { organizationId, conversationId: signal.conversationId }, true);
          }
          return;
        }
        offset += page.items.length;
        if (!page.items.length || offset >= page.total) return;
      } while (true);
    } catch { /* A later signal can retry the read. */ }
    finally { if (!confirmed) seen.delete(key); }
    return;
  }
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
      const name = /^[\p{L}\p{M}][\p{L}\p{M} .'-]{0,59}$/u.test(signal.memberName ?? '')
        ? signal.memberName : 'A member';
      notify(`${name} opened your Secure Chat message.`, { organizationId, conversationId: signal.conversationId });
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
    if (revision !== (session.inboxSessionRevision?.() ?? 0)) return;
    publishInboxChanged({ kind: 'NEW_MESSAGE' });
    notify('You have a new Secure Chat message.', { organizationId, conversationId: signal.conversationId }, true);
  } catch {
    seen.delete(key);
  }
}
