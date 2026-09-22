import { describe, expect, it, vi } from 'vitest';
import { createNodeIntegrationCore } from '../src/node.js';
import { createBrowserIntegrationCore } from '../src/browser.js';

const configuration = {
  issuer: 'https://issuer.test', clientId: 'host-client', audience: 'inheriti-elements-api',
  environment: 'TEST' as const, redirectUri: 'http://127.0.0.1/callback', scopes: ['openid', 'plan:list'],
};

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
