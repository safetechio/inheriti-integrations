import type { CliContext } from '../session.js';

export interface Candidate {
  readonly value: string;
  readonly description?: string;
}

/** One page is enough for both callers: a picker nobody scrolls and a shell that filters by prefix. */
const CANDIDATE_LIMIT = 100;

export async function planCandidates(context: CliContext): Promise<Candidate[]> {
  const page = await context.core.listPlans({ limit: CANDIDATE_LIMIT });
  return page.items.map((plan) => ({ value: plan.id, description: plan.name }));
}

/**
 * The `code.field` selectors a reveal accepts, which is the thing nobody remembers: the code is the
 * developer's own, and the field names come from the asset's type.
 */
export async function fieldCandidates(context: CliContext, planId: string): Promise<Candidate[]> {
  const plan = await context.core.getPlan(planId);
  return (plan.assets ?? []).flatMap((asset) => (asset.fieldNames ?? []).map((field) => ({
    value: `${asset.code ?? asset.id}.${field}`,
    description: asset.name,
  })));
}
