import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FileOperatorSessionStore, SessionStoreUnreadable, defaultSessionPath } from '../src/session-store.js';

const session = {
  accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer' as const, expiresAt: Date.now() + 60_000,
  principal: {
    issuer: 'http://127.0.0.1:4564/realms/elements', audience: 'inheriti-elements-api',
    authorizedParty: 'elements-test-cli-device', environment: 'TEST' as const,
    subject: 'operator-1', sessionId: 'session-1', tokenId: 'token-1', scopes: ['plan:list'],
  },
};

async function storeInTemporaryDirectory(): Promise<{ store: FileOperatorSessionStore; path: string }> {
  const path = resolve(await mkdtemp(resolve(tmpdir(), 'elements-cli-')), 'session.json');
  return { store: new FileOperatorSessionStore(path), path };
}

describe('FileOperatorSessionStore', () => {
  it('preserves keys during token refresh and clears them when the login changes or ends', async () => {
    const { path } = await storeInTemporaryDirectory();
    const keys = { clear: vi.fn().mockResolvedValue(undefined) };
    const store = new FileOperatorSessionStore(path, keys);
    await store.save(session);
    await store.save(Object.assign({}, session, { accessToken: 'refreshed' }));
    expect(keys.clear).not.toHaveBeenCalled();
    await store.save(Object.assign({}, session, { principal: Object.assign({}, session.principal, { sessionId: 'new-login' }) }));
    expect(keys.clear).toHaveBeenCalledOnce();
    await store.clear();
    expect(keys.clear).toHaveBeenCalledTimes(2);
  });

  it('removes the login even when protected-key deletion fails', async () => {
    const { path } = await storeInTemporaryDirectory();
    const keys = { clear: vi.fn().mockRejectedValue(new Error('locked')) };
    const store = new FileOperatorSessionStore(path, keys);
    await store.save(session);
    await expect(store.clear()).rejects.toThrow('locked');
    await expect(readFile(path)).rejects.toBeTruthy();
  });
  it('is absent before the first login rather than failing', async () => {
    const { store } = await storeInTemporaryDirectory();
    await expect(store.load()).resolves.toBeUndefined();
  });

  it('reports an unreadable session instead of treating it as signed out', async () => {
    const { path } = await storeInTemporaryDirectory();
    await expect(new FileOperatorSessionStore(resolve(path, '..')).load())
      .rejects.toMatchObject({ code: 'session_file_unreadable' });
  });

  it('round-trips a session and writes it owner-only', async () => {
    const { store, path } = await storeInTemporaryDirectory();
    await store.save(session);
    await expect(store.load()).resolves.toMatchObject({ principal: { subject: 'operator-1' } });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('clears a corrupt session and fails closed instead of returning a partial one', async () => {
    const { store, path } = await storeInTemporaryDirectory();
    await store.save(session);
    await writeFile(path, '{ not json', { mode: 0o600 });
    await expect(store.load()).rejects.toBeInstanceOf(SessionStoreUnreadable);
    await expect(store.load()).resolves.toBeUndefined();
  });

  it('refuses and clears a session another user could read', async () => {
    const { store, path } = await storeInTemporaryDirectory();
    await store.save(session);
    await chmod(path, 0o644);
    await expect(store.load()).rejects.toMatchObject({ code: 'session_permissions_widened' });
    await expect(store.load()).resolves.toBeUndefined();
  });

  it('does not mistake Windows mode bits for POSIX owner permissions', async () => {
    const { store, path } = await storeInTemporaryDirectory();
    await store.save(session);
    await chmod(path, 0o644);
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
    try {
      Object.defineProperty(process, 'platform', { ...descriptor, value: 'win32' });
      await expect(store.load()).resolves.toMatchObject({ principal: { subject: 'operator-1' } });
      await expect(readFile(path)).resolves.toBeTruthy();
    } finally {
      Object.defineProperty(process, 'platform', descriptor);
    }
  });

  it('leaves nothing behind on logout', async () => {
    const { store, path } = await storeInTemporaryDirectory();
    await store.save(session);
    await store.clear();
    await expect(readFile(path, 'utf8')).rejects.toBeTruthy();
    await expect(store.clear()).resolves.toBeUndefined();
  });

  it('uses Inheriti state while preserving an existing login in the previous location', async () => {
    const home = await mkdtemp(resolve(tmpdir(), 'inheriti-state-'));
    const current = resolve(home, 'inheriti', 'session.json');
    const legacy = resolve(home, 'inheriti-elements', 'session.json');
    try {
      expect(defaultSessionPath({ XDG_STATE_HOME: home })).toBe(current);
      await mkdir(resolve(home, 'inheriti-elements'));
      await writeFile(legacy, '{}');
      expect(defaultSessionPath({ XDG_STATE_HOME: home })).toBe(legacy);
      await mkdir(resolve(home, 'inheriti'));
      await writeFile(current, '{}');
      expect(defaultSessionPath({ XDG_STATE_HOME: home })).toBe(current);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
    expect(defaultSessionPath({ INHERITI_ELEMENTS_STATE_DIR: '/tmp/elements' }))
      .toBe('/tmp/elements/session.json');
  });
});
