import type {
  OperatorSession,
  OperatorSessionStore,
  OperatorTokenValidator,
  ValidatedOperatorToken,
} from '@safetech/inheriti-client-sdk';
import { expect, it, vi } from 'vitest';
import { createNodeIntegrationCore } from '../src/node.js';

const ISSUER = 'https://issuer.test';
const CLIENT_ID = 'host-client';
const AUDIENCE = 'inheriti-elements-api';

const configuration = {
  issuer: ISSUER,
  clientId: CLIENT_ID,
  audience: AUDIENCE,
  environment: 'TEST' as const,
  redirectUri: 'http://127.0.0.1/callback',
  scopes: ['openid', 'plan:list'],
};

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

it('single-flights Business refresh across scoped Node cores and persists rotation', async () => {
  const principal: ValidatedOperatorToken = {
    issuer: ISSUER,
    audience: AUDIENCE,
    authorizedParty: CLIENT_ID,
    environment: 'TEST',
    subject: 'operator-1',
    sessionId: 'session-1',
    tokenId: 'token-rotated',
    scopes: ['openid', 'plan:list'],
  };
  let persistedSession: OperatorSession | undefined = {
    kind: 'business',
    familyId: 'family-1',
    accessToken: 'expired-access',
    refreshToken: 'refresh-1',
    tokenType: 'Bearer',
    expiresAt: 0,
    sessionExpiresAt: Date.now() + 300_000,
    principal,
  };
  const sessions: OperatorSessionStore = {
    load: vi.fn(async () => persistedSession),
    save: vi.fn(async (next: OperatorSession) => { persistedSession = next; }),
    clear: vi.fn(async () => { persistedSession = undefined; }),
  };
  const tokenValidator: OperatorTokenValidator = {
    validateAccessToken: vi.fn(async (accessToken: string) => {
      expect(accessToken).toBe('rotated-access');
      return principal;
    }),
  };
  let refreshRequests = 0;
  const authorizationHeaders: string[] = [];
  const organizationHeaders: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/integrations/operator-sessions/refresh') {
      refreshRequests += 1;
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ refreshToken: 'refresh-1' });
      return jsonResponse({ ok: true, result: {
        accessToken: 'rotated-access',
        refreshToken: 'refresh-2',
        accessExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        sessionExpiresAt: new Date(Date.now() + 300_000).toISOString(),
        familyId: 'family-1',
        environment: 'TEST',
        clientId: CLIENT_ID,
        providerIssuer: ISSUER,
        providerSubject: 'operator-1',
      } });
    }
    authorizationHeaders.push(new Headers(init?.headers).get('authorization') ?? '');
    organizationHeaders.push(new Headers(init?.headers).get('x-organization-id') ?? '');
    return jsonResponse({ ok: true, result: { items: [], nextCursor: null } });
  });

  const discovery = createNodeIntegrationCore({
    apiUrl: 'https://business.test/integrations/',
    environment: 'TEST',
    business: true,
    configuration,
    sessions,
    tokenValidator,
    fetchImpl,
  });
  const first = createNodeIntegrationCore({
    apiUrl: 'https://business.test/integrations/',
    environment: 'TEST',
    business: true,
    organizationId: 'org-1',
    configuration,
    auth: discovery.auth,
    sessions,
    tokenValidator,
    fetchImpl,
  });
  const second = createNodeIntegrationCore({
    apiUrl: 'https://business.test/integrations/',
    environment: 'TEST',
    business: true,
    organizationId: 'org-2',
    configuration,
    auth: discovery.auth,
    sessions,
    tokenValidator,
    fetchImpl,
  });

  expect(first.auth).toBe(discovery.auth);
  expect(second.auth).toBe(discovery.auth);
  await Promise.all([first.listPlans(), second.listPlans()]);

  expect(refreshRequests).toBe(1);
  expect(persistedSession?.accessToken).toBe('rotated-access');
  expect(persistedSession?.refreshToken).toBe('refresh-2');
  expect(authorizationHeaders).toEqual(['Bearer rotated-access', 'Bearer rotated-access']);
  expect(organizationHeaders).toEqual(['org-1', 'org-2']);
});
