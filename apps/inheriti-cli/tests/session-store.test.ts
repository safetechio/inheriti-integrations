import { chmod, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
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
  it('is absent before the first login rather than failing', async () => {
    const { store } = await storeInTemporaryDirectory();
    await expect(store.load()).resolves.toBeUndefined();
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

  it('leaves nothing behind on logout', async () => {
    const { store, path } = await storeInTemporaryDirectory();
    await store.save(session);
    await store.clear();
    await expect(readFile(path, 'utf8')).rejects.toBeTruthy();
    await expect(store.clear()).resolves.toBeUndefined();
  });

  it('keeps state out of the working directory, under the operator’s own state home', () => {
    expect(defaultSessionPath({ XDG_STATE_HOME: '/home/op/.local/state' }))
      .toBe('/home/op/.local/state/inheriti-elements/session.json');
    expect(defaultSessionPath({ INHERITI_ELEMENTS_STATE_DIR: '/tmp/elements' }))
      .toBe('/tmp/elements/session.json');
  });
});
