import { expect, it, vi } from 'vitest';
import type { OperatorAuthFacade } from '../src/index.js';
import { businessApiTransport } from '../src/business-api-transport.js';

function token(sub: string, sid: string, version: number): string {
  return `header.${btoa(JSON.stringify({ sub, sid, version }))}.signature`;
}

function auth(accessToken: () => string, refresh: () => void | Promise<void>): OperatorAuthFacade {
  return {
    beginAuthorizationCode: vi.fn(), completeAuthorizationCode: vi.fn(),
    beginDeviceAuthorization: vi.fn(), pollDeviceAuthorization: vi.fn(),
    getAccessToken: vi.fn(async () => accessToken()), refresh: vi.fn(async () => refresh()), clear: vi.fn(),
  };
}

it('refreshes a rejected Business GET token and retries once with the same session', async () => {
  const first = token('operator-1', 'family-1', 1);
  const second = token('operator-1', 'family-1', 2);
  let current = first;
  const operator = auth(() => current, () => { current = second; });
  const sent: string[] = [];
  const transport = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    sent.push(new Headers(init?.headers).get('authorization') ?? '');
    return new Response(null, { status: sent.length === 1 ? 401 : 200 });
  });
  const fetch = businessApiTransport('https://business.test/integrations/', operator, transport);
  const response = await fetch(new URL('https://business.test/integrations/v1/organizations'),
    { method: 'GET', headers: { authorization: `Bearer ${first}` } });
  expect(response.status).toBe(200);
  expect(sent).toEqual([`Bearer ${first}`, `Bearer ${second}`]);
  expect(operator.refresh).toHaveBeenCalledOnce();
});

it('shares one refresh between separate cores with the same rejected session', async () => {
  const first = token('operator-1', 'family-1', 1);
  const second = token('operator-1', 'family-1', 2);
  let current = first;
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const refreshing = new Promise<void>((resolve) => { started = resolve; });
  const refresh = async () => { started(); await waiting; current = second; };
  const firstAuth = auth(() => current, refresh);
  const secondAuth = auth(() => current, refresh);
  const sent: string[] = [];
  const transport = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const bearer = new Headers(init?.headers).get('authorization') ?? '';
    sent.push(bearer);
    return new Response(null, { status: bearer === `Bearer ${first}` ? 401 : 200 });
  });
  const fetchA = businessApiTransport('https://business.test/integrations/', firstAuth, transport);
  const fetchB = businessApiTransport('https://business.test/integrations/', secondAuth, transport);
  const request = { method: 'GET', headers: { authorization: `Bearer ${first}` } };
  const url = new URL('https://business.test/integrations/v1/organizations');
  const responses = Promise.all([fetchA(url, request), fetchB(url, request)]);
  await refreshing;
  release();
  expect((await responses).map((response) => response.status)).toEqual([200, 200]);
  expect(vi.mocked(firstAuth.refresh).mock.calls.length + vi.mocked(secondAuth.refresh).mock.calls.length).toBe(1);
  expect(sent).toEqual([`Bearer ${first}`, `Bearer ${first}`, `Bearer ${second}`, `Bearer ${second}`]);
});

it.each([
  ['forbidden', 403, 'GET', 'https://business.test/integrations/v1/organizations'],
  ['write', 401, 'POST', 'https://business.test/integrations/v1/plans'],
  ['other origin', 401, 'GET', 'https://other.test/integrations/v1/organizations'],
])('does not replay a %s request', async (_label, status, method, url) => {
  const first = token('operator-1', 'family-1', 1);
  const operator = auth(() => first, () => undefined);
  const transport = vi.fn(async () => new Response(null, { status }));
  const fetch = businessApiTransport('https://business.test/integrations/', operator, transport);
  expect((await fetch(new URL(url), { method, headers: { authorization: `Bearer ${first}` } })).status).toBe(status);
  expect(transport).toHaveBeenCalledOnce();
  expect(operator.refresh).not.toHaveBeenCalled();
});

it('does not replay an old account request after a concurrent account switch', async () => {
  const first = token('operator-1', 'family-1', 1);
  const other = token('operator-2', 'family-2', 1);
  const operator = auth(() => other, () => undefined);
  const transport = vi.fn(async () => new Response(null, { status: 401 }));
  const fetch = businessApiTransport('https://business.test/integrations/', operator, transport);
  expect((await fetch(new URL('https://business.test/integrations/v1/organizations'),
    { method: 'GET', headers: { authorization: `Bearer ${first}` } })).status).toBe(401);
  expect(transport).toHaveBeenCalledOnce();
  expect(operator.refresh).not.toHaveBeenCalled();
});
