import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  createNodeInbox: vi.fn(),
  createNodeInboxEventListener: vi.fn(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/inheriti-tray-test' },
  dialog: { showOpenDialog: mock.showOpenDialog, showSaveDialog: mock.showSaveDialog },
}));

vi.mock('@safetech/inheriti-elements-core/node', () => ({
  createNodeInbox: mock.createNodeInbox,
  createNodeInboxEventListener: mock.createNodeInboxEventListener,
}));

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

describe('Tray Secure Inbox main process', () => {
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
    await inbox.createConversation(['member-b']);
    expect(createConversation).toHaveBeenCalledExactlyOnceWith(['member-a', 'member-b']);
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
});
