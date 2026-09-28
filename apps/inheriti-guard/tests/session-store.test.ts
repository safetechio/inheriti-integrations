import { describe, expect, it } from 'vitest';
import { MASTER_KEY_CACHE_PREFIX } from '../src/shared/stored-configuration.js';
import { SessionStorageOperatorSessionStore } from '../src/background/session-store.js';

const session = {
  accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer' as const, expiresAt: Date.now() + 60_000,
  principal: {
    issuer: 'http://127.0.0.1:4564/realms/elements', audience: 'inheriti-elements-api',
    authorizedParty: 'elements-test-chrome', environment: 'TEST' as const,
    subject: 'operator-1', sessionId: 'session-1', tokenId: 'token-1', scopes: ['plan:list'],
  },
};

function sessionArea() {
  const values = new Map<string, unknown>();
  const area = {
    get: async (keys: string | string[] | null) => keys === null ? Object.fromEntries(values)
      : Object.fromEntries((typeof keys === 'string' ? [keys] : keys).filter((key) => values.has(key)).map((key) => [key, values.get(key)])),
    set: async (entries: Record<string, unknown>) => { for (const [k, v] of Object.entries(entries)) values.set(k, v); },
    remove: async (keys: string | string[]) => { for (const key of typeof keys === 'string' ? [keys] : keys) values.delete(key); },
  } as unknown as chrome.storage.StorageArea;
  return { area, values };
}

describe('SessionStorageOperatorSessionStore', () => {
  it('is absent before the first sign-in', async () => {
    await expect(new SessionStorageOperatorSessionStore(sessionArea().area).load()).resolves.toBeUndefined();
  });

  it('round-trips a session under one key', async () => {
    const { area, values } = sessionArea();
    const store = new SessionStorageOperatorSessionStore(area);
    await store.save(session);
    expect(await store.load()).toEqual(session);
    expect([...values.keys()]).toEqual(['inheriti.operatorSessionGeneration', 'inheriti.operatorSession']);
  });

  it('discards an unreadable value rather than trusting half a credential', async () => {
    const { area, values } = sessionArea();
    const store = new SessionStorageOperatorSessionStore(area);
    await store.save(session);
    values.set('inheriti.operatorSession', '{ not json');
    await expect(store.load()).resolves.toBeUndefined();
    expect([...values.keys()]).toEqual(['inheriti.operatorSessionGeneration']);
  });

  it('retains cached keys on refresh but clears them for a different login', async () => {
    const { area, values } = sessionArea();
    const store = new SessionStorageOperatorSessionStore(area);
    await store.save(session);
    values.set(MASTER_KEY_CACHE_PREFIX + 'org-a', 'a'.repeat(64));
    values.set(MASTER_KEY_CACHE_PREFIX + 'org-b', 'b'.repeat(64));
    const generation = (await store.snapshot()).generation;
    const refreshed = JSON.parse(JSON.stringify(session));
    refreshed.accessToken = 'new-access';
    refreshed.principal.tokenId = 'new-token';
    await store.save(refreshed);
    expect((await store.snapshot()).generation).toBe(generation);
    expect(values.has(MASTER_KEY_CACHE_PREFIX + 'org-a')).toBe(true);
    expect(values.has(MASTER_KEY_CACHE_PREFIX + 'org-b')).toBe(true);
    refreshed.principal.sessionId = 'different-login';
    await store.save(refreshed);
    expect((await store.snapshot()).generation).toBeGreaterThan(generation);
    expect(values.has(MASTER_KEY_CACHE_PREFIX + 'org-a')).toBe(false);
    expect(values.has(MASTER_KEY_CACHE_PREFIX + 'org-b')).toBe(false);
    expect(await store.load()).toEqual(refreshed);
  });

  it('leaves nothing behind on sign-out', async () => {
    const { area, values } = sessionArea();
    const store = new SessionStorageOperatorSessionStore(area);
    await store.save(session);
    values.set(MASTER_KEY_CACHE_PREFIX + 'org-a', 'a'.repeat(64));
    values.set(MASTER_KEY_CACHE_PREFIX + 'org-b', 'b'.repeat(64));
    await store.clear();
    expect([...values.keys()]).toEqual(['inheriti.operatorSessionGeneration']);
  });
});
