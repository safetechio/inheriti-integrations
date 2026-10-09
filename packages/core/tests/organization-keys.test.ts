import { beforeEach, expect, it, vi } from 'vitest';

const clients = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@safetech/inheriti-client-sdk/node-base', () => ({ createNodeElementsClient: clients.create }));

import { createOrganizationKeys } from '../src/organization-keys.js';

beforeEach(() => {
  clients.create.mockReset();
  clients.create.mockImplementation(({ organizationId }: { organizationId: string }) => ({
    organizationMasterKey: vi.fn().mockResolvedValue(`key-${organizationId}`),
    forgetMasterKey: vi.fn().mockResolvedValue(undefined),
  }));
});

it('reuses an SDK client for each organization until the session is cleared', async () => {
  const keys = createOrganizationKeys({ apiUrl: 'https://example.test/', environment: 'TEST', getBearerToken: async () => 'token' });
  expect(await keys.resolve('org-a')).toBe('key-org-a');
  expect(await keys.resolve('org-a')).toBe('key-org-a');
  expect(await keys.resolve('org-b')).toBe('key-org-b');
  expect(await keys.resolve('org-a')).toBe('key-org-a');
  expect(clients.create.mock.calls.map(([input]) => input.organizationId)).toEqual(['org-a', 'org-b']);
  await keys.clear();
  expect(clients.create.mock.results[0]?.value.forgetMasterKey).toHaveBeenCalledOnce();
  expect(clients.create.mock.results[1]?.value.forgetMasterKey).toHaveBeenCalledOnce();
  expect(await keys.resolve('org-a')).toBe('key-org-a');
  expect(clients.create).toHaveBeenCalledTimes(3);
});

it('keeps stored keys across organization switches and purges them explicitly', async () => {
  const held = new Map<string, Uint8Array>();
  const vault = {
    store: vi.fn(async (ref: { contextId: string }, key: Uint8Array) => { held.set(ref.contextId, key.slice()); }),
    load: vi.fn(async (ref: { contextId: string }) => held.get(ref.contextId)?.slice()),
    remove: vi.fn(async (ref: { contextId: string }) => { held.delete(ref.contextId); }),
    clearMemory: vi.fn(),
    forgetAccount: vi.fn(async () => { held.clear(); }),
    withScope: async <T>(run: () => Promise<T>) => run(),
  };
  const relay = vi.fn(async (id: string) => new Uint8Array(32).fill(id === 'org-a' ? 1 : 2));
  clients.create.mockImplementation(({ organizationId, keyVault }: { organizationId: string; keyVault: typeof vault }) => ({
    organizationMasterKey: async () => {
      const ref = { contextId: organizationId };
      let key = await keyVault.load(ref);
      if (!key) { key = await relay(organizationId); await keyVault.store(ref, key); }
      return Buffer.from(key).toString('hex');
    },
  }));
  const keys = createOrganizationKeys({ apiUrl: 'https://example.test/', environment: 'TEST', getBearerToken: async () => 'token', keyVault: vault });
  await keys.resolve('org-a');
  await keys.clear();
  await keys.resolve('org-b');
  await keys.clear();
  await keys.resolve('org-a');
  expect(relay).toHaveBeenCalledTimes(2);
  expect(relay.mock.calls.map(([id]) => id)).toEqual(['org-a', 'org-b']);
  await keys.forget();
  expect(held.size).toBe(0);
});
