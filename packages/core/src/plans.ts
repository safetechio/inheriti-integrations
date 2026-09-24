import type { ListPlanLogsInput, ListPlansInput, PlanDetail, PlanLogPage, PlanPage } from '@safetech/inheriti-client-sdk';
import type { PlanFacade } from './index.js';

/** The read surface of the SDK client, which is all a host needs to list and open plans. */
export interface SdkPlanReader {
  listPlans(input?: ListPlansInput): Promise<PlanPage>;
  getPlan(planId: string): Promise<PlanDetail>;
  listPlanLogs(planId: string, input?: ListPlanLogsInput): Promise<PlanLogPage>;
  getActivePlanReveal(planId: string): Promise<{ id: string } | null>;
  abortPlanAccess(planId: string, expectedRevealId?: string): Promise<{ aborted: boolean }>;
}

export type ElementsPlanFacade = PlanFacade<ListPlansInput, PlanPage, PlanDetail>;

/** Only the governance a plan can actually report; everything else about it is the API's business. */
export interface PlanGovernanceView {
  governance?: { mode?: string | { kind: 'UNKNOWN'; raw: string } };
}

/**
 * Which reveal a plan needs, read from the plan itself.
 *
 * Elements refuses a DIRECT reveal of a governed plan, so the mode is not a preference — it is a
 * property of the plan, and every host reads it the same way here rather than exposing a flag, a
 * checkbox or a default that an operator can only get wrong. `governance.mode` is a compatible
 * value: an unfamiliar one arrives as `UNKNOWN` carrying its raw text, which is matched too so a
 * host built today still opens a gate Elements names tomorrow.
 */
export function revealModeOf(plan: PlanGovernanceView): 'DIRECT' | 'GOVERNED' {
  const mode = plan.governance?.mode;
  const value = typeof mode === 'string' ? mode : mode?.raw;
  return value === 'GOVERNED' || value === 'REQUIRED' ? 'GOVERNED' : 'DIRECT';
}

/**
 * A host must never render a raw transport error, and must not have to know the SDK's error shapes
 * to avoid it. Every failure leaves here as a stable code a host can map to its own copy.
 */
export class PlanRequestFailed extends Error {
  constructor(readonly code: string, readonly status?: number, readonly requestId?: string) {
    super(code);
    this.name = 'PlanRequestFailed';
  }
}

export class SdkPlanFacade implements ElementsPlanFacade {
  constructor(private readonly reader: SdkPlanReader) {}

  listPlans(input?: ListPlansInput): Promise<PlanPage> {
    return this.guard(() => this.reader.listPlans(input));
  }

  getPlan(planId: string): Promise<PlanDetail> {
    if (!planId) throw new PlanRequestFailed('plan_id_required');
    return this.guard(() => this.reader.getPlan(planId));
  }

  listPlanLogs(planId: string, input?: ListPlanLogsInput): Promise<PlanLogPage> {
    if (!planId) throw new PlanRequestFailed('plan_id_required');
    return this.guard(() => this.reader.listPlanLogs(planId, input));
  }

  getActivePlanReveal(planId: string): Promise<{ id: string } | null> {
    if (!planId) throw new PlanRequestFailed('plan_id_required');
    return this.guard(() => this.reader.getActivePlanReveal(planId));
  }

  abortPlanAccess(planId: string, expectedRevealId?: string): Promise<{ aborted: boolean }> {
    if (!planId) throw new PlanRequestFailed('plan_id_required');
    return this.guard(() => this.reader.abortPlanAccess(planId, expectedRevealId));
  }

  private async guard<TResult>(call: () => Promise<TResult>): Promise<TResult> {
    try {
      return await call();
    } catch (error) {
      throw asPlanRequestFailed(error);
    }
  }
}

/**
 * A plan the operator may not see is reported as absent, not forbidden. Elements already answers
 * that way for a foreign Application; collapsing 403 here keeps a host from re-introducing the
 * enumeration the API was careful to avoid.
 */
export function asPlanRequestFailed(error: unknown): PlanRequestFailed {
  if (error instanceof PlanRequestFailed) return error;
  const status = numberOf(error, 'status');
  const code = stringOf(error, 'code');
  const requestId = stringOf(error, 'requestId');
  if (status === 401) return new PlanRequestFailed('operator_reauthentication_required', status, requestId);
  if (status === 403 || status === 404) return new PlanRequestFailed('plan_not_found', status, requestId);
  if (status === 429) return new PlanRequestFailed('plan_request_rate_limited', status, requestId);
  if (code) return new PlanRequestFailed(code, status, requestId);
  if (status && status >= 500) return new PlanRequestFailed('elements_api_unavailable', status, requestId);
  return new PlanRequestFailed('plan_request_failed', status, requestId);
}

function stringOf(error: unknown, key: string): string | undefined {
  const value = (error as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberOf(error: unknown, key: string): number | undefined {
  const value = (error as Record<string, unknown> | null)?.[key];
  return typeof value === 'number' ? value : undefined;
}
