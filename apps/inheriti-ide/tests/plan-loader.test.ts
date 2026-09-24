import { describe, expect, it, vi } from 'vitest';
import { loadPlans } from '../src/plan-loader.js';
import { ExtensionConfigurationInvalid } from '../src/configuration.js';

const coreWith = (overrides: Record<string, unknown>) => () => ({
  getAccessToken: async () => 'token',
  listPlans: async () => ({ items: [], nextCursor: null }),
  ...overrides,
}) as never;

describe('loadPlans', () => {
  it('is signed out when there is no access token', async () => {
    await expect(loadPlans(coreWith({ getAccessToken: async () => undefined }))).resolves.toEqual({ kind: 'SIGNED_OUT' });
  });

  it('is empty, not an error, when the Application has no plans', async () => {
    await expect(loadPlans(coreWith({}))).resolves.toEqual({ kind: 'EMPTY' });
  });

  it('carries real plans through untouched', async () => {
    const items = [{ id: 'plan-1', name: 'Vault', status: 'ACTIVE' }];
    await expect(loadPlans(coreWith({ listPlans: async () => ({ items, nextCursor: null }) })))
      .resolves.toEqual({ kind: 'PLANS', plans: items });
  });

  it('shows plans from every page', async () => {
    const first = { id: 'plan-1', name: 'First', status: 'ACTIVE' };
    const second = { id: 'plan-2', name: 'Second', status: 'ACTIVE' };
    const listPlans = vi.fn()
      .mockResolvedValueOnce({ items: [first], nextCursor: 'next' })
      .mockResolvedValueOnce({ items: [second], nextCursor: null });
    await expect(loadPlans(coreWith({ listPlans }))).resolves.toEqual({ kind: 'PLANS', plans: [first, second] });
    expect(listPlans).toHaveBeenNthCalledWith(2, { cursor: 'next' });
  });

  it('reports a mapped code rather than throwing into the tree', async () => {
    const failing = coreWith({ listPlans: async () => { throw Object.assign(new Error('x'), { code: 'elements_api_unavailable' }); } });
    await expect(loadPlans(failing)).resolves.toEqual({ kind: 'ERROR', code: 'elements_api_unavailable' });
  });

  it('surfaces a configuration problem as its own state, before any request', async () => {
    const unconfigured = () => { throw new ExtensionConfigurationInvalid('configuration_missing', 'set it'); };
    await expect(loadPlans(unconfigured as never)).resolves.toEqual({ kind: 'ERROR', code: 'configuration_missing' });
  });

  it('never leaks a raw transport error code into the view', async () => {
    const failing = coreWith({ listPlans: async () => { throw new TypeError('fetch failed: ECONNREFUSED'); } });
    await expect(loadPlans(failing)).resolves.toEqual({ kind: 'ERROR', code: 'plan_request_failed' });
  });
});

describe('codeOf', () => {
  it('rejects a runtime error code, which is meaningless to an operator', async () => {
    const failing = () => ({
      getAccessToken: async () => 'token',
      listPlans: async () => { throw Object.assign(new TypeError('Invalid URL'), { code: 'ERR_INVALID_URL' }); },
    }) as never;
    await expect(loadPlans(failing)).resolves.toEqual({ kind: 'ERROR', code: 'plan_request_failed' });
  });

  it('still passes through a stable server code', async () => {
    const failing = () => ({
      getAccessToken: async () => 'token',
      listPlans: async () => { throw Object.assign(new Error('x'), { code: 'plan_request_rate_limited' }); },
    }) as never;
    await expect(loadPlans(failing)).resolves.toEqual({ kind: 'ERROR', code: 'plan_request_rate_limited' });
  });
});
