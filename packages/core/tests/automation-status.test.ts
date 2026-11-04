import { expect, it, vi } from 'vitest';
import { createAutomationStatusReader, parseAutomationStatus } from '../src/automation-status.js';

const org = '00000000-0000-4000-8000-000000000001';
const plan = '00000000-0000-4000-8000-000000000002';
const connection = '00000000-0000-4000-8000-000000000003';
const job = '00000000-0000-4000-8000-000000000004';
const snapshot = { observedAt: '2026-11-04T12:00:00.000Z', provider: 'GITHUB', connectionId: connection, planId: plan, providerStatus: 'UNVERIFIED',
  setup: { status: 'READY', steps: ['CONNECTION', 'IDENTITY', 'PLAN_ACCESS', 'READY'].map(code => ({ code, state: 'COMPLETE' })), nextAction: null },
  executions: { items: [{ jobId: job, stage: 'WAITING_FOR_PARTICIPANTS', status: 'IN_PROGRESS', nextAction: { code: 'APPROVE_MODERATION', actor: 'MODERATOR' } }], hasMore: false } };

it('reads a scoped status and exposes only safe fields', async () => {
  const fetchImpl = vi.fn(async (_url: URL, _init: RequestInit) => new Response(JSON.stringify({ ok: true, result: { ...snapshot, secret: 'NEVER_PRINT' } })));
  const read = createAutomationStatusReader({ apiUrl: 'http://localhost:3400/integrations/', organizationId: org, getBearerToken: async () => 'token', fetchImpl: fetchImpl as never });
  const value = await read(plan, connection, job);
  expect(JSON.stringify(value)).not.toContain('NEVER_PRINT');
  expect(fetchImpl).toHaveBeenCalledOnce();
  const [url, init] = fetchImpl.mock.calls[0]!;
  expect(url.toString()).toBe(`http://localhost:3400/integrations/v1/plans/${plan}/automation-status?connectionId=${connection}&jobId=${job}`);
  expect(init.headers).toMatchObject({ 'x-organization-id': org, 'x-elements-environment': 'TEST', Authorization: 'Bearer token' });
  expect(init.method).toBeUndefined();
});

it('passes cancellation to HTTP and avoids a request after early cancellation', async () => {
  const fetchImpl = vi.fn(async (_url: URL, _init: RequestInit) => new Response(JSON.stringify({ ok: true, result: snapshot })));
  const read = createAutomationStatusReader({ apiUrl: 'http://localhost:3400/integrations/', organizationId: org, getBearerToken: async () => 'token', fetchImpl: fetchImpl as never });
  const controller = new AbortController();
  await read(plan, connection, undefined, controller.signal);
  expect(fetchImpl.mock.calls[0]?.[1].signal).toBe(controller.signal);
  controller.abort();
  await expect(read(plan, connection, undefined, controller.signal)).rejects.toThrow();
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it('rejects cross-target records and unsafe stage or action values', () => {
  expect(() => parseAutomationStatus({ ...snapshot, planId: org }, plan, connection)).toThrow();
  expect(() => parseAutomationStatus({ ...snapshot, executions: { ...snapshot.executions, items: [{ ...snapshot.executions.items[0], stage: 'SECRET_VALUE' }] } }, plan, connection)).toThrow();
  expect(() => parseAutomationStatus({ ...snapshot, setup: { ...snapshot.setup, nextAction: { code: 'REVEAL_SECRET', actor: 'OPERATOR' } } }, plan, connection)).toThrow();
  expect(() => parseAutomationStatus(snapshot, plan, connection, org)).toThrow();
  expect(() => parseAutomationStatus({ ...snapshot, executions: { ...snapshot.executions, items: [{ ...snapshot.executions.items[0], runReference: 'unsafe?token=secret' }] } }, plan, connection)).toThrow();
  expect(() => parseAutomationStatus({ ...snapshot, setup: { ...snapshot.setup, nextAction: { code: 'REVIEW_GRANT', actor: 'OPERATOR', reason: 'SECRET' } } }, plan, connection)).toThrow();
});

it('accepts delivered key relay without treating automation as completed', () => {
  const delivered = { ...snapshot, executions: { items: [{ jobId: job, relayId: connection, stage: 'ORGANISATION_KEY_DELIVERED', status: 'DELIVERED', nextAction: null }], hasMore: false } };
  const parsed = parseAutomationStatus(delivered, plan, connection);
  expect(parsed.executions.items[0]).toMatchObject({ status: 'DELIVERED', stage: 'ORGANISATION_KEY_DELIVERED' });
  expect(parsed.executions.items[0]?.status).not.toBe('COMPLETED');
});

it('preserves a denied access without suggesting another approval', () => {
  const denied = { ...snapshot, executions: { items: [{ jobId: job, revealId: connection,
    stage: 'DENIED', status: 'FAILED', nextAction: null }], hasMore: false } };
  expect(parseAutomationStatus(denied, plan, connection).executions.items[0])
    .toMatchObject({ stage: 'DENIED', status: 'FAILED', nextAction: null });
});
