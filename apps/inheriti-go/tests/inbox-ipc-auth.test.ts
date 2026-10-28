import { beforeEach, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler) } }));
vi.mock('../src/modules/launcher/main/protected-checkpoint.js', () => ({ ProtectedCheckpoint: class {
  isAvailable() { return true; }
} }));

import { registerInboxIpc } from '../src/modules/inbox/main/ipc.js';
import { TrayInboxIdentity } from '../src/modules/inbox/main/identity.js';
import type { TraySession } from '../src/modules/launcher/main/state.js';

beforeEach(() => handlers.clear());

it.each([
  Object.assign(new Error('request_failed'), { status: 401 }),
  new Error('inbox_identity_http_401'),
  Object.assign(new Error('operator_token_expired'), { code: 'operator_token_expired' }),
])('signs out and publishes state on Secure Chat authentication expiry', async (error) => {
  const session = { listInboxConversations: vi.fn().mockRejectedValue(error), signOut: vi.fn().mockResolvedValue(undefined) };
  const publish = vi.fn();
  const publishInbox = vi.fn();
  registerInboxIpc(session as unknown as TraySession, vi.fn(), publishInbox, publish);

  await expect(handlers.get('tray:inbox-conversations')!({})).rejects.toBe(error);
  expect(session.signOut).toHaveBeenCalledOnce();
  expect(publish).toHaveBeenCalledOnce();
  expect(publishInbox).toHaveBeenCalledOnce();
});

it.each([Object.assign(new Error('forbidden'), { status: 403 }), new Error('network unavailable')])
  ('keeps the session on non-authentication Secure Chat failures', async (error) => {
    const session = { listInboxConversations: vi.fn().mockRejectedValue(error), signOut: vi.fn() };
    const publish = vi.fn();
    registerInboxIpc(session as unknown as TraySession, vi.fn(), undefined, publish);

    await expect(handlers.get('tray:inbox-conversations')!({})).rejects.toBe(error);
    expect(session.signOut).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

it('keeps the current session when a canceled Inbox preparation reports late token expiry', async () => {
  let rejectToken!: (error: Error) => void;
  const token = new Promise<string>((_resolve, reject) => { rejectToken = reject; });
  const identity = new TrayInboxIdentity('https://api.test/integrations/', 'TEST', () => token);
  const session = { prepareInbox: () => identity.prepare('org-a'), signOut: vi.fn() };
  registerInboxIpc(session as unknown as TraySession, vi.fn());

  const preparing = handlers.get('tray:inbox-prepare')!({});
  identity.cancelPreparation();
  rejectToken(Object.assign(new Error('operator_token_expired'), { code: 'operator_token_expired' }));
  await expect(preparing).resolves.toEqual({ status: 'missing' });
  expect(session.signOut).not.toHaveBeenCalled();
});

it('logs only safe file send failure metadata', async () => {
  const error = Object.assign(new Error('secret file contents'), { status: 503, code: 'secret', requestId: 'req_123', token: 'secret' });
  const session = { sendInboxFile: vi.fn().mockRejectedValue(error), signOut: vi.fn() };
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    registerInboxIpc(session as unknown as TraySession, vi.fn());
    const thrown = await Promise.resolve(handlers.get('tray:inbox-send-file')!({ sender: { isDestroyed: () => false } }, 'conversation', new Date().toISOString()))
      .then(() => undefined, failure => failure as Error);
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBe(error);
    expect(String(thrown)).not.toContain('secret');
    expect(thrown?.stack).not.toContain('secret');
    expect(log).toHaveBeenCalledWith('Secure Chat file send failed', { status: 503, code: undefined, requestId: 'req_123' });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret|conversation/);
  } finally { log.mockRestore(); }
});

it('passes the safe share upload failure code to the file composer', async () => {
  const session = { sendInboxFile: vi.fn().mockRejectedValue(new Error('inbox_share_upload_failed')) };
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    registerInboxIpc(session as unknown as TraySession, vi.fn());
    await expect(handlers.get('tray:inbox-send-file')!({ sender: { isDestroyed: () => false } }, 'conversation', new Date().toISOString()))
      .rejects.toThrow('inbox_share_upload_failed');
  } finally { log.mockRestore(); }
});
