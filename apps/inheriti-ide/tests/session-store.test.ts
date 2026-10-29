import type { SecretStorage } from 'vscode';
import { describe, expect, it } from 'vitest';
import { SecretSessionStore } from '../src/session-store.js';

const session = {
  accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer' as const, expiresAt: Date.now() + 60_000,
  principal: {
    issuer: 'http://127.0.0.1:4564/realms/elements', audience: 'inheriti-elements-api',
    authorizedParty: 'elements-test-vscode', environment: 'TEST' as const,
    subject: 'operator-1', sessionId: 'session-1', tokenId: 'token-1', scopes: ['plan:list'],
  },
};

function secretStorage(): { secrets: SecretStorage; values: Map<string, string> } {
  const values = new Map<string, string>();
  const secrets = {
    get: (key: string) => Promise.resolve(values.get(key)),
    store: (key: string, value: string) => { values.set(key, value); return Promise.resolve(); },
    delete: (key: string) => { values.delete(key); return Promise.resolve(); },
  } as unknown as SecretStorage;
  return { secrets, values };
}

describe('SecretSessionStore', () => {
  it('keeps a matching Business session and clears a session from another client', async () => {
    const { secrets, values } = secretStorage();
    const config = { apiUrl: 'https://business.example/', business: true, issuer: session.principal.issuer,
      clientId: session.principal.authorizedParty, environment: 'TEST' as const,
      redirectUri: 'vscode://callback', scopes: ['openid'] };
    const stored = { ...session, principal: { ...session.principal, audience: 'inheriti-integrations-api' },
      kind: 'business' as const, familyId: 'family-1', sessionExpiresAt: Date.now() + 3_600_000 };
    const current = new SecretSessionStore(secrets, () => config);
    await current.save(stored);
    await expect(current.load()).resolves.toEqual(stored);
    const changed = new SecretSessionStore(secrets, () => ({ ...config, clientId: 'another-client' }));
    await expect(changed.load()).resolves.toBeUndefined();
    expect(values.size).toBe(0);
  });

  it('is absent before the first sign-in', async () => {
    await expect(new SecretSessionStore(secretStorage().secrets).load()).resolves.toBeUndefined();
  });

  it('round-trips a session through SecretStorage only', async () => {
    const { secrets, values } = secretStorage();
    const store = new SecretSessionStore(secrets);
    await store.save(session);
    expect(await store.load()).toEqual(session);
    expect([...values.keys()]).toEqual(['inheriti.operatorSession']);
  });

  it('discards an unreadable secret instead of trusting half a credential', async () => {
    const { secrets, values } = secretStorage();
    const store = new SecretSessionStore(secrets);
    await store.save(session);
    values.set('inheriti.operatorSession', '{ not json');
    await expect(store.load()).resolves.toBeUndefined();
    expect(values.size).toBe(0);
  });

  it('leaves nothing behind on sign-out', async () => {
    const { secrets, values } = secretStorage();
    const store = new SecretSessionStore(secrets);
    await store.save(session);
    await store.clear();
    expect(values.size).toBe(0);
  });
});
