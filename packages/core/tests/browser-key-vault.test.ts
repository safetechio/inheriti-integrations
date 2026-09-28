import { expect, it, vi } from 'vitest';
import { FakeElementsApi } from '@safetech/inheriti-elements-test-kit';
import { createBrowserIntegrationCore } from '../src/browser.js';
import type { MasterKeyRef } from '../src/index.js';

const configuration = {
  issuer: 'https://issuer.test', clientId: 'chrome-host', audience: 'inheriti-integrations-api',
  environment: 'TEST' as const, redirectUri: 'https://host.chromiumapp.org/', scopes: ['openid'],
};

it('reports and forgets a held organization key through the injected browser vault', async () => {
  let key: Uint8Array | undefined = new Uint8Array(32);
  const keyVault = { store: vi.fn(), load: vi.fn(async () => key), remove: vi.fn(async () => { key = undefined; }) };
  const core = createBrowserIntegrationCore({ apiUrl: 'https://business.test/integrations/', environment: 'TEST',
    business: true, organizationId: 'org-1', configuration, keyVault });
  const ref = { system: 'INHERITI_BUSINESS' as const, contextId: 'org-1' };
  expect(await core.hasMasterKey(ref)).toBe(true);
  expect(keyVault.load).toHaveBeenCalledWith(ref);
  await core.forgetMasterKey();
  expect(keyVault.remove).toHaveBeenCalledWith(ref);
  expect(await core.hasMasterKey(ref)).toBe(false);
});

it('reuses a shared vault after browser core recreation without acquiring the key again', async () => {
  const masterKeyHex = 'a'.repeat(64);
  let key: Uint8Array | undefined;
  const keyVault = {
    store: vi.fn(async (_ref: MasterKeyRef, value: Uint8Array) => { key = value.slice(); }),
    load: vi.fn(async () => key?.slice()),
    remove: vi.fn(async () => { key = undefined; }),
  };
  const resolve = vi.fn(async () => masterKeyHex);
  const create = async () => {
    const api = await FakeElementsApi.create({ applicationId: 'application-1', masterKeyHex });
    return createBrowserIntegrationCore({ apiUrl: 'https://elements.test', environment: 'TEST',
    applicationId: 'application-1', configuration, fetchImpl: api.fetch, keyVault, masterKeys: { resolve } });
  };
  const reveal = (core: Awaited<ReturnType<typeof create>>) => core.withReveal('plan-1', { mode: 'DIRECT' }, async (access) =>
    access.field<string>('prod-db.username', { action: 'AUTOFILL_FIELD', origin: 'https://db.example.test' }));
  expect(await reveal(await create())).toBe('alice');
  expect(await reveal(await create())).toBe('alice');
  expect(resolve).toHaveBeenCalledOnce();
  expect(keyVault.store).toHaveBeenCalledOnce();
});
