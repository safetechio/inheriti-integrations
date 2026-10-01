import { beforeEach, describe, expect, it, vi } from 'vitest';

const stored = new Map<string, unknown>();
vi.mock('electron', () => ({ app: { getPath: () => '/test/tray' } }));
vi.mock('../src/modules/launcher/main/protected-checkpoint.js', () => ({
  ProtectedCheckpoint: class {
    isAvailable() { return true; }
    getItem(path: string) { return stored.get(path) ?? null; }
    setItem(path: string, value: unknown) { stored.set(path, value); }
  },
}));

import { TrayInboxIdentity } from '../src/modules/inbox/main/identity.js';

const token = (sid: string) => `header.${Buffer.from(JSON.stringify({ iss: 'https://issuer.test', sub: 'user-1', sid })).toString('base64url')}.signature`;
const envelope = (result?: unknown) => ({ ok: true, result });

describe('Tray Inbox identity', () => {
  beforeEach(() => { stored.clear(); vi.restoreAllMocks(); });

  it('restores the same device keys across logins and never sends private material', async () => {
    let registered: { signingPublicKey: string; encryptionPublicKey: string } | undefined;
    const fetcher = vi.fn().mockImplementation(async (_url, init: RequestInit) => {
      if (init.method === 'GET') return { ok: true, json: async () => envelope(registered ? {
        status: 'ACTIVE',
        signingKeyFingerprint: (await import('node:crypto')).createHash('sha256').update(Buffer.from(registered.signingPublicKey, 'base64')).digest('hex'),
      } : undefined) };
      registered = JSON.parse(String(init.body));
      return { ok: true, json: async () => envelope({}) };
    });
    vi.stubGlobal('fetch', fetcher);
    const resolveKey = vi.fn().mockResolvedValue('organization-key');
    const first = new TrayInboxIdentity('https://api.test/integrations/', 'TEST', async () => token('login-a'), resolveKey);
    expect(await first.prepare('org-1')).toEqual({ status: 'ready' });
    expect(registered).toEqual({ encryptionPublicKey: expect.any(String), signingPublicKey: expect.any(String) });
    expect(JSON.stringify(registered)).not.toContain('Private');
    const second = new TrayInboxIdentity('https://api.test/integrations/', 'TEST', async () => token('login-b'), resolveKey);
    expect(await second.prepare('org-1')).toEqual({ status: 'ready' });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(stored.size).toBe(1);
    expect(resolveKey).toHaveBeenCalledTimes(2);
  });

  it('refuses an active remote identity without matching local private keys', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => envelope({ status: 'ACTIVE', signingKeyFingerprint: 'other' }) }));
    const identity = new TrayInboxIdentity('https://api.test/integrations/', 'TEST', async () => token('login-a'));
    expect(await identity.prepare('org-1')).toMatchObject({ status: 'error' });
    expect(stored.size).toBe(0);
  });

  it('does not register or access the organization key after revocation', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => envelope({ status: 'REVOKED', signingKeyFingerprint: 'other' }) });
    const resolveKey = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const identity = new TrayInboxIdentity('https://api.test/integrations/', 'TEST', async () => token('login-a'), resolveKey);
    expect(await identity.prepare('org-1')).toEqual({ status: 'error', message: 'This Inbox identity was revoked. Replace it to use Secure Inbox on this device.' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(resolveKey).not.toHaveBeenCalled();
    expect(stored.size).toBe(0);
  });

  it('does not resolve the organization key when a pending lookup finishes after clear', async () => {
    let finishLookup!: (response: { ok: boolean; json: () => Promise<unknown> }) => void;
    const fetcher = vi.fn().mockReturnValue(new Promise((resolve) => { finishLookup = resolve; }));
    const resolveKey = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const identity = new TrayInboxIdentity('https://api.test/integrations/', 'TEST', async () => token('login-a'), resolveKey);
    const preparing = identity.prepare('org-1');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    identity.clear();
    finishLookup({ ok: true, json: async () => envelope({ status: 'ACTIVE', signingKeyFingerprint: 'other' }) });
    expect(await preparing).toEqual({ status: 'missing' });
    expect(resolveKey).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('allows an immediate new-organization request without old cleanup clearing it', async () => {
    const finish: Array<(response: { ok: boolean; json: () => Promise<unknown> }) => void> = [];
    const fetcher = vi.fn().mockImplementation(() => new Promise((resolve) => { finish.push(resolve); }));
    const resolveKey = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const identity = new TrayInboxIdentity('https://api.test/integrations/', 'TEST', async () => token('login-a'), resolveKey);
    const oldRequest = identity.prepare('org-1');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    identity.clear();
    const newRequest = identity.prepare('org-2');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    finish[0]!({ ok: true, json: async () => envelope(null) });
    expect(await oldRequest).toEqual({ status: 'preparing' });
    expect(identity.prepare('org-2')).toBe(newRequest);
    finish[1]!({ ok: true, json: async () => envelope(null) });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    finish[2]!({ ok: true, json: async () => envelope({ status: 'ACTIVE' }) });
    expect(await newRequest).toEqual({ status: 'ready' });
    expect(resolveKey).toHaveBeenCalledTimes(1);
    expect(resolveKey).toHaveBeenCalledWith('org-2', expect.any(AbortSignal));
  });
});
