import { beforeEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  appEvents: new Map<string, (...args: unknown[]) => void>(),
  windowEvents: new Map<string, () => void>(),
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
  isBackgroundLaunch: vi.fn(() => false),
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
vi.mock('../src/modules/launcher/main/start-at-login.js', () => ({ ensureStartAtLogin: vi.fn(), isBackgroundLaunch: mock.isBackgroundLaunch }));

import { registerAppEvents } from '../src/modules/launcher/main/app.js';

beforeEach(() => {
  for (const notification of mock.notifications) notification.close();
  vi.clearAllMocks();
  mock.notifications.length = 0;
  mock.isVisible.mockReturnValue(false);
  mock.isBackgroundLaunch.mockReturnValue(false);
  mock.appEvents.clear();
  mock.windowEvents.clear();
  mock.powerEvents.clear();
});

it('skips the launcher for a mocked macOS background launch and opens it on activate', async () => {
  const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
  try {
    mock.isBackgroundLaunch.mockReturnValue(true);
    const session = { setPublisher: vi.fn(), setInboxPublisher: vi.fn(), setInboxStatePublisher: vi.fn(), restore: vi.fn(),
      state: () => ({ status: 'signed-out' }) };
    registerAppEvents(session as never, undefined, 'dev');
    expect(mock.appEvents.has('activate')).toBe(false);
    await vi.waitFor(() => expect(mock.appEvents.has('activate')).toBe(true));
    expect(mock.showLauncher).not.toHaveBeenCalled();
    mock.appEvents.get('activate')?.();
    expect(mock.showLauncher).toHaveBeenCalledOnce();
  } finally {
    platform.mockRestore();
  }
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

it('refreshes organizations when the launcher is shown again', async () => {
  const refreshOrganizations = vi.fn().mockResolvedValue(true);
  const session = { setPublisher: vi.fn(), setInboxPublisher: vi.fn(), setInboxStatePublisher: vi.fn(),
    restore: vi.fn(), refreshOrganizations, state: () => ({ status: 'signed-in' }) };
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(mock.showLauncher).toHaveBeenCalledOnce());
  mock.appEvents.get('browser-window-created')?.(undefined, { on: (name: string, listener: () => void) => mock.windowEvents.set(name, listener) });
  mock.windowEvents.get('show')?.();
  await vi.waitFor(() => expect(refreshOrganizations).toHaveBeenCalledOnce());
  expect(mock.send).toHaveBeenCalledWith('tray:state-changed', { status: 'signed-in' });
});

it('reconciles unread counts across pages and clears them on organization change and sign-out', async () => {
  let selectedId: string | undefined = 'org-a';
  const setPublisher = vi.fn();
  const listInboxConversations = vi.fn(async ({ offset }: { offset: number }) => offset === 0
    ? { items: [{ unreadCount: 0 }], total: 2 }
    : { items: [{ unreadCount: 1 }], total: 2 });
  const session = { setPublisher, setInboxPublisher: vi.fn(), setInboxStatePublisher: vi.fn(), restore: vi.fn(),
    state: () => ({ status: selectedId ? 'signed-in' : 'signed-out', selectedId, organizations: selectedId ? [{ id: selectedId }] : [] }),
    listOrganizationInboxConversations: vi.fn((_id: string, input: { offset: number }) => listInboxConversations(input)) };
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
    state: () => ({ status: selectedId ? 'signed-in' : 'signed-out', selectedId, organizations: selectedId ? [{ id: selectedId }] : [] }),
    listOrganizationInboxConversations: vi.fn(() => listInboxConversations()) };
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
    state: () => ({ status: 'signed-in', activeSubject: 'subject-a', selectedId: 'org-a', organizations: [{ id: 'org-a' }] }),
    listOrganizationInboxConversations: vi.fn(async () => ({ items: [{ unreadCount }], total: 1 })) };
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
    state: () => ({ status: 'signed-in', activeSubject: 'subject-a', selectedId: 'org-a' }), registeredInboxMemberId: vi.fn(async () => 'member-a'), listInboxMessages };
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(setInboxPublisher).toHaveBeenCalledOnce());
  const publish = setInboxPublisher.mock.calls[0]![0];
  publish({ conversationId: 'conversation-1', messageId: 'message-1', status: 'AVAILABLE' });
  publish({ conversationId: 'conversation-1', messageId: 'message-1', status: 'AVAILABLE' });
  await vi.waitFor(() => expect(mock.showNotification).toHaveBeenCalledOnce());
  expect(mock.showNotification).toHaveBeenCalledWith(expect.objectContaining({ title: expect.any(String), body: 'You have a new Secure Chat message.' }));
  expect(mock.send).toHaveBeenCalledWith('tray:inbox-changed', { kind: 'NEW_MESSAGE' });
  expect(listInboxMessages).toHaveBeenCalledOnce();
});

it('notifies for an unread message in another authorized organization without changing the selected UI', async () => {
  const setInboxPublisher = vi.fn();
  const listOrganizationInboxConversations = vi.fn(async (id: string) => ({
    items: [{ id: 'conversation-b', unreadCount: id === 'org-b' ? 1 : 0 }], total: 1,
  }));
  const session = { setPublisher: vi.fn(), setInboxPublisher, setInboxStatePublisher: vi.fn(), restore: vi.fn(),
    state: () => ({ status: 'signed-in', activeSubject: 'subject-a', selectedId: 'org-a', organizations: [{ id: 'org-a' }, { id: 'org-b' }] }),
    listOrganizationInboxConversations, listInboxMessages: vi.fn(), registeredInboxMemberId: vi.fn() };
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(setInboxPublisher).toHaveBeenCalledOnce());
  setInboxPublisher.mock.calls[0]![0]({ tenantId: 'org-b', conversationId: 'conversation-b', messageId: 'message-b', status: 'AVAILABLE' });
  await vi.waitFor(() => expect(mock.showNotification).toHaveBeenCalledOnce());
  expect(mock.showNotification).toHaveBeenCalledWith(expect.objectContaining({ body: 'You have unread Secure Chat messages.' }));
  expect(mock.setTrayUnread).toHaveBeenLastCalledWith(true);
  expect(session.listInboxMessages).not.toHaveBeenCalled();
  expect(session.registeredInboxMemberId).not.toHaveBeenCalled();
  expect(mock.send).not.toHaveBeenCalledWith('tray:inbox-changed', expect.anything());
  mock.notifications[0]!.emit('click');
  expect(mock.showLauncher).toHaveBeenLastCalledWith({ kind: 'OPEN_INBOX', organizationId: 'org-b', conversationId: 'conversation-b', accountSubject: 'subject-a' });
});

it('drops an old account’s delayed unread response after another account signs in', async () => {
  const setInboxPublisher = vi.fn();
  const setPublisher = vi.fn();
  let revision = 1;
  let finish!: (page: { items: { id: string; unreadCount: number }[]; total: number }) => void;
  const session = { setPublisher, setInboxPublisher, setInboxStatePublisher: vi.fn(), restore: vi.fn(),
    inboxSessionRevision: () => revision,
    state: () => ({ status: 'signed-in', activeSubject: 'subject-a', selectedId: 'org-a', organizations: [{ id: 'org-a' }, { id: 'org-b' }] }),
    listOrganizationInboxConversations: vi.fn((id: string) => id === 'org-b'
      ? new Promise<{ items: { id: string; unreadCount: number }[]; total: number }>((resolve) => { finish = resolve; })
      : Promise.resolve({ items: [], total: 0 })) };
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(setInboxPublisher).toHaveBeenCalledOnce());
  setInboxPublisher.mock.calls[0]![0]({ tenantId: 'org-b', conversationId: 'conversation-b', messageId: 'message-b', status: 'AVAILABLE' });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  revision = 2;
  setPublisher.mock.calls[0]![0]();
  finish({ items: [{ id: 'conversation-b', unreadCount: 1 }], total: 1 });
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(mock.showNotification).not.toHaveBeenCalled();
});

it('closes old account notices and ignores their clicks after activation', async () => {
  const setInboxPublisher = vi.fn();
  const setPublisher = vi.fn();
  let revision = 1;
  const session = { setPublisher, setInboxPublisher, setInboxStatePublisher: vi.fn(), restore: vi.fn(),
    inboxSessionRevision: () => revision,
    state: () => ({ status: 'signed-in', activeSubject: 'subject-a', selectedId: 'org-a', organizations: [{ id: 'org-a' }] }),
    registeredInboxMemberId: vi.fn(async () => 'member-a'),
    listInboxMessages: vi.fn(async () => ({ items: [{ id: 'message-a', senderMemberId: 'other', recipientStatus: 'UNREAD' }] })),
    listOrganizationInboxConversations: vi.fn(async () => ({ items: [], total: 0 })) };
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(setInboxPublisher).toHaveBeenCalledOnce());
  setInboxPublisher.mock.calls[0]![0]({ conversationId: 'conversation-a', messageId: 'message-a', status: 'AVAILABLE' });
  await vi.waitFor(() => expect(mock.showNotification).toHaveBeenCalledOnce());
  revision = 2;
  setPublisher.mock.calls[0]![0]();
  expect(mock.closeNotification).toHaveBeenCalledOnce();
  expect(mock.setTrayUnread).toHaveBeenCalledWith(false);
  mock.notifications[0]!.emit('click');
  expect(mock.showLauncher).not.toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-a' }));
});

it('does not notify from a delayed old account event after activation', async () => {
  const setInboxPublisher = vi.fn();
  const setPublisher = vi.fn();
  let revision = 1;
  let finishMember!: (id: string) => void;
  const session = { setPublisher, setInboxPublisher, setInboxStatePublisher: vi.fn(), restore: vi.fn(),
    inboxSessionRevision: () => revision,
    state: () => ({ status: 'signed-in', activeSubject: 'subject-a', selectedId: 'org-a', organizations: [{ id: 'org-a' }] }),
    registeredInboxMemberId: vi.fn(() => new Promise<string>((resolve) => { finishMember = resolve; })) };
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(setInboxPublisher).toHaveBeenCalledOnce());
  setInboxPublisher.mock.calls[0]![0]({ kind: 'CONVERSATIONS', tenantId: 'org-a', conversationId: 'conversation-a',
    action: 'ADD', memberId: 'member-b', memberName: 'Ana', participantRevision: 1 });
  await vi.waitFor(() => expect(finishMember).toBeTypeOf('function'));
  revision = 2;
  setPublisher.mock.calls[0]![0]();
  finishMember('member-a');
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(mock.showNotification).not.toHaveBeenCalled();
});

it('keeps a pending other-organization notification through a routine selection and membership refresh', async () => {
  const setInboxPublisher = vi.fn();
  const setPublisher = vi.fn();
  let selectedId = 'org-a';
  let finish!: (page: { items: { id: string; unreadCount: number }[]; total: number }) => void;
  const session = { setPublisher, setInboxPublisher, setInboxStatePublisher: vi.fn(), restore: vi.fn(),
    inboxSessionRevision: () => 1,
    state: () => ({ status: 'signed-in', activeSubject: 'subject-a', selectedId, organizations: [{ id: 'org-a' }, { id: 'org-b' }, { id: 'org-c' }] }),
    listOrganizationInboxConversations: vi.fn((id: string) => id === 'org-b'
      ? new Promise<{ items: { id: string; unreadCount: number }[]; total: number }>((resolve) => { finish = resolve; })
      : Promise.resolve({ items: [], total: 0 })) };
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(setInboxPublisher).toHaveBeenCalledOnce());
  setInboxPublisher.mock.calls[0]![0]({ tenantId: 'org-b', conversationId: 'conversation-b', messageId: 'message-b', status: 'AVAILABLE' });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  selectedId = 'org-c';
  setPublisher.mock.calls[0]![0]();
  finish({ items: [{ id: 'conversation-b', unreadCount: 1 }], total: 1 });
  await vi.waitFor(() => expect(mock.showNotification).toHaveBeenCalledOnce());
  expect(mock.showLauncher).not.toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-b' }));
});

it('retries an unconfirmed other-organization message and ignores its conversation signal in the UI', async () => {
  const setInboxPublisher = vi.fn();
  let unreadCount = 0;
  const session = { setPublisher: vi.fn(), setInboxPublisher, setInboxStatePublisher: vi.fn(), restore: vi.fn(),
    state: () => ({ status: 'signed-in', activeSubject: 'subject-a', selectedId: 'org-a', organizations: [{ id: 'org-a' }, { id: 'org-b' }] }),
    listOrganizationInboxConversations: vi.fn(async () => ({ items: [{ id: 'conversation-b', unreadCount }], total: 1 })) };
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(setInboxPublisher).toHaveBeenCalledOnce());
  const publish = setInboxPublisher.mock.calls[0]![0];
  publish({ kind: 'CONVERSATIONS', tenantId: 'org-b', conversationId: 'conversation-b' });
  const signal = { tenantId: 'org-b', conversationId: 'conversation-b', messageId: 'message-b', status: 'AVAILABLE' };
  publish(signal);
  await vi.waitFor(() => expect(session.listOrganizationInboxConversations).toHaveBeenCalled());
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(mock.showNotification).not.toHaveBeenCalled();
  unreadCount = 1;
  publish(signal);
  await vi.waitFor(() => expect(mock.showNotification).toHaveBeenCalledOnce());
  expect(mock.send).not.toHaveBeenCalledWith('tray:inbox-changed', expect.anything());
});

it('opens the notified conversation and dismisses its notice when read', async () => {
  let unreadCount = 1;
  const setInboxPublisher = vi.fn();
  const session = { setPublisher: vi.fn(), setInboxPublisher, setInboxStatePublisher: vi.fn(), restore: vi.fn(),
    state: () => ({ status: 'signed-in', activeSubject: 'subject-a', selectedId: 'org-a' }), registeredInboxMemberId: vi.fn(async () => 'member-a'),
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
  expect(mock.showLauncher).toHaveBeenLastCalledWith({ kind: 'OPEN_INBOX', organizationId: 'org-a', conversationId: 'conversation-1', accountSubject: 'subject-a' });
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
    state: () => ({ status: 'signed-in', activeSubject: 'subject-a', selectedId: 'org-a' }), registeredInboxMemberId: vi.fn(async () => 'member-a'),
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
    state: () => ({ status: 'signed-in', activeSubject: 'subject-a', selectedId: 'org-a' }), registeredInboxMemberId: vi.fn(async () => 'member-a'),
    listInboxMessages: vi.fn(async () => ({ items: [] })), listInboxParentMetadata };
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(setInboxPublisher).toHaveBeenCalledOnce());
  setInboxPublisher.mock.calls[0]![0]({ conversationId: 'conversation-1', messageId: 'parent-1', status: 'AVAILABLE' });
  await vi.waitFor(() => expect(mock.showNotification).toHaveBeenCalledOnce());
  expect(listInboxParentMetadata).toHaveBeenCalledWith('conversation-1');
  expect(mock.showNotification).toHaveBeenCalledWith(expect.objectContaining({ title: expect.any(String), body: 'You have a new Secure Chat message.' }));
});

it('finds normal-only messages after the mixed-parent metadata lookup misses', async () => {
  const setInboxPublisher = vi.fn();
  const listInboxParentMetadata = vi.fn(async () => ({ items: [], readThroughSequence: 1 }));
  const listNormalInboxMetadata = vi.fn(async () => ({ items: [{ parentId: 'normal-1', senderMemberId: 'other', sequence: 3 }],
    readThroughSequence: 1 }));
  const session = { clearRevealed: vi.fn(), setPublisher: vi.fn(), setInboxPublisher, setInboxStatePublisher: vi.fn(), restore: vi.fn(),
    state: () => ({ status: 'signed-in', activeSubject: 'subject-a', selectedId: 'org-a' }), registeredInboxMemberId: vi.fn(async () => 'member-a'),
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
    state: () => ({ status: 'signed-in', activeSubject: 'subject-a', selectedId: 'org-a' }), registeredInboxMemberId: vi.fn(async () => 'member-a') };
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(setInboxPublisher).toHaveBeenCalledOnce());
  const publish = setInboxPublisher.mock.calls[0]![0];
  publish({ conversationId: 'conversation-1', messageId: 'message-1', status: 'AVAILABLE', recipientStatus: 'CONSUMED',
    senderMemberId: 'member-a', memberId: 'member-b', memberName: 'Reader Name' });
  publish({ conversationId: 'conversation-1', messageId: 'message-2', status: 'FAILED', senderMemberId: 'member-a' });
  await vi.waitFor(() => expect(mock.showNotification).toHaveBeenCalledTimes(2));
  expect(mock.showNotification.mock.calls.map(([item]) => item.body)).toEqual([
    'Reader Name opened your Secure Chat message.', 'A Secure Chat message could not be sent.',
  ]);
});

it('notifies once for detailed conversation membership events only', async () => {
  const setInboxPublisher = vi.fn();
  const session = { clearRevealed: vi.fn(), setPublisher: vi.fn(), setInboxPublisher, setInboxStatePublisher: vi.fn(), restore: vi.fn(),
    state: () => ({ status: 'signed-in', activeSubject: 'subject-a', selectedId: 'org-a' }), registeredInboxMemberId: vi.fn(async () => 'member-a') };
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
    state: () => ({ status: 'signed-in', activeSubject: 'subject-a', selectedId: 'org-a' }), registeredInboxMemberId };
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
    state: () => ({ status: 'signed-in', activeSubject: 'subject-a', selectedId: 'org-a' }), registeredInboxMemberId: vi.fn(async () => 'member-a'),
    listInboxMessages: vi.fn(async () => ({ items: [{ id: 'message-1', senderMemberId: 'member-a', recipientStatus: 'UNREAD' }] })) };
  registerAppEvents(session as never, undefined, 'dev');
  await vi.waitFor(() => expect(setInboxPublisher).toHaveBeenCalledOnce());
  setInboxPublisher.mock.calls[0]![0]({ conversationId: 'conversation-1', messageId: 'message-1', status: 'AVAILABLE' });
  await vi.waitFor(() => expect(session.listInboxMessages).toHaveBeenCalledOnce());
  expect(mock.showNotification).not.toHaveBeenCalled();
});
