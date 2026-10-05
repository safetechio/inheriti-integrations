import { expect, it, vi } from 'vitest';
import { shell } from 'electron';

const mock = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(), notify: vi.fn() }));

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.5' },
  ipcMain: { handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => mock.handlers.set(name, handler) },
  shell: { openExternal: vi.fn() },
}));
vi.mock('../src/modules/quick-plan/main/quick-plan-input.js', () => ({ parseQuickPlanInput: (input: unknown) => input }));

import { registerTrayIpc } from '../src/modules/launcher/main/ipc.js';

it('shows the installed version only to the trusted Tray renderer', () => {
  const frame = {};
  const webContents = { mainFrame: frame };
  registerTrayIpc({} as never, () => ({ webContents }) as never, vi.fn());
  const version = mock.handlers.get('tray:version')!;
  expect(() => version({ sender: webContents, senderFrame: {} })).toThrow();
  expect(version({ sender: webContents, senderFrame: frame })).toBe('0.0.5');
});

it('notifies only after confirmed protection or update using generic text', async () => {
  const frame = {};
  const webContents = { mainFrame: frame };
  const event = { sender: webContents, senderFrame: frame };
  let creationStatus = 'error';
  let editStatus = 'recovery-required';
  const session = {
    state: () => ({ creation: { status: creationStatus }, edit: { status: editStatus } }),
    createQuickPlan: vi.fn(), addPlanAsset: vi.fn(), replacePlanAsset: vi.fn(), recoverPlanEdit: vi.fn(),
  };
  registerTrayIpc(session as never, () => ({ webContents }) as never, vi.fn(), undefined, mock.notify);
  const create = mock.handlers.get('tray:create-quick-plan')!;
  const add = mock.handlers.get('tray:add-plan-asset')!;
  const replace = mock.handlers.get('tray:replace-plan-asset')!;
  const recover = mock.handlers.get('tray:recover-plan-edit')!;
  await create(event, { title: 'Private', asset: { secret: 'do not notify' } });
  await add(event, 'plan-1', { secret: 'do not notify' });
  await replace(event, 'plan-1', 'asset-1', { secret: 'do not notify' });
  await recover(event);
  expect(mock.notify).not.toHaveBeenCalled();
  creationStatus = 'ready';
  editStatus = 'updated';
  await create(event, { title: 'Private', asset: { secret: 'do not notify' } });
  await add(event, 'plan-1', { secret: 'do not notify' });
  await replace(event, 'plan-1', 'asset-1', { secret: 'do not notify' });
  await recover(event);
  expect(mock.notify.mock.calls).toEqual([
    ['Plan protected'], ['Plan updated'], ['Plan updated'], ['Plan updated'],
  ]);
});

it('opens the completed backup plan in Business', async () => {
  const frame = {};
  const webContents = { mainFrame: frame };
  const event = { sender: webContents, senderFrame: frame };
  const session = { state: () => ({ creation: { status: 'ready', planId: 'plan-1' } }) };
  registerTrayIpc(session as never, () => ({ webContents }) as never, vi.fn(), 'https://business.example/');
  const open = mock.handlers.get('tray:open-app')!;
  await open(event, 'plan-1');
  expect(shell.openExternal).toHaveBeenCalledWith('https://business.example/organization/plans/backup/plan-1');
  expect(() => open(event, 'another-plan')).toThrow('Plan is no longer available.');
});

it('opens an updated backup plan in Business', async () => {
  const frame = {};
  const webContents = { mainFrame: frame };
  const event = { sender: webContents, senderFrame: frame };
  const session = { state: () => ({ edit: { status: 'updated', planId: 'edited-plan' } }) };
  registerTrayIpc(session as never, () => ({ webContents }) as never, vi.fn(), 'https://business.example/');
  await mock.handlers.get('tray:open-app')!(event, 'edited-plan');
  expect(shell.openExternal).toHaveBeenCalledWith('https://business.example/organization/plans/backup/edited-plan');
});

it('returns Inbox plaintext only through a trusted explicit open', async () => {
  const frame = {};
  const webContents = { mainFrame: frame };
  const event = { sender: webContents, senderFrame: frame };
  const openInboxText = vi.fn(async () => ({ text: 'secret', leaseId: 'lease', leaseExpiresAt: 'later' }));
  registerTrayIpc({ openInboxText } as never, () => ({ webContents }) as never, vi.fn());
  const open = mock.handlers.get('tray:inbox-open-text')!;
  expect(() => open({ sender: webContents, senderFrame: {} }, 'conversation', 'message')).toThrow();
  expect(openInboxText).not.toHaveBeenCalled();
  expect(await open(event, 'conversation', 'message')).toEqual({ text: 'secret', leaseId: 'lease', leaseExpiresAt: 'later' });
  expect(openInboxText).toHaveBeenCalledWith('conversation', 'message');
});

it('passes a bounded Inbox member search to the selected session', async () => {
  const frame = {};
  const webContents = { mainFrame: frame };
  const event = { sender: webContents, senderFrame: frame };
  const listInboxParticipants = vi.fn(async () => ({ items: [] }));
  registerTrayIpc({ listInboxParticipants } as never, () => ({ webContents }) as never, vi.fn());
  const search = mock.handlers.get('tray:inbox-participants')!;
  await search(event, 'Ada');
  expect(listInboxParticipants).toHaveBeenCalledWith({ q: 'Ada' });
  expect(() => search(event, 'x'.repeat(101))).toThrow('Invalid Secure Chat search');
});

it('creates an Inbox conversation with a bounded, unique member selection', async () => {
  const frame = {};
  const webContents = { mainFrame: frame };
  const event = { sender: webContents, senderFrame: frame };
  const createInboxConversation = vi.fn(async () => ({ id: 'conversation' }));
  registerTrayIpc({ createInboxConversation } as never, () => ({ webContents }) as never, vi.fn());
  const create = mock.handlers.get('tray:inbox-create-conversation')!;
  expect(() => create({ sender: webContents, senderFrame: {} }, 'Test', ['a'])).toThrow();
  expect(() => create(event, '', ['a'])).toThrow('Invalid Secure Chat title');
  expect(() => create(event, 'Test', [])).toThrow('Invalid Secure Chat participants');
  expect(() => create(event, 'Test', ['a', 'a'])).toThrow('Invalid Secure Chat participants');
  expect(() => create(event, 'Test', Array.from({ length: 50 }, (_, index) => String(index)))).toThrow('Invalid Secure Chat participants');
  expect(() => create(event, 'Test', ['a', ''])).toThrow('Invalid Secure Chat identifier');
  await expect(create(event, ' Test ', ['a', 'b'])).resolves.toEqual({ id: 'conversation' });
  expect(createInboxConversation).toHaveBeenCalledWith('Test', ['a', 'b']);
});

it('retries a pending Inbox ACK only for a trusted renderer', async () => {
  const frame = {};
  const webContents = { mainFrame: frame };
  const event = { sender: webContents, senderFrame: frame };
  const retryInboxAck = vi.fn(async () => ({ acknowledgement: 'PENDING' }));
  const hideInboxText = vi.fn();
  registerTrayIpc({ retryInboxAck, hideInboxText } as never, () => ({ webContents }) as never, vi.fn());
  const retry = mock.handlers.get('tray:inbox-retry-ack')!;
  expect(() => retry({ sender: webContents, senderFrame: {} }, 'conversation', 'message')).toThrow();
  await expect(retry(event, 'conversation', 'message')).resolves.toEqual({ acknowledgement: 'PENDING' });
  expect(retryInboxAck).toHaveBeenCalledWith('conversation', 'message');
  expect(() => retry(event, '', 'message')).toThrow('Invalid Secure Chat identifier');
  await mock.handlers.get('tray:inbox-hide-text')!(event);
  expect(hideInboxText).toHaveBeenCalledOnce();
});

it('clears only the selected conversation for a trusted renderer', async () => {
  const frame = {};
  const webContents = { mainFrame: frame };
  const event = { sender: webContents, senderFrame: frame };
  const clearInboxHistory = vi.fn(async () => ({ clearedThroughSequence: 7 }));
  registerTrayIpc({ clearInboxHistory } as never, () => ({ webContents }) as never, vi.fn());
  const clear = mock.handlers.get('tray:inbox-clear-history')!;
  expect(() => clear({ sender: webContents, senderFrame: {} }, 'conversation')).toThrow();
  expect(() => clear(event, '')).toThrow('Invalid Secure Chat identifier');
  await expect(clear(event, 'conversation')).resolves.toEqual({ clearedThroughSequence: 7 });
  expect(clearInboxHistory).toHaveBeenCalledWith('conversation');
});


it('requires the trusted renderer for explicit Secure Chat device replacement', async () => {
  const frame = {};
  const webContents = { mainFrame: frame };
  const replaceInboxDevice = vi.fn(async () => ({ status: 'ready' }));
  registerTrayIpc({ replaceInboxDevice } as never, () => ({ webContents }) as never, vi.fn());
  const replace = mock.handlers.get('tray:inbox-replace-device')!;
  await expect(replace({ sender: webContents, senderFrame: {} })).rejects.toThrow('Untrusted renderer');
  expect(replaceInboxDevice).not.toHaveBeenCalled();
  await expect(replace({ sender: webContents, senderFrame: frame })).resolves.toEqual({ status: 'ready' });
  expect(replaceInboxDevice).toHaveBeenCalledOnce();
});

it('validates ordered parent segments and unit reveal at the trusted IPC boundary', () => {
  const frame = {};
  const webContents = { mainFrame: frame };
  const event = { sender: webContents, senderFrame: frame };
  const sendInboxParent = vi.fn();
  const revealInboxUnit = vi.fn();
  registerTrayIpc({ sendInboxParent, revealInboxUnit } as never, () => ({ webContents }) as never, vi.fn());
  const send = mock.handlers.get('tray:inbox-send-parent')!;
  const reveal = mock.handlers.get('tray:inbox-reveal-unit')!;
  const segments = [{ text: 'Hello ' }, { protectedText: 'secret', expiresAt: '2030-01-01T00:00:00.000Z' }];
  expect(() => send({ sender: webContents, senderFrame: {} }, 'conversation', 'parent', segments)).toThrow('Untrusted renderer');
  expect(() => send(event, 'conversation', 'parent', [{ text: 'plain', protectedText: 'secret', expiresAt: '2030-01-01T00:00:00.000Z' }])).toThrow('Invalid Secure Chat segment');
  expect(() => send(event, 'conversation', 'parent', Array(5).fill(segments[1]))).toThrow('Invalid Secure Chat segments');
  send(event, 'conversation', 'parent', segments);
  expect(sendInboxParent).toHaveBeenCalledWith('conversation', 'parent', segments);
  expect(() => reveal({ sender: webContents, senderFrame: {} }, 'conversation', 'parent', 'unit')).toThrow('Untrusted renderer');
  reveal(event, 'conversation', 'parent', 'unit');
  expect(revealInboxUnit).toHaveBeenCalledWith('conversation', 'parent', 'unit');
});
