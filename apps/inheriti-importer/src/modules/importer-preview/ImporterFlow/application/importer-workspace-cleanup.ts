import type { ImportSession } from '@modules/import/domain/import-model';
import type { AssetDraft, PlanDraft, WorkspaceState } from '@modules/plans/domain/workspace-model';

function bindingUsesSource(binding: AssetDraft['fieldBindings'][string], fieldIds: Set<string>) {
  if (binding.kind === 'source') return fieldIds.has(binding.sourceFieldId);
  return (
    binding.kind === 'sources' &&
    binding.sources.some((source) => fieldIds.has(source.sourceFieldId))
  );
}

function belongsToSource(asset: AssetDraft, nodeIds: Set<string>, fieldIds: Set<string>): boolean {
  // Suggested asset IDs start with their source node ID.
  if (nodeIds.has(asset.id.slice(0, asset.id.lastIndexOf(':')))) return true;
  return Object.values(asset.fieldBindings).some((binding) => bindingUsesSource(binding, fieldIds));
}

function retainedPlan(
  plan: PlanDraft,
  nodeIds: Set<string>,
  fieldIds: Set<string>,
): PlanDraft | null {
  const assets = plan.assets.filter((asset) => !belongsToSource(asset, nodeIds, fieldIds));
  if (plan.assets.length > 0 && assets.length === 0) return null;
  return { ...plan, assets };
}

function sourceIds(session: ImportSession, sourceId: string) {
  const fieldIds = new Set(
    Object.values(session.fieldsById)
      .filter((field) => field.sourceId === sourceId)
      .map((field) => field.id),
  );
  const nodeIds = new Set(
    Object.values(session.nodesById)
      .filter((node) => node.sourceId === sourceId)
      .map((node) => node.id),
  );
  return { fieldIds, nodeIds };
}

export function removeSourceFromWorkspace(
  session: ImportSession,
  workspace: WorkspaceState,
  sourceId: string,
): WorkspaceState {
  const { fieldIds, nodeIds } = sourceIds(session, sourceId);
  const plansByClientId = Object.fromEntries(
    Object.entries(workspace.plansByClientId).flatMap(([id, plan]) => {
      const retained = retainedPlan(plan, nodeIds, fieldIds);
      return retained ? [[id, retained]] : [];
    }),
  );
  const planOrder = workspace.planOrder.filter((id) => Boolean(plansByClientId[id]));
  const ignoredSourceFieldIds = workspace.ignoredSourceFieldIds.filter((id) => !fieldIds.has(id));
  const changed =
    planOrder.length !== workspace.planOrder.length ||
    workspace.planOrder.some(
      (id) => plansByClientId[id]?.assets.length !== workspace.plansByClientId[id]?.assets.length,
    ) ||
    ignoredSourceFieldIds.length !== workspace.ignoredSourceFieldIds.length;

  return changed
    ? {
        ...workspace,
        planOrder,
        plansByClientId,
        ignoredSourceFieldIds,
        revision: workspace.revision + 1,
      }
    : workspace;
}

export function clearWorkspaceLiterals(
  workspace: WorkspaceState,
  nodeIds?: ReadonlySet<string>,
): void {
  for (const plan of Object.values(workspace.plansByClientId)) {
    for (const asset of plan.assets) {
      // Only discarded source assets may lose their literal secrets.
      if (nodeIds && !nodeIds.has(asset.id.slice(0, asset.id.lastIndexOf(':')))) continue;
      for (const binding of Object.values(asset.fieldBindings)) {
        if (binding.kind === 'literal') binding.value.clear();
      }
    }
  }
}
