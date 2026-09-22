import { describe, expect, it } from 'vitest';
import { assertEnvironmentAllowed, composeRevealWorkflows, ELEMENTS_INTEGRATION_CONTRACT_VERSION, ElementsIntegrationCore, LiveEnvironmentConfirmationRequired } from '../src/index.js';

describe('integration contract version', () => {
  it('is pinned for every host', () => {
    expect(ELEMENTS_INTEGRATION_CONTRACT_VERSION).toBe('elements.integration.v1');
  });

  it('authorizes before host action and reports only a stable outcome', async () => {
    const reports: unknown[] = [];
    const interactions = {
      authorize: async () => ({ id: 'action-1', expiresAt: '2026-08-29T00:00:00Z' }),
      report: async (input: unknown) => { reports.push(input); },
    };
    const noop = async () => undefined;
    const core = new ElementsIntegrationCore({
      environment: 'TEST',
      auth: { beginAuthorizationCode: async () => ({ authorizationUrl: '', expiresAt: 0 }), completeAuthorizationCode: noop, beginDeviceAuthorization: noop, pollDeviceAuthorization: noop, getAccessToken: async () => undefined, refresh: noop, clear: noop },
      elements: { listPlans: async () => [], getPlan: async () => ({}), listPlanLogs: async () => ({ items: [], total: 0 }), abortPlanAccess: async () => ({ aborted: false }) },
      interactions,
    });
    await expect(core.performAuthorizedInteraction({ revealId: 'reveal', assetId: 'asset', action: 'COPY_FIELD', fieldName: 'password', context: {}, idempotencyKey: 'key' }, async () => 'protected-value'))
      .resolves.toBe('protected-value');
    expect(reports).toEqual([{ revealId: 'reveal', actionId: 'action-1', outcome: 'SUCCEEDED', idempotencyKey: 'key' }]);
    expect(JSON.stringify(reports)).not.toContain('protected-value');
  });

  it('reports a stable failure against the SDK action id before rethrowing', async () => {
    const reports: unknown[] = [];
    const interactions = {
      authorize: async () => ({ id: 'action-2', expiresAt: '2026-08-29T00:00:00Z' }),
      report: async (input: unknown) => { reports.push(input); },
    };
    const noop = async () => undefined;
    const core = new ElementsIntegrationCore({
      environment: 'TEST',
      auth: { beginAuthorizationCode: async () => ({ authorizationUrl: '', expiresAt: 0 }), completeAuthorizationCode: noop, beginDeviceAuthorization: noop, pollDeviceAuthorization: noop, getAccessToken: async () => undefined, refresh: noop, clear: noop },
      elements: { listPlans: async () => [], getPlan: async () => ({}), listPlanLogs: async () => ({ items: [], total: 0 }), abortPlanAccess: async () => ({ aborted: false }) },
      interactions,
    });
    const failure = Object.assign(new Error('secret must not escape'), { code: 'field_write_failed' });

    await expect(core.performAuthorizedInteraction({ revealId: 'reveal', assetId: 'asset', action: 'INSERT_FIELD', fieldName: 'password', context: {}, idempotencyKey: 'key' }, async () => { throw failure; }))
      .rejects.toBe(failure);
    expect(reports).toEqual([{ revealId: 'reveal', actionId: 'action-2', outcome: 'FAILED', errorCode: 'field_write_failed', idempotencyKey: 'key' }]);
    expect(JSON.stringify(reports)).not.toContain(failure.message);
  });

  it('states only where an origin-bound action lands, never which host is asking', async () => {
    // Elements gates AUTOFILL_FIELD on `origin-bound-autofill` and INSERT_FIELD on `editor-insert`,
    // both carried by the operator principal's registration, so a host that named itself would be
    // declaring authority it does not hold.
    const authorized: unknown[] = [];
    const noop = async () => undefined;
    const core = new ElementsIntegrationCore({
      environment: 'TEST',
      auth: { beginAuthorizationCode: async () => ({ authorizationUrl: '', expiresAt: 0 }), completeAuthorizationCode: noop, beginDeviceAuthorization: noop, pollDeviceAuthorization: noop, getAccessToken: async () => undefined, refresh: noop, clear: noop },
      elements: { listPlans: async () => [], getPlan: async () => ({}), listPlanLogs: async () => ({ items: [], total: 0 }), abortPlanAccess: async () => ({ aborted: false }) },
      interactions: {
        authorize: async (input: unknown) => { authorized.push(input); return { id: 'action-3' }; },
        report: noop,
      },
    });

    await core.performAuthorizedInteraction(
      { revealId: 'reveal', assetId: 'asset', action: 'AUTOFILL_FIELD', fieldName: 'password', context: { origin: 'https://plans.test' }, idempotencyKey: 'key' },
      async () => undefined,
    );

    expect(authorized[0]).toEqual({
      revealId: 'reveal', assetId: 'asset', action: 'AUTOFILL_FIELD', fieldName: 'password',
      context: { origin: 'https://plans.test' }, idempotencyKey: 'key',
    });
    expect(JSON.stringify(authorized)).not.toContain('targetClass');
  });

  it('composes SDK reveal operations and drops host-only context from API input', async () => {
    const calls: Array<{ operation: string; input: unknown }> = [];
    const workflows = composeRevealWorkflows({
      startReveal: async (_planId, input) => { calls.push({ operation: 'start', input }); return { id: 'reveal-1', stage: 'AUTHORIZED' }; },
      getReveal: async (revealId) => ({ id: revealId, stage: 'ACTIONS_OPEN' }),
      closeReveal: async (_revealId, reason) => { calls.push({ operation: 'close', input: reason }); },
      authorizeRevealAction: async (_revealId, input) => { calls.push({ operation: 'authorize', input }); return { id: 'action-1' }; },
      reportRevealActionOutcome: async (_revealId, _actionId, input) => { calls.push({ operation: 'report', input }); },
    });

    await expect(workflows.reveals.start('plan-1', 'DIRECT', 'start-key')).resolves.toEqual({ revealId: 'reveal-1', status: 'AUTHORIZED' });
    await expect(workflows.reveals.status('reveal-1')).resolves.toEqual({ revealId: 'reveal-1', status: 'ACTIONS_OPEN' });
    await workflows.interactions.authorize({ revealId: 'reveal-1', assetId: 'asset-1', fieldName: 'password', action: 'COPY_FIELD', context: {}, idempotencyKey: 'action-key' });
    await workflows.interactions.report({ revealId: 'reveal-1', actionId: 'action-1', outcome: 'SUCCEEDED', idempotencyKey: 'report-key' });
    await workflows.reveals.close('reveal-1', 'COMPLETED');

    expect(calls[1]).toEqual({ operation: 'authorize', input: { assetId: 'asset-1', fieldName: 'password', action: 'COPY_FIELD', idempotencyKey: 'action-key' } });
    expect(calls[2]?.input).toEqual(expect.objectContaining({ outcome: 'SUCCEEDED', idempotencyKey: 'report-key', reportedAt: expect.any(String) }));
  });

  it('delegates the scoped reveal lifecycle without exposing material to the integration core', async () => {
    const noop = async () => undefined;
    const withReveal = async <TResult>(_planId: string, _options: unknown, work: (handle: never) => Promise<TResult>) => work({ field: async () => 'requested-value' } as never);
    const core = new ElementsIntegrationCore({
      environment: 'TEST',
      auth: { beginAuthorizationCode: async () => ({ authorizationUrl: '', expiresAt: 0 }), completeAuthorizationCode: noop, beginDeviceAuthorization: noop, pollDeviceAuthorization: noop, getAccessToken: async () => undefined, refresh: noop, clear: noop },
      elements: { listPlans: async () => [], getPlan: async () => ({}), listPlanLogs: async () => ({ items: [], total: 0 }), abortPlanAccess: async () => ({ aborted: false }) },
      scopedReveals: { withReveal },
    });

    await expect(core.withReveal('plan-1', { mode: 'DIRECT' }, (reveal) => reveal.field('prod-db.password')))
      .resolves.toBe('requested-value');
    expect(JSON.stringify(core)).not.toContain('requested-value');
  });

  it('defaults safely by requiring an explicit LIVE confirmation', () => {
    expect(() => assertEnvironmentAllowed('TEST')).not.toThrow();
    expect(() => assertEnvironmentAllowed('LIVE')).toThrow(LiveEnvironmentConfirmationRequired);
    expect(() => assertEnvironmentAllowed('LIVE', 'LIVE')).not.toThrow();
  });
});
