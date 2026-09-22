import type { PlanDetail, PlanSummary } from '@safetech/inheriti-elements-core/node';

export function planSummary(plan: PlanSummary) {
  return {
    id: plan.id,
    name: plan.name,
    status: plan.status,
    createdAt: plan.createdAt,
    assetCount: plan.assetSummary.names.length,
  };
}

export function planDetail(plan: PlanDetail) {
  return {
    ...planSummary(plan),
    description: plan.description,
    governanceMode: plan.governance.mode,
    assets: plan.assets.map(({ id, name, type, isBinary }) => ({ id, name, type, isBinary })),
  };
}
