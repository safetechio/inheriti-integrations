import { expect, it, vi } from 'vitest';
import { createNodeInbox } from '../src/inbox.js';

it('loads the organisation member directory with the installed SDK version', async () => {
  const page = { items: [{ memberId: 'member-1', name: 'Ada', ready: false }], limit: 100, offset: 0, nextOffset: null };
  const transport = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: page }), { status: 200 }));
  const inbox = createNodeInbox({ apiUrl: 'https://example.test/integrations/', environment: 'TEST', organizationId: 'org-1',
    getBearerToken: async () => 'test-token', fetchImpl: transport as typeof fetch });
  expect(await inbox.listMembers({ q: 'Ada', limit: 100, offset: 0 })).toEqual(page);
  const [url, init] = transport.mock.calls[0] as unknown as [URL, RequestInit];
  expect(String(url)).toBe('https://example.test/integrations/v1/inbox/members?q=Ada&limit=100&offset=0');
  expect(new Headers(init.headers).get('x-organization-id')).toBe('org-1');
  expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-token');
});

it('rejects malformed member pages', async () => {
  const inbox = createNodeInbox({ apiUrl: 'https://example.test/integrations/', environment: 'TEST', organizationId: 'org-1',
    getBearerToken: async () => 'test-token', fetchImpl: async () => new Response(JSON.stringify({ ok: true, result: { items: [{ memberId: 'member-1', name: 'Ada' }], limit: 100, offset: 0, nextOffset: null } })) });
  await expect(inbox.listMembers()).rejects.toThrow('invalid_inbox_response');
});

it('preserves the authentication status when the session has expired', async () => {
  const inbox = createNodeInbox({ apiUrl: 'https://example.test/integrations/', environment: 'TEST', organizationId: 'org-1',
    getBearerToken: async () => null, fetchImpl: vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401 })) });
  await expect(inbox.listMembers()).rejects.toMatchObject({ status: 401 });
});
