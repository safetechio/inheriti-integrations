import { describe, expect, it, vi } from 'vitest';
import { createNodeIntegrationCore } from '../src/node.js';
import { createBrowserIntegrationCore } from '../src/browser.js';

const configuration = {
  issuer: 'https://issuer.test', clientId: 'host-client', audience: 'inheriti-elements-api',
  environment: 'TEST' as const, redirectUri: 'http://127.0.0.1/callback', scopes: ['openid', 'plan:list'],
};

it('reports and forgets a held Node key through the SDK vault', async () => {
  let key: Uint8Array | undefined = new Uint8Array(32);
  const keyVault = { store: vi.fn(), load: vi.fn(async () => key), remove: vi.fn(async () => { key = undefined; }) };
  const core = createNodeIntegrationCore({ apiUrl: 'https://business.test/integrations/', environment: 'TEST',
    business: true, organizationId: 'org-1', configuration, keyVault });
  const ref = { system: 'INHERITI_BUSINESS' as const, contextId: 'org-1' };
  expect(await core.hasMasterKey(ref)).toBe(true);
  await core.forgetMasterKey();
  expect(keyVault.remove).toHaveBeenCalledWith(ref);
  expect(await core.hasMasterKey(ref)).toBe(false);
});

describe.each([
  ['Node', createNodeIntegrationCore],
  ['browser', createBrowserIntegrationCore],
] as const)('%s Business composition', (_name, createCore) => {
  it('discovers without context and scopes plan requests to a fresh selected client', async () => {
    const requests: Array<{ path: string; cursor: string | null; organizationId: string | null }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push({ path: url.pathname, cursor: url.searchParams.get('cursor'), organizationId: new Headers(init?.headers).get('x-organization-id') });
      const result = url.pathname.endsWith('/organizations')
        ? { items: [{ id: 'org-1', name: 'First' }, { id: 'org-2', name: 'Second' }] }
        : { items: [], nextCursor: null };
      return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
    });
    const options = { apiUrl: 'https://business.test/integrations/', environment: 'TEST' as const,
      business: true as const, configuration, fetchImpl };
    expect(() => createCore({ ...options, organizationId: '' })).toThrow('organization_id_required');
    const discovery = createCore(options);
    const organizations = await discovery.listOrganizations();
    expect(organizations).toHaveLength(2);
    await expect(discovery.listPlans()).rejects.toMatchObject({ code: 'organization_selection_required' });
    await createCore({ ...options, organizationId: organizations[0]!.id }).listPlans({ cursor: 'cursor-1' });
    await createCore({ ...options, organizationId: organizations[1]!.id }).listPlans({ cursor: 'cursor-1' });
    expect(requests).toEqual([
      { path: '/integrations/v1/organizations', cursor: null, organizationId: null },
      { path: '/integrations/v1/plans', cursor: 'cursor-1', organizationId: 'org-1' },
      { path: '/integrations/v1/plans', cursor: 'cursor-1', organizationId: 'org-2' },
    ]);
  });
});


it('uses the supplied auth for every scoped Node client and bearer request', async () => {
  const auth = {
    beginAuthorizationCode: vi.fn(), completeAuthorizationCode: vi.fn(),
    beginDeviceAuthorization: vi.fn(), pollDeviceAuthorization: vi.fn(),
    getAccessToken: vi.fn(async () => 'shared-token'), refresh: vi.fn(), clear: vi.fn(),
  };
  const authorization: Array<string | null> = [];
  const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    authorization.push(new Headers(init?.headers).get('authorization'));
    return new Response(JSON.stringify({ ok: true, result: { items: [], nextCursor: null } }));
  });
  const options = { apiUrl: 'https://business.test/integrations/', environment: 'TEST' as const,
    business: true as const, configuration, auth, fetchImpl };
  const first = createNodeIntegrationCore({ ...options, organizationId: 'org-1' });
  const second = createNodeIntegrationCore({ ...options, organizationId: 'org-2' });
  expect(first.auth).toBe(auth);
  expect(second.auth).toBe(auth);
  await Promise.all([first.listPlans(), second.listPlans()]);
  expect(authorization).toEqual(['Bearer shared-token', 'Bearer shared-token']);
});
