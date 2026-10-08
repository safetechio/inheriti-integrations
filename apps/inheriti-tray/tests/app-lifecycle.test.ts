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
  mock.isVisible.mockReturnValue(false);
  mock.appEvents.clear();
  mock.powerEvents.clear();
});

it('hides and reloads the launcher on lock and suspend while clearing session data', async () => {
  const session = { clearOnLock: mock.clearOnLock, clearRevealed: mock.clearRevealed, setPublisher: vi.fn(), setInboxPublisher: vi.fn(), setInboxStatePublisher: vi.fn(), restore: vi.fn() };
  mock.watchLinuxLock.mockReturnValue(mock.stopLinuxLock);
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(mock.powerEvents.size).toBe(2));
  expect(mock.setAppUserModelId).toHaveBeenCalledWith('com.safetech.inheriti.go.dev');
  mock.powerEvents.get('lock-screen')?.();
  mock.powerEvents.get('suspend')?.();
  expect(mock.clearOnLock).toHaveBeenCalledTimes(2);
  expect(mock.hide).toHaveBeenCalledTimes(2);
  expect(mock.reload).toHaveBeenCalledTimes(2);
  mock.appEvents.get('before-quit')?.();
  expect(mock.clearRevealed).toHaveBeenCalled();
});

it('shows an OS notification for an unread message while the tray is visible', async () => {
  mock.isVisible.mockReturnValue(true);
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
  expect(mock.showNotification).toHaveBeenCalledWith({ title: expect.any(String), body: 'A new message is ready in Secure Chat.' });
  expect(mock.send).toHaveBeenCalledWith('tray:inbox-changed', { kind: 'NEW_MESSAGE' });
  expect(listInboxMessages).toHaveBeenCalledOnce();
});

it('notifies for an unread normal parent without opening its ciphertext', async () => {
  const setInboxPublisher = vi.fn();
  const listInboxParentMetadata = vi.fn(async () => ({ items: [{ parentId: 'parent-1', senderMemberId: 'other', sequence: 3 }],
    readThroughSequence: 1 }));
  const session = { clearRevealed: vi.fn(), setPublisher: vi.fn(), setInboxPublisher, setInboxStatePublisher: vi.fn(), restore: vi.fn(),
    state: () => ({ selectedId: 'org-a' }), registeredInboxMemberId: vi.fn(async () => 'member-a'),
    listInboxMessages: vi.fn(async () => ({ items: [] })), listInboxParentMetadata };
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(setInboxPublisher).toHaveBeenCalledOnce());
  setInboxPublisher.mock.calls[0]![0]({ conversationId: 'conversation-1', messageId: 'parent-1', status: 'AVAILABLE' });
  await vi.waitFor(() => expect(mock.showNotification).toHaveBeenCalledOnce());
  expect(listInboxParentMetadata).toHaveBeenCalledWith('conversation-1');
  expect(mock.showNotification).toHaveBeenCalledWith({ title: expect.any(String), body: 'A new message is ready in Secure Chat.' });
});

it('finds normal-only messages after the mixed-parent metadata lookup misses', async () => {
  const setInboxPublisher = vi.fn();
  const listInboxParentMetadata = vi.fn(async () => ({ items: [], readThroughSequence: 1 }));
  const listNormalInboxMetadata = vi.fn(async () => ({ items: [{ parentId: 'normal-1', senderMemberId: 'other', sequence: 3 }],
    readThroughSequence: 1 }));
  const session = { clearRevealed: vi.fn(), setPublisher: vi.fn(), setInboxPublisher, setInboxStatePublisher: vi.fn(), restore: vi.fn(),
    state: () => ({ selectedId: 'org-a' }), registeredInboxMemberId: vi.fn(async () => 'member-a'),
    listInboxMessages: vi.fn(async () => ({ items: [] })), listInboxParentMetadata, listNormalInboxMetadata };
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(setInboxPublisher).toHaveBeenCalledOnce());
  setInboxPublisher.mock.calls[0]![0]({ conversationId: 'conversation-1', messageId: 'normal-1', status: 'AVAILABLE' });
  await vi.waitFor(() => expect(mock.showNotification).toHaveBeenCalledOnce());
  expect(listInboxParentMetadata).toHaveBeenCalledWith('conversation-1');
  expect(listNormalInboxMetadata).toHaveBeenCalledWith('conversation-1');
});

it('notifies for a remote open receipt and a failed send without exposing content', async () => {
  const setInboxPublisher = vi.fn();
  const session = { clearRevealed: vi.fn(), setPublisher: vi.fn(), setInboxPublisher, setInboxStatePublisher: vi.fn(), restore: vi.fn(),
    state: () => ({ selectedId: 'org-a' }), registeredInboxMemberId: vi.fn(async () => 'member-a') };
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(setInboxPublisher).toHaveBeenCalledOnce());
  const publish = setInboxPublisher.mock.calls[0]![0];
  publish({ conversationId: 'conversation-1', messageId: 'message-1', status: 'AVAILABLE', recipientStatus: 'CONSUMED',
    senderMemberId: 'member-a', memberId: 'member-b' });
  publish({ conversationId: 'conversation-1', messageId: 'message-2', status: 'FAILED', senderMemberId: 'member-a' });
  await vi.waitFor(() => expect(mock.showNotification).toHaveBeenCalledTimes(2));
  expect(mock.showNotification.mock.calls.map(([item]) => item.body)).toEqual([
    'A member opened your Secure Chat message.', 'A Secure Chat message could not be sent.',
  ]);
});

it('notifies for conversation and participant signals', async () => {
  const setInboxPublisher = vi.fn();
  const session = { clearRevealed: vi.fn(), setPublisher: vi.fn(), setInboxPublisher, setInboxStatePublisher: vi.fn(), restore: vi.fn(),
    state: () => ({ selectedId: 'org-a' }) };
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(setInboxPublisher).toHaveBeenCalledOnce());
  const publish = setInboxPublisher.mock.calls[0]![0];
  publish({ kind: 'PARTICIPANTS' });
  publish({ kind: 'PARTICIPANTS' });
  publish({ kind: 'CONVERSATIONS' });
  expect(mock.showNotification.mock.calls.map(([item]) => item.body)).toEqual([
    'Secure Chat participants changed.', 'Your Secure Chat conversations changed.',
  ]);
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
