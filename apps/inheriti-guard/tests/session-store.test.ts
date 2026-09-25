import { describe, expect, it } from 'vitest';
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
  const values = new Map<string, string>();
  const area = {
    get: async (key: string) => (values.has(key) ? { [key]: values.get(key) } : {}),
    set: async (entries: Record<string, string>) => { for (const [k, v] of Object.entries(entries)) values.set(k, v); },
    remove: async (key: string) => { values.delete(key); },
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
    expect([...values.keys()]).toEqual(['inheriti.operatorSession']);
  });

  it('discards an unreadable value rather than trusting half a credential', async () => {
    const { area, values } = sessionArea();
    const store = new SessionStorageOperatorSessionStore(area);
    await store.save(session);
    values.set('inheriti.operatorSession', '{ not json');
    await expect(store.load()).resolves.toBeUndefined();
    expect(values.size).toBe(0);
  });

  it('leaves nothing behind on sign-out', async () => {
    const { area, values } = sessionArea();
    const store = new SessionStorageOperatorSessionStore(area);
    await store.save(session);
    await store.clear();
    expect(values.size).toBe(0);
  });
});
