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
  it('forwards organisation read filters and preserves safe pages', async () => {
    const page = { items: [{ id: 'member-1', displayName: 'Ari', role: 'OWNER', status: 'ACTIVE' }], total: 1 };
    const listOrganizationMembers = vi.fn(async () => page);
    const facade = new SdkPlanFacade({ listOrganizationMembers } as never);
    await expect(facade.listOrganizationMembers({ limit: 5, offset: 10 })).resolves.toBe(page);
    expect(listOrganizationMembers).toHaveBeenCalledWith({ limit: 5, offset: 10 });
  });

  it('reports denied organisation queries as a permission error without a raw response', async () => {
    const error = Object.assign(new Error('private upstream detail'), { status: 403, requestId: 'req-1' });
    const facade = new SdkPlanFacade({
      listOrganizationMembers: async () => { throw error; },
      listOrganizationAuditTrail: async () => { throw error; },
      getOrganizationInsights: async () => { throw error; },
    } as never);
    for (const operation of [
      facade.listOrganizationMembers(),
      facade.listOrganizationAuditTrail({ from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' }),
      facade.getOrganizationInsights(),
    ]) {
      const failure = await operation.catch((reason: unknown) => reason);
      expect(failure).toMatchObject({ code: 'organization_permission_required', status: 403, requestId: 'req-1' });
      expect(JSON.stringify(failure)).not.toContain('private upstream detail');
    }
  });

  it('reports an inaccessible plan responsibility listing as absent', async () => {
    const facade = new SdkPlanFacade({ getPlanResponsibilities: async () => {
      throw Object.assign(new Error('foreign plan'), { status: 403 });
    } } as never);
    await expect(facade.getPlanResponsibilities('foreign')).rejects.toMatchObject({ code: 'plan_not_found' });
    expect(() => facade.getPlanResponsibilities('')).toThrow(PlanRequestFailed);
  });

  it('does not turn a missing organisation query route into a missing plan', async () => {
    const facade = new SdkPlanFacade({ getOrganizationInsights: async () => {
      throw Object.assign(new Error('missing endpoint'), { status: 404 });
    } } as never);
    await expect(facade.getOrganizationInsights()).rejects.toMatchObject({ code: 'organization_query_unavailable', status: 404 });
  });
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

  it('passes member filters through and does not report a plan error for denied activity', async () => {
    const page = { items: [], total: 0 };
    const listMemberLogs = vi.fn(async () => page);
    const facade = new SdkPlanFacade({ listMemberLogs } as never);
    await expect(facade.listMemberLogs('member-1', { source: 'AUTOMATION', limit: 10 })).resolves.toBe(page);
    expect(listMemberLogs).toHaveBeenCalledWith('member-1', { source: 'AUTOMATION', limit: 10 });
    expect(() => facade.listMemberLogs('')).toThrow(PlanRequestFailed);
    listMemberLogs.mockRejectedValueOnce(Object.assign(new Error('denied'), { status: 403 }));
    await expect(facade.listMemberLogs('member-1')).rejects.toMatchObject({ code: 'member_logs_unavailable' });
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
