import { beforeEach, expect, it, vi } from 'vitest';

const clients = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@safetech/inheriti-client-sdk/node', () => ({ createNodeElementsClient: clients.create }));

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
