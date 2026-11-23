import type { PlanBatchControllerItem } from '@modules/batch/application/use-plan-batch-controller';

export type StagingOutcome = 'Not staged' | 'Staging' | 'Staging failed' | 'Staged' | 'Cancelled';

export interface StagingBatchPlan {
  planId: string;
  name: string;
  outcome: StagingOutcome;
  retry: 'create' | 'configure' | null;
}

export function projectStagingBatch(
  items: readonly PlanBatchControllerItem[],
  plans: readonly { id: string; name: string }[],
) {
  const namesById = new Map<string, string>();
  for (const plan of plans) {
    if (!namesById.has(plan.id)) namesById.set(plan.id, plan.name);
  }
  const projected: StagingBatchPlan[] = items.map((item) => ({
    planId: item.planId,
    name: namesById.get(item.planId) ?? item.planId,
    outcome: stagingOutcome(item.status),
    retry:
      item.status === 'FAILED_CREATE'
        ? 'create'
        : item.status === 'FAILED_CONFIGURE' || item.status === 'CREATED'
          ? 'configure'
          : null,
  }));
  return {
    plans: projected,
    completed: projected.filter((plan) => plan.outcome === 'Staged').length,
    current: projected.find((plan) => plan.outcome === 'Staging')?.name ?? null,
    pending: projected.filter((plan) => plan.outcome === 'Not staged').length,
    cancelled: projected.filter((plan) => plan.outcome === 'Cancelled').length,
  };
}

export function stagingOutcome(status: string): StagingOutcome {
  switch (status) {
    case 'COMPLETE':
      return 'Staged';
    case 'FAILED_CREATE':
      return 'Staging failed';
    case 'FAILED_CONFIGURE':
      return 'Staging failed';
    case 'CANCELLED':
      return 'Cancelled';
    case 'PENDING':
    case 'CREATED':
      return 'Not staged';
    default:
      return 'Staging';
  }
}
