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
  closeNotification: vi.fn(),
  notifications: [] as Array<{ options: { title: string; body: string; timeoutType?: string }; emit: (name: string) => void; close: () => void }>,
  showLauncher: vi.fn(),
  setTrayUnread: vi.fn(),
  isVisible: vi.fn(() => false),
}));

vi.mock('electron', () => ({
  app: { requestSingleInstanceLock: () => true, on: (name: string, listener: (...args: unknown[]) => void) => mock.appEvents.set(name, listener), whenReady: () => Promise.resolve(), setAppUserModelId: mock.setAppUserModelId },
  globalShortcut: { register: () => true, unregisterAll: vi.fn() },
  powerMonitor: { on: (name: string, listener: () => void) => mock.powerEvents.set(name, listener) },
  Notification: class {
    static isSupported() { return true; }
    private readonly handlers = new Map<string, Array<() => void>>();
    private closed = false;
    constructor(readonly options: { title: string; body: string; timeoutType?: string }) { mock.notifications.push(this); }
    on(name: string, handler: () => void) { this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]); return this; }
    emit(name: string) { for (const handler of this.handlers.get(name) ?? []) handler(); }
    close() { if (this.closed) return; this.closed = true; mock.closeNotification(this.options); this.emit('close'); }
    show() { mock.showNotification(this.options); }
  },
}));
vi.mock('../src/modules/launcher/main/launcher-window.js', () => ({
  currentWindow: () => ({ isDestroyed: () => false, isVisible: mock.isVisible, hide: mock.hide, webContents: { reload: mock.reload, send: mock.send } }),
  prepareToQuit: vi.fn(), showLauncher: mock.showLauncher,
}));
vi.mock('../src/modules/launcher/main/tray.js', () => ({ registerTrayEvents: vi.fn(), setTrayUnread: mock.setTrayUnread }));
vi.mock('../src/modules/launcher/main/ipc.js', () => ({ registerTrayIpc: mock.registerIpc }));
vi.mock('../src/modules/launcher/main/linux-lock.js', () => ({ watchLinuxLock: mock.watchLinuxLock }));
vi.mock('../src/modules/launcher/main/start-at-login.js', () => ({ ensureStartAtLogin: vi.fn(), isBackgroundLaunch: () => false }));

import { registerAppEvents } from '../src/modules/launcher/main/app.js';

beforeEach(() => {
  for (const notification of mock.notifications) notification.close();
  vi.clearAllMocks();
  mock.notifications.length = 0;
  mock.isVisible.mockReturnValue(false);
  mock.appEvents.clear();
  mock.powerEvents.clear();
});

it('hides and reloads the launcher on lock and suspend while clearing session data', async () => {
  const session = { clearOnLock: mock.clearOnLock, clearRevealed: mock.clearRevealed, setPublisher: vi.fn(), setInboxPublisher: vi.fn(), setInboxStatePublisher: vi.fn(), restore: vi.fn(), state: () => ({ status: 'signed-out' }) };
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

it('opens the launcher while checking the saved session', async () => {
  let finishRestore!: () => void;
  const restore = vi.fn(() => new Promise<void>((resolve) => { finishRestore = resolve; }));
  const session = { setPublisher: vi.fn(), setInboxPublisher: vi.fn(), setInboxStatePublisher: vi.fn(), restore,
    state: () => ({ status: 'signed-out' }) };
  registerAppEvents(session as never, undefined, 'local');
  await vi.waitFor(() => expect(mock.showLauncher).toHaveBeenCalledOnce());
  expect(restore).toHaveBeenCalledOnce();
  finishRestore();
  await vi.waitFor(() => expect(mock.send).toHaveBeenCalledWith('tray:state-changed', { status: 'signed-out' }));
});

it('reconciles unread counts across pages and clears them on organization change and sign-out', async () => {
  let selectedId: string | undefined = 'org-a';
  const setPublisher = vi.fn();
  const listInboxConversations = vi.fn(async ({ offset }: { offset: number }) => offset === 0
    ? { items: [{ unreadCount: 0 }], total: 2 }
    : { items: [{ unreadCount: 1 }], total: 2 });
  const session = { setPublisher, setInboxPublisher: vi.fn(), setInboxStatePublisher: vi.fn(), restore: vi.fn(),
    state: () => ({ selectedId }), listInboxConversations };
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(mock.setTrayUnread).toHaveBeenLastCalledWith(true));
  expect(listInboxConversations).toHaveBeenCalledWith({ limit: 100, offset: 1 });
  selectedId = 'org-b';
  listInboxConversations.mockImplementation(async () => ({ items: [{ unreadCount: 0 }], total: 1 }));
  setPublisher.mock.calls[0]![0]();
  await vi.waitFor(() => expect(mock.setTrayUnread).toHaveBeenLastCalledWith(false));
  selectedId = undefined;
  setPublisher.mock.calls[0]![0]();
  expect(mock.setTrayUnread).toHaveBeenLastCalledWith(false);
});

it('ignores an unread response that finishes after sign-out', async () => {
  let selectedId: string | undefined = 'org-a';
  let finishList!: (page: { items: { unreadCount: number }[]; total: number }) => void;
  const setPublisher = vi.fn();
  const listInboxConversations = vi.fn(() => new Promise<{ items: { unreadCount: number }[]; total: number }>((resolve) => { finishList = resolve; }));
  const session = { setPublisher, setInboxPublisher: vi.fn(), setInboxStatePublisher: vi.fn(), restore: vi.fn(),
    state: () => ({ selectedId }), listInboxConversations };
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(listInboxConversations).toHaveBeenCalledOnce());
  selectedId = undefined;
  setPublisher.mock.calls[0]![0]();
  finishList({ items: [{ unreadCount: 1 }], total: 1 });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(mock.setTrayUnread).toHaveBeenLastCalledWith(false);
  expect(mock.setTrayUnread).not.toHaveBeenCalledWith(true);
});

it('refreshes the dot after the read IPC callback', async () => {
  let unreadCount = 1;
  const session = { setPublisher: vi.fn(), setInboxPublisher: vi.fn(), setInboxStatePublisher: vi.fn(), restore: vi.fn(),
    state: () => ({ selectedId: 'org-a' }), listInboxConversations: vi.fn(async () => ({ items: [{ unreadCount }], total: 1 })) };
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(mock.setTrayUnread).toHaveBeenLastCalledWith(true));
  unreadCount = 0;
  mock.registerIpc.mock.calls[0]![6]();
  await vi.waitFor(() => expect(mock.setTrayUnread).toHaveBeenLastCalledWith(false));
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
  expect(mock.showNotification).toHaveBeenCalledWith(expect.objectContaining({ title: expect.any(String), body: 'A new message is ready in Secure Chat.' }));
  expect(mock.send).toHaveBeenCalledWith('tray:inbox-changed', { kind: 'NEW_MESSAGE' });
  expect(listInboxMessages).toHaveBeenCalledOnce();
});

it('opens the notified conversation and dismisses its notice when read', async () => {
  let unreadCount = 1;
  const setInboxPublisher = vi.fn();
  const session = { setPublisher: vi.fn(), setInboxPublisher, setInboxStatePublisher: vi.fn(), restore: vi.fn(),
    state: () => ({ status: 'signed-in', selectedId: 'org-a' }), registeredInboxMemberId: vi.fn(async () => 'member-a'),
    listInboxConversations: vi.fn(async () => ({ items: [{ id: 'conversation-1', unreadCount }], total: 1 })),
    listInboxMessages: vi.fn(async () => ({ items: [
      { id: 'message-1', senderMemberId: 'other', recipientStatus: 'UNREAD' },
      { id: 'message-2', senderMemberId: 'other', recipientStatus: 'UNREAD' },
    ] })) };
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(setInboxPublisher).toHaveBeenCalledOnce());
  const publish = setInboxPublisher.mock.calls[0]![0];
  publish({ conversationId: 'conversation-1', messageId: 'message-1', status: 'AVAILABLE' });
  await vi.waitFor(() => expect(mock.notifications).toHaveLength(1));
  mock.notifications[0]!.emit('click');
  expect(mock.showLauncher).toHaveBeenLastCalledWith({ kind: 'OPEN_INBOX', organizationId: 'org-a', conversationId: 'conversation-1' });
  expect(mock.closeNotification).toHaveBeenCalledOnce();

  publish({ conversationId: 'conversation-1', messageId: 'message-2', status: 'AVAILABLE' });
  await vi.waitFor(() => expect(mock.notifications).toHaveLength(2));
  unreadCount = 0;
  mock.registerIpc.mock.calls[0]![6]();
  await vi.waitFor(() => expect(mock.closeNotification).toHaveBeenCalledTimes(2));
});

it('dismisses a delayed message notice if the conversation was already read', async () => {
  let unreadCount = 1;
  let finishMessages!: (value: { items: { id: string; senderMemberId: string; recipientStatus: string }[] }) => void;
  const setInboxPublisher = vi.fn();
  const session = { setPublisher: vi.fn(), setInboxPublisher, setInboxStatePublisher: vi.fn(), restore: vi.fn(),
    state: () => ({ status: 'signed-in', selectedId: 'org-a' }), registeredInboxMemberId: vi.fn(async () => 'member-a'),
    listInboxConversations: vi.fn(async () => ({ items: [{ id: 'conversation-1', unreadCount }], total: 1 })),
    listInboxMessages: vi.fn(() => new Promise((resolve) => { finishMessages = resolve; })) };
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(setInboxPublisher).toHaveBeenCalledOnce());
  setInboxPublisher.mock.calls[0]![0]({ conversationId: 'conversation-1', messageId: 'message-1', status: 'AVAILABLE' });
  await vi.waitFor(() => expect(session.listInboxMessages).toHaveBeenCalledOnce());
  unreadCount = 0;
  mock.registerIpc.mock.calls[0]![6]();
  await vi.waitFor(() => expect(mock.setTrayUnread).toHaveBeenLastCalledWith(false));
  finishMessages({ items: [{ id: 'message-1', senderMemberId: 'other', recipientStatus: 'UNREAD' }] });
  await vi.waitFor(() => expect(mock.closeNotification).toHaveBeenCalledOnce());
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
  expect(mock.showNotification).toHaveBeenCalledWith(expect.objectContaining({ title: expect.any(String), body: 'A new message is ready in Secure Chat.' }));
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

it('notifies once for detailed conversation membership events only', async () => {
  const setInboxPublisher = vi.fn();
  const session = { clearRevealed: vi.fn(), setPublisher: vi.fn(), setInboxPublisher, setInboxStatePublisher: vi.fn(), restore: vi.fn(),
    state: () => ({ selectedId: 'org-a' }), registeredInboxMemberId: vi.fn(async () => 'member-a') };
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(setInboxPublisher).toHaveBeenCalledOnce());
  const publish = setInboxPublisher.mock.calls[0]![0];
  publish({ kind: 'PARTICIPANTS' });
  publish({ kind: 'CONVERSATIONS' });
  const added = { kind: 'CONVERSATIONS', conversationId: 'conversation-1', action: 'ADD', memberId: 'member-a', participantRevision: 2 };
  publish(added);
  publish(added);
  publish({ ...added, action: 'CREATED', participantRevision: 1 });
  publish({ ...added, memberId: 'member-b', memberName: 'Ana', participantRevision: 3 });
  await vi.waitFor(() => expect(mock.showNotification.mock.calls.map(([item]) => item.body)).toEqual([
    'You were added.', 'Ana was added.',
  ]));
});

it('retries a conversation notification after member identity lookup fails', async () => {
  const setInboxPublisher = vi.fn();
  const registeredInboxMemberId = vi.fn().mockRejectedValueOnce(new Error('auth unavailable')).mockResolvedValue('member-a');
  const session = { clearRevealed: vi.fn(), setPublisher: vi.fn(), setInboxPublisher, setInboxStatePublisher: vi.fn(), restore: vi.fn(),
    state: () => ({ selectedId: 'org-a' }), registeredInboxMemberId };
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(setInboxPublisher).toHaveBeenCalledOnce());
  const publish = setInboxPublisher.mock.calls[0]![0];
  const added = { kind: 'CONVERSATIONS', conversationId: 'conversation-1', action: 'ADD', memberId: 'member-b', memberName: 'Ana', participantRevision: 2 };
  publish(added);
  await vi.waitFor(() => expect(registeredInboxMemberId).toHaveBeenCalledTimes(1));
  expect(mock.showNotification).not.toHaveBeenCalled();
  publish(added);
  await vi.waitFor(() => expect(mock.showNotification.mock.calls.map(([item]) => item.body)).toEqual(['Ana was added.']));
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
