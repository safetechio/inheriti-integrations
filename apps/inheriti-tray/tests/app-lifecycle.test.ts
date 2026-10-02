import { beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  appEvents: new Map<string, (...args: unknown[]) => void>(),
  powerEvents: new Map<string, () => void>(),
  registerIpc: vi.fn(),
  watchLinuxLock: vi.fn(),
  stopLinuxLock: vi.fn(),
  setAppUserModelId: vi.fn(),
  clearOnLock: vi.fn(),
  clearRevealed: vi.fn(),
  hide: vi.fn(),
  reload: vi.fn(),
  send: vi.fn(),
  showNotification: vi.fn(),
  isVisible: vi.fn(() => false),
}));

vi.mock('electron', () => ({
  app: { requestSingleInstanceLock: () => true, on: (name: string, listener: (...args: unknown[]) => void) => mock.appEvents.set(name, listener), whenReady: () => Promise.resolve(), setAppUserModelId: mock.setAppUserModelId },
  globalShortcut: { register: () => true, unregisterAll: vi.fn() },
  powerMonitor: { on: (name: string, listener: () => void) => mock.powerEvents.set(name, listener) },
  Notification: class {
    static isSupported() { return true; }
    constructor(readonly options: { title: string; body: string }) {}
    show() { mock.showNotification(this.options); }
  },
}));
vi.mock('../src/modules/launcher/main/launcher-window.js', () => ({
  currentWindow: () => ({ isDestroyed: () => false, isVisible: mock.isVisible, hide: mock.hide, webContents: { reload: mock.reload, send: mock.send } }),
  prepareToQuit: vi.fn(), showLauncher: vi.fn(),
}));
vi.mock('../src/modules/launcher/main/tray.js', () => ({ registerTrayEvents: vi.fn() }));
vi.mock('../src/modules/launcher/main/ipc.js', () => ({ registerTrayIpc: mock.registerIpc }));
vi.mock('../src/modules/launcher/main/linux-lock.js', () => ({ watchLinuxLock: mock.watchLinuxLock }));

import { registerAppEvents } from '../src/modules/launcher/main/app.js';

beforeEach(() => {
  vi.clearAllMocks();
  mock.appEvents.clear();
  mock.powerEvents.clear();
});

it('hides and reloads the launcher on lock and suspend while clearing session data', async () => {
  const session = { clearOnLock: mock.clearOnLock, clearRevealed: mock.clearRevealed, setPublisher: vi.fn(), setInboxPublisher: vi.fn(), setInboxStatePublisher: vi.fn(), restore: vi.fn() };
  mock.watchLinuxLock.mockReturnValue(mock.stopLinuxLock);
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(mock.powerEvents.size).toBe(2));
  expect(mock.setAppUserModelId).toHaveBeenCalledWith('com.safetech.inheriti.tray.dev');
  mock.powerEvents.get('lock-screen')?.();
  mock.powerEvents.get('suspend')?.();
  expect(mock.clearOnLock).toHaveBeenCalledTimes(2);
  expect(mock.hide).toHaveBeenCalledTimes(2);
  expect(mock.reload).toHaveBeenCalledTimes(2);
  mock.appEvents.get('before-quit')?.();
  expect(mock.clearRevealed).toHaveBeenCalled();
});

it('notifies once for an unread message from another member while hidden', async () => {
  const setInboxPublisher = vi.fn();
  const listInboxMessages = vi.fn(async () => ({ items: [{ id: 'message-1', senderMemberId: 'other', recipientStatus: 'UNREAD' }] }));
  const session = { clearRevealed: vi.fn(), setPublisher: vi.fn(), setInboxPublisher, setInboxStatePublisher: vi.fn(), restore: vi.fn(),
    state: () => ({ selectedId: 'org-a' }), registeredInboxMemberId: vi.fn(async () => 'member-a'), listInboxMessages };
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(setInboxPublisher).toHaveBeenCalledOnce());
  const publish = setInboxPublisher.mock.calls[0]![0];
  publish({ conversationId: 'conversation-1', messageId: 'message-1', status: 'AVAILABLE' });
  publish({ conversationId: 'conversation-1', messageId: 'message-1', status: 'AVAILABLE' });
  await vi.waitFor(() => expect(mock.showNotification).toHaveBeenCalledOnce());
  expect(mock.showNotification).toHaveBeenCalledWith({ title: expect.any(String), body: 'A protected message is ready in Secure Inbox.' });
  expect(mock.send).toHaveBeenCalledWith('tray:inbox-changed', { kind: 'NEW_MESSAGE' });
  expect(listInboxMessages).toHaveBeenCalledOnce();
});

it('does not notify for a message sent by the signed-in member', async () => {
  const setInboxPublisher = vi.fn();
  const session = { clearRevealed: vi.fn(), setPublisher: vi.fn(), setInboxPublisher, setInboxStatePublisher: vi.fn(), restore: vi.fn(),
    state: () => ({ selectedId: 'org-a' }), registeredInboxMemberId: vi.fn(async () => 'member-a'),
    listInboxMessages: vi.fn(async () => ({ items: [{ id: 'message-1', senderMemberId: 'member-a', recipientStatus: 'UNREAD' }] })) };
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(setInboxPublisher).toHaveBeenCalledOnce());
  setInboxPublisher.mock.calls[0]![0]({ conversationId: 'conversation-1', messageId: 'message-1', status: 'AVAILABLE' });
  await vi.waitFor(() => expect(session.listInboxMessages).toHaveBeenCalledOnce());
  expect(mock.showNotification).not.toHaveBeenCalled();
});
