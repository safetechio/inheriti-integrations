import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  createNodeInbox: vi.fn(),
  createNodeInboxEventListener: vi.fn(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/inheriti-go-test' },
  dialog: { showOpenDialog: mock.showOpenDialog, showSaveDialog: mock.showSaveDialog },
}));

vi.mock('@safetech/inheriti-elements-core/node', () => ({
  createNodeInboxEventListener: mock.createNodeInboxEventListener,
  suggestInboxTextAsset: (text: string) => ({ type: 'PLAIN-TEXT', text }),
}));

vi.mock('@safetech/inheriti-elements-core/inbox', () => ({ createNodeInbox: mock.createNodeInbox }));

import { TrayInbox } from '../src/modules/inbox/main/inbox.js';
import { TrayInboxIdentity } from '../src/modules/inbox/main/identity.js';

const identity = {
  tenantId: 'org-a',
  memberId: 'member-a',
  deviceId: 'device-a',
  encryptionPublicKey: '',
  encryptionPrivateKey: '',
  signingPublicKey: '',
  signingPrivateKey: '',
};

describe('Tray Secure Chat main process', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.createNodeInboxEventListener.mockReturnValue(() => {});
    mock.showSaveDialog.mockResolvedValue({ canceled: true });
  });

  it('forwards device changes as participant refresh signals for the selected organization', async () => {
    mock.createNodeInbox.mockReturnValue({ listConversations: vi.fn().mockResolvedValue({ items: [] }) });
    const onSignal = vi.fn();
    const inbox = new TrayInbox('https://api.test/integrations/', 'TEST', async () => 'token',
      async () => 'a'.repeat(64), () => 'org-a', onSignal);
    await inbox.listConversations();
    const onChange = mock.createNodeInboxEventListener.mock.calls[0]![2];
    onChange({ tenantId: 'org-a', kind: 'PARTICIPANTS' });
    onChange({ tenantId: 'org-b', kind: 'PARTICIPANTS' });
    expect(onSignal).toHaveBeenCalledExactlyOnceWith({ kind: 'PARTICIPANTS' });
  });

  it('includes the creator when starting a conversation from the member picker', async () => {
    const createConversation = vi.fn().mockResolvedValue({ id: 'conversation-a' });
    mock.createNodeInbox.mockReturnValue({ createConversation });
    vi.spyOn(TrayInboxIdentity.prototype, 'registeredMemberId').mockResolvedValueOnce('member-a');
    const inbox = new TrayInbox('https://api.test/integrations/', 'TEST', async () => 'token',
      async () => 'a'.repeat(64), () => 'org-a');
    await inbox.createConversation('Project handover', ['member-b']);
    expect(createConversation).toHaveBeenCalledExactlyOnceWith('Project handover', ['member-a', 'member-b']);
  });

  it('forwards conversation and recipient changes only for the selected organization', async () => {
    mock.createNodeInbox.mockReturnValue({ listConversations: vi.fn().mockResolvedValue({ items: [] }) });
    const onSignal = vi.fn();
    const inbox = new TrayInbox('https://api.test/integrations/', 'TEST', async () => 'token',
      async () => 'a'.repeat(64), () => 'org-a', onSignal);
    inbox.listen();
    const onChange = mock.createNodeInboxEventListener.mock.calls[0]![2];
    onChange({ tenantId: 'org-a', kind: 'CONVERSATIONS' });
    onChange({ tenantId: 'org-a', conversationId: 'conversation', messageId: 'message', status: 'AVAILABLE', recipientStatus: 'UNREAD' });
    onChange({ tenantId: 'org-b', kind: 'CONVERSATIONS' });
    expect(onSignal).toHaveBeenNthCalledWith(1, { kind: 'CONVERSATIONS' });
    expect(onSignal).toHaveBeenNthCalledWith(2, { conversationId: 'conversation', messageId: 'message',
      status: 'AVAILABLE', recipientStatus: 'UNREAD' });
    expect(onSignal).toHaveBeenCalledTimes(2);
  });

  it('aborts a pending native picker before any file upload after hide and organization switch', async () => {
    let resolvePicker!: (value: { canceled: boolean; filePaths: string[] }) => void;
    mock.showOpenDialog.mockReturnValue(new Promise((resolve) => { resolvePicker = resolve; }));
    const client = { sendFile: vi.fn() };
    mock.createNodeInbox.mockReturnValue(client);
    let selectedOrganization = 'org-a';
    const inbox = new TrayInbox('https://api.test/integrations/', 'TEST', async () => 'token',
      async () => 'a'.repeat(64), () => selectedOrganization);

    const sending = inbox.sendFile('conversation', '2030-01-01T00:00:00.000Z');
    await vi.waitFor(() => expect(mock.showOpenDialog).toHaveBeenCalledOnce());
    selectedOrganization = 'org-b';
    inbox.hide();
    resolvePicker({ canceled: false, filePaths: ['/tmp/secret.txt'] });

    await expect(sending).rejects.toMatchObject({ name: 'AbortError' });
    expect(client.sendFile).not.toHaveBeenCalled();
  });

  it('retains a file lease when ACK is pending and retries it from the cached lease', async () => {
    const client = {
      openFile: vi.fn().mockResolvedValue({
        name: 'secret.txt', mimeType: 'text/plain', size: 6,
        leaseId: 'lease-1', leaseExpiresAt: '2030-01-01T00:01:00.000Z', acknowledgement: 'PENDING',
      }),
      ackText: vi.fn().mockResolvedValueOnce('PENDING').mockResolvedValueOnce('ACKNOWLEDGED'),
    };
    mock.createNodeInbox.mockReturnValue(client);
    vi.spyOn(TrayInboxIdentity.prototype, 'withIdentity').mockImplementation(async (_organizationId, run) =>
      run(identity, new AbortController().signal));
    const inbox = new TrayInbox('https://api.test/integrations/', 'TEST', async () => 'token',
      async () => 'a'.repeat(64), () => 'org-a');

    await expect(inbox.openFile('conversation', 'message')).resolves.toMatchObject({ acknowledgement: 'PENDING' });
    inbox.hide();
    await expect(inbox.retryAck('conversation', 'message')).resolves.toEqual({ acknowledgement: 'PENDING' });
    await expect(inbox.retryAck('conversation', 'message')).resolves.toEqual({ acknowledgement: 'ACKNOWLEDGED' });
    expect(client.ackText).toHaveBeenNthCalledWith(1, {
      conversationId: 'conversation', messageId: 'message', deviceId: 'device-a', leaseId: 'lease-1', signal: expect.any(AbortSignal),
    });
    expect(client.ackText).toHaveBeenNthCalledWith(2, {
      conversationId: 'conversation', messageId: 'message', deviceId: 'device-a', leaseId: 'lease-1', signal: expect.any(AbortSignal),
    });
  });

  it('hands a protected file to Quick Plan in memory and retains its ACK lease', async () => {
    const source = new Uint8Array([1, 2, 3]);
    const client = {
      openFile: vi.fn().mockImplementation(async ({ save }) => {
        await save({ name: 'secret.pdf', mimeType: 'application/pdf', bytes: source });
        return { leaseId: 'lease-2', acknowledgement: 'PENDING' };
      }),
      ackText: vi.fn().mockResolvedValue('ACKNOWLEDGED'),
    };
    mock.createNodeInbox.mockReturnValue(client);
    vi.spyOn(TrayInboxIdentity.prototype, 'withIdentity').mockImplementation(async (_organizationId, run) =>
      run(identity, new AbortController().signal));
    const inbox = new TrayInbox('https://api.test/integrations/', 'TEST', async () => 'token',
      async () => 'a'.repeat(64), () => 'org-a');

    const opening = inbox.openFileForPlan('conversation', 'message', (file) => {
      expect(file.name).toBe('secret.pdf');
      expect(file.bytes).toEqual(source);
      inbox.acceptFileForPlan('conversation', 'message');
    });
    const opened = await opening;
    source.fill(0);
    expect(opened).toEqual({ acknowledgement: 'PENDING' });
    expect(mock.showSaveDialog).not.toHaveBeenCalled();
    await expect(inbox.retryAck('conversation', 'message')).resolves.toEqual({ acknowledgement: 'ACKNOWLEDGED' });
  });

  it('releases a file lease if the renderer closes before accepting it', async () => {
    const releaseInboxMessage = vi.fn().mockResolvedValue(undefined);
    mock.createNodeInbox.mockReturnValue({
      openFile: vi.fn().mockImplementation(async ({ save }) => {
        try { await save({ name: 'secret.txt', mimeType: 'text/plain', bytes: new Uint8Array([1]) }); }
        catch (error) { await releaseInboxMessage(); throw error; }
      }),
    });
    vi.spyOn(TrayInboxIdentity.prototype, 'withIdentity').mockImplementation(async (_organizationId, run) =>
      run(identity, new AbortController().signal));
    const inbox = new TrayInbox('https://api.test/integrations/', 'TEST', async () => 'token',
      async () => 'a'.repeat(64), () => 'org-a');
    const opening = inbox.openFileForPlan('conversation', 'message', () => inbox.hide());
    await expect(opening).rejects.toBeTruthy();
    expect(releaseInboxMessage).toHaveBeenCalledOnce();
  });

  it('times out when the renderer never accepts a file', async () => {
    vi.useFakeTimers();
    try {
      const client = { openFile: vi.fn().mockImplementation(async ({ save }) => {
        await save({ name: 'secret.txt', mimeType: 'text/plain', bytes: new Uint8Array([1]) });
      }) };
      mock.createNodeInbox.mockReturnValue(client);
      vi.spyOn(TrayInboxIdentity.prototype, 'withIdentity').mockImplementation(async (_organizationId, run) =>
        run(identity, new AbortController().signal));
      const inbox = new TrayInbox('https://api.test/integrations/', 'TEST', async () => 'token',
        async () => 'a'.repeat(64), () => 'org-a');
      const delivered = vi.fn();
      const opening = inbox.openFileForPlan('conversation', 'message', delivered);
      await vi.waitFor(() => expect(delivered).toHaveBeenCalledOnce());
      const rejection = expect(opening).rejects.toThrow('inbox_file_accept_timeout');
      await vi.advanceTimersByTimeAsync(15_000);
      await rejection;
    } finally { vi.useRealTimers(); }
  });

  it('sends ordered mixed segments and keeps independent unit ACK leases', async () => {
    const client = {
      sendParent: vi.fn().mockResolvedValue({ parentId: 'parent-1' }),
      revealUnit: vi.fn().mockImplementation(async ({ unitId }: { unitId: string }) => ({
        text: unitId, leaseId: `lease-${unitId}`, acknowledgement: 'PENDING',
      })),
      ackText: vi.fn().mockResolvedValue('ACKNOWLEDGED'),
    };
    mock.createNodeInbox.mockReturnValue(client);
    vi.spyOn(TrayInboxIdentity.prototype, 'withIdentity').mockImplementation(async (_organizationId, run) =>
      run(identity, new AbortController().signal));
    const resolveKey = vi.fn().mockResolvedValue('a'.repeat(64));
    const inbox = new TrayInbox('https://api.test/integrations/', 'TEST', async () => 'token', resolveKey, () => 'org-a');
    const segments = [{ text: 'Hello ' }, { protectedText: 'secret', expiresAt: '2030-01-01T00:00:00.000Z' }];
    await inbox.sendParent('conversation', 'parent-1', segments);
    expect(client.sendParent).toHaveBeenCalledWith({ conversationId: 'conversation', parentId: 'parent-1',
      segments, identity, tenantKeyHex: 'a'.repeat(64), signal: expect.any(AbortSignal) });
    await inbox.revealUnit('conversation', 'parent-1', 'unit-a');
    await inbox.revealUnit('conversation', 'parent-1', 'unit-b');
    expect(await inbox.retryAck('conversation', 'unit-a')).toEqual({ acknowledgement: 'ACKNOWLEDGED' });
    expect(await inbox.retryAck('conversation', 'unit-b')).toEqual({ acknowledgement: 'ACKNOWLEDGED' });
    expect(resolveKey).toHaveBeenCalledTimes(3);
  });

  it('opens normal history and retries a normal send without resolving the organization key', async () => {
    const client = {
      listNormal: vi.fn().mockResolvedValue({ items: [{ parentId: 'parent-1', sequence: 4,
        senderMemberId: 'member-a', senderDeviceId: 'device-a', participantRevision: 1,
        createdAt: '2026-10-05T00:00:00.000Z' }], total: 1, limit: 25, offset: 0,
        unreadCount: 1, readThroughSequence: 0 }),
      openNormal: vi.fn().mockResolvedValue({ text: 'hello', parentId: 'parent-1', sequence: 4 }),
      markNormalRead: vi.fn().mockResolvedValue({ readThroughSequence: 4 }),
      sendNormal: vi.fn().mockRejectedValueOnce(new Error('network_lost')).mockResolvedValueOnce({ parentId: 'parent-2' }),
    };
    mock.createNodeInbox.mockReturnValue(client);
    vi.spyOn(TrayInboxIdentity.prototype, 'withIdentity').mockImplementation(async (_organizationId, run) =>
      run(identity, new AbortController().signal));
    const resolveKey = vi.fn();
    const inbox = new TrayInbox('https://api.test/integrations/', 'TEST', async () => 'token',
      resolveKey, () => 'org-a');
    await expect(inbox.listNormal('conversation')).resolves.toMatchObject({
      items: [{ parentId: 'parent-1', text: 'hello' }], unreadCount: 0, readThroughSequence: 4,
    });
    await expect(inbox.sendNormal('conversation', 'parent-2', 'retry')).rejects.toThrow('network_lost');
    await expect(inbox.sendNormal('conversation', 'parent-2', 'retry')).resolves.toMatchObject({ parentId: 'parent-2' });
    expect(mock.createNodeInbox).toHaveBeenCalledOnce();
    expect(resolveKey).not.toHaveBeenCalled();
    expect(client.sendNormal).toHaveBeenNthCalledWith(2, { conversationId: 'conversation', parentId: 'parent-2', text: 'retry', identity });
  });
});
