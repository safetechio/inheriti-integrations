import type {
  PlanDraft,
  PlanDraftStatus,
  WorkspaceState,
} from '@modules/plans/domain/workspace-model';

/**
 * Read-only views over the workspace. All pure; the UI subscribes to these.
 */

export interface PlanDraftIssue {
  code:
    | 'NO_NAME'
    | 'NO_ASSETS'
    | 'ASSET_INCOMPLETE'
    | 'POLICY_VIOLATION'
    | 'STALE_REFERENCE'
    | 'OVER_LIMIT';
  message: string;
  assetId?: string;
}

export interface PlanDraftView {
  clientId: string;
  name: string;
  assetCount: number;
  status: PlanDraftStatus;
  issues: PlanDraftIssue[];
}

export interface WorkspaceSummary {
  planCount: number;
  assetCount: number;
  validPlanCount: number;
  invalidPlanCount: number;
  boundSourceFieldCount: number;
  ignoredSourceFieldCount: number;
}

export function listPlanDrafts(state: WorkspaceState): PlanDraft[] {
  return state.planOrder.map((id) => state.plansByClientId[id]).filter((p): p is PlanDraft => !!p);
}

export function boundSourceFieldIds(state: WorkspaceState): Set<string> {
  const ids = new Set<string>();
  for (const plan of listPlanDrafts(state)) {
    for (const asset of plan.assets) {
      for (const binding of Object.values(asset.fieldBindings)) {
        if (binding.kind === 'source') ids.add(binding.sourceFieldId);
        if (binding.kind === 'sources')
          binding.sources.forEach((source) => ids.add(source.sourceFieldId));
      }
    }
  }
  return ids;
}

export function planDraftView(plan: PlanDraft, extraIssues: PlanDraftIssue[] = []): PlanDraftView {
  const issues: PlanDraftIssue[] = [...extraIssues];

  if (!plan.name.trim()) issues.push({ code: 'NO_NAME', message: 'The Plan needs a name.' });
  if (plan.assets.length === 0)
    issues.push({ code: 'NO_ASSETS', message: 'Add at least one Asset.' });
  for (const asset of plan.assets) {
    if (Object.keys(asset.fieldBindings).length === 0) {
      issues.push({
        code: 'ASSET_INCOMPLETE',
        message: `${asset.name || 'Asset'} has no mapped or literal fields.`,
        assetId: asset.id,
      });
    }
  }

  const status: PlanDraftStatus = issues.length === 0 ? 'VALID' : 'INVALID';

  return {
    clientId: plan.clientId,
    name: plan.name,
    assetCount: plan.assets.length,
    status,
    issues,
  };
}

export function workspaceSummary(state: WorkspaceState, views: PlanDraftView[]): WorkspaceSummary {
  const assetCount = listPlanDrafts(state).reduce((sum, p) => sum + p.assets.length, 0);
  return {
    planCount: state.planOrder.length,
    assetCount,
    validPlanCount: views.filter((v) => v.status === 'VALID').length,
    invalidPlanCount: views.filter((v) => v.status === 'INVALID').length,
    boundSourceFieldCount: boundSourceFieldIds(state).size,
    ignoredSourceFieldCount: state.ignoredSourceFieldIds.length,
  };
}
