import type { PlanCreationOrgPolicy } from '@modules/organization/infrastructure/importer-api';
import { materialisePlanAssets } from '@modules/plans/domain/asset-materializer';
import type { ImportSession } from '@modules/import/domain/import-model';
import type { PlanDraft } from '@modules/plans/domain/workspace-model';
import type { PlanBatchInput } from '../domain/plan-batch-input';
import { buildPlanCreatePayload } from './plan-create-payload';

/**
 * Materialises a `PlanDraft`'s bound Assets and maps it to the Core create
 * payload (architecture §6.1 step 4). Pure — no hooks, no I/O — so it is
 * unit-testable without mounting the workspace.
 */
export function buildPlanBatchInput(params: {
  plan: PlanDraft;
  session: ImportSession;
  organizationId: string;
  creatorMemberId?: string;
  approvalModeFallback?: PlanCreationOrgPolicy['approvalMode'];
  totalShares: number;
}): PlanBatchInput {
  const { plan, session, organizationId, creatorMemberId, approvalModeFallback, totalShares } =
    params;
  const materialised = materialisePlanAssets(plan, session);
  const payload = buildPlanCreatePayload({
    tenantId: organizationId,
    type: plan.type,
    name: plan.name,
    description: plan.description,
    sharingModel: plan.governance.sharingModel,
    teamIds: plan.teamIds,
    memberId: creatorMemberId,
    creatorMemberId,
    moderatedAccess: plan.governance.moderatedAccess,
    selectedModeratorIds: plan.governance.extraModeratorIds,
    requestedMinimumApprovals: plan.governance.requestedMinimumApprovals,
    requireAuth: plan.governance.authenticationMethodIds.length > 0,
    authenticationMethodIds: plan.governance.authenticationMethodIds,
    authenticationMode: plan.governance.authenticationMode,
    approvalMode: plan.governance.approvalMode ?? approvalModeFallback,
    categoryId: plan.categoryId,
    assets: materialised.assets,
  });
  // `buildSharedPlanCreatePayload`'s return type has no index signature;
  // `PlanBatchInput.payload` is spread positionally into `create.execute`
  // (never keyed into by name here), so a structural widening is safe.
  return {
    plan,
    assets: materialised.assets,
    payload: payload as unknown as Record<string, unknown>,
    totalShares,
  };
}
