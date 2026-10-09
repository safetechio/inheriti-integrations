import { beforeEach, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler) } }));

import { registerInboxIpc } from '../src/modules/inbox/main/ipc.js';
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
