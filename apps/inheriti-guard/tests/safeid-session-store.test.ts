import { expect, it, vi } from 'vitest';
import type { OperatorSession } from '@safetech/inheriti-elements-core';
import type { ChromeConfiguration } from '../src/shared/configuration.js';

vi.mock('@safetech/inheriti-elements-core/browser', () => ({ INTEGRATION_AUTHORITY: 'safeid-oidc' }));

import { operatorProfileId, SessionStorageOperatorSessionStore } from '../src/background/session-store.js';

const configuration: ChromeConfiguration = {
  apiUrl: 'https://api.test/integrations/', issuer: 'https://issuer.test', clientId: 'business-client',
  environment: 'TEST', scopes: ['openid'], masterKeyCustody: 'EXTERNAL',
};

function session(kind: 'business' | 'safeid-oidc-business'): OperatorSession {
  const principal = { issuer: configuration.issuer, audience: 'inheriti-integrations-api',
    authorizedParty: configuration.clientId, environment: 'TEST' as const, subject: 'alice',
    sessionId: 'session-1', tokenId: 'token-1', scopes: ['openid'] };
  if (kind === 'business') return { kind, principal, familyId: 'family-1', accessToken: 'access',
    refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: 1000, sessionExpiresAt: 2000 };
  return { kind, principal, businessApiUrl: configuration.apiUrl, audience: 'inheriti-integrations-api',
    clientId: configuration.clientId, issuer: configuration.issuer, environment: 'TEST',
    accessToken: 'access', refreshToken: 'refresh', tokenType: 'Bearer', expiresAt: 1000 };
}

function storage(): chrome.storage.StorageArea {
  const values = new Map<string, unknown>();
  return {
    get: async (keys: string | string[] | null) => keys === null ? Object.fromEntries(values)
      : Object.fromEntries((typeof keys === 'string' ? [keys] : keys)
        .filter((key) => values.has(key)).map((key) => [key, values.get(key)])),
    set: async (entries: Record<string, unknown>) => { for (const [key, value] of Object.entries(entries)) values.set(key, value); },
    remove: async (keys: string | string[]) => { for (const key of typeof keys === 'string' ? [keys] : keys) values.delete(key); },
  } as chrome.storage.StorageArea;
}

it('binds selected SafeID Business sessions across reload and refresh', async () => {
  const area = storage();
  const store = new SessionStorageOperatorSessionStore(area);
  store.bind(configuration);
  await expect((await store.beginEnrollment()).save(session('business'))).rejects.toThrow('operator_session_changed');
  const signedIn = session('safeid-oidc-business');
  await (await store.beginEnrollment()).save(signedIn);
  const restarted = new SessionStorageOperatorSessionStore(area);
  restarted.bind(configuration);
  expect(await restarted.load()).toEqual(signedIn);
  const bound = await restarted.forProfile(operatorProfileId(signedIn));
  await bound.save({ ...signedIn, accessToken: 'refreshed' });
  expect((await restarted.load())?.accessToken).toBe('refreshed');
});
