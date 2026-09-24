import type { CliContext } from '../session.js';

export interface Candidate {
  readonly value: string;
  readonly label?: string;
  readonly description?: string;
}

/** One page is enough for both callers: a picker nobody scrolls and a shell that filters by prefix. */
const CANDIDATE_LIMIT = 100;

export async function planCandidates(context: CliContext): Promise<Candidate[]> {
  const page = await context.core.listPlans({ limit: CANDIDATE_LIMIT });
  return page.items.map((plan) => ({ value: plan.id, description: plan.name }));
}

export async function organizationCandidates(context: CliContext): Promise<Candidate[]> {
  return (await context.core.listOrganizations()).map(({ id, name }) => ({ value: id, description: name }));
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

export async function assetCandidates(context: CliContext, planId: string): Promise<Candidate[]> {
  const plan = await context.core.getPlan(planId);
  return (plan.assets ?? []).map((asset) => ({ value: asset.code ?? asset.id, description: asset.name }));
}
