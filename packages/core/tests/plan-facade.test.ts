import { describe, expect, it, vi } from 'vitest';
import { PlanRequestFailed, SdkPlanFacade, asPlanRequestFailed } from '../src/plans.js';

const page = { items: [], nextCursor: null };

function facadeThatFailsWith(error: unknown): SdkPlanFacade {
  return new SdkPlanFacade({
    listPlans: async () => { throw error; },
    getPlan: async () => { throw error; },
    listPlanLogs: async () => { throw error; },
  } as never);
}

describe('SdkPlanFacade', () => {
  it('reads only the active reveal metadata through the SDK', async () => {
    const getActivePlanReveal = vi.fn(async () => ({ id: 'reveal-1' }));
    const facade = new SdkPlanFacade({ getActivePlanReveal } as never);
    await expect(facade.getActivePlanReveal('plan-1')).resolves.toEqual({ id: 'reveal-1' });
    expect(getActivePlanReveal).toHaveBeenCalledWith('plan-1');
  });
  it('forwards the observed reveal id for a conditional access abort', async () => {
    const abortPlanAccess = vi.fn(async () => ({ aborted: false }));
    const facade = new SdkPlanFacade({ abortPlanAccess } as never);
    await expect(facade.abortPlanAccess('plan-1', 'observed-reveal-1')).resolves.toEqual({ aborted: false });
    expect(abortPlanAccess).toHaveBeenCalledWith('plan-1', 'observed-reveal-1');
  });
  it('passes list input through to the SDK and returns its page unchanged', async () => {
    const seen: unknown[] = [];
    const facade = new SdkPlanFacade({
      listPlans: async (input?: unknown) => { seen.push(input); return page; },
      getPlan: async () => ({}),
    } as never);
    await expect(facade.listPlans({ limit: 10 } as never)).resolves.toBe(page);
    expect(seen).toEqual([{ limit: 10 }]);
  });

  it('refuses an empty plan id before reaching the network', async () => {
    const facade = new SdkPlanFacade({
      listPlans: async () => page,
      getPlan: async () => { throw new Error('must not be called'); },
    } as never);
    expect(() => facade.getPlan('')).toThrow(PlanRequestFailed);
  });

  it('reports a plan the operator may not see as absent, never as forbidden', async () => {
    const facade = facadeThatFailsWith(Object.assign(new Error('nope'), { status: 403 }));
    await expect(facade.getPlan('plan-1')).rejects.toMatchObject({ code: 'plan_not_found' });
  });

  it('applies the same plan visibility rule to logs', async () => {
    const facade = facadeThatFailsWith(Object.assign(new Error('raw forbidden'), { status: 403 }));
    await expect(facade.listPlanLogs('plan-1', { limit: 10, offset: 0 })).rejects.toMatchObject({ code: 'plan_not_found' });
    expect(() => facade.listPlanLogs('')).toThrow(PlanRequestFailed);
  });

  it('maps an expired session to a reauthentication code a host can act on', async () => {
    const facade = facadeThatFailsWith(Object.assign(new Error('nope'), { status: 401 }));
    await expect(facade.listPlans()).rejects.toMatchObject({ code: 'operator_reauthentication_required' });
  });

  it('never leaks a raw transport error to a host', async () => {
    const facade = facadeThatFailsWith(new TypeError('fetch failed: connect ECONNREFUSED 127.0.0.1:3201'));
    const failure = await facade.listPlans().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PlanRequestFailed);
    expect((failure as PlanRequestFailed).message).toBe('plan_request_failed');
    expect(JSON.stringify(failure)).not.toContain('ECONNREFUSED');
  });

  it('keeps a server-supplied code and request id for support, without inventing one', () => {
    const mapped = asPlanRequestFailed({ status: 400, code: 'plan_status_invalid', requestId: 'req-7' });
    expect(mapped.code).toBe('plan_status_invalid');
    expect(mapped.requestId).toBe('req-7');
    expect(asPlanRequestFailed({ status: 503 }).code).toBe('elements_api_unavailable');
  });
});
