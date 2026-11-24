import type {
  GroupingAsset,
  PlanDraft as PreviewPlanDraft,
  PlanMetadataValues,
} from '../../PlanGroupingSurface';
import { suggestedAssetToDraft } from '@modules/mapping/application/suggestion-engine';
import { planCapacity } from '../../PlanGroupingSurface/capacity';
import { hasIncludedSchemaField } from '../../AssetReviewQueue/types';
import {
  assignAssetsToPlan,
  createPlansFromAssets as createPlansFromAssetsCommand,
  unassignAssetsFromPlans,
  type BulkAssetSelection,
} from '@modules/plans/domain/workspace-bulk-commands';
import {
  createPlan,
  movePlansToFolder as movePlansToFolderCommand,
  removePlan,
  removePlans,
  reorderPlans,
  updatePlanMetadata,
} from '@modules/plans/domain/workspace-commands';
import type { ImporterWorkspaceContext } from './use-importer-workspace';
import { assetMatchesSuggestion, statusKey } from './importer-workspace-suggestions';
import {
  autoGroupUnassigned as groupUnassigned,
  type AutoGroupSelection,
} from '@modules/plans/domain/workspace-auto-group';

export function createPlanActions(context: ImporterWorkspaceContext) {
  const { session, updateWorkspace, byId, projection } = context;

  function selection(asset: GroupingAsset): BulkAssetSelection | undefined {
    const suggestion = byId(asset.id);
    if (!suggestion) return;
    return {
      id: asset.id,
      accepted: projection.assets.some(
        (item) =>
          item.id === asset.id && item.status === 'accepted' && hasIncludedSchemaField(item),
      ),
      draft: suggestedAssetToDraft(suggestion, statusKey(suggestion)),
      matches: (item) => assetMatchesSuggestion(session, item, suggestion),
    };
  }

  function assignAssets(assets: GroupingAsset[], plan: PreviewPlanDraft) {
    const selections = assets.map(selection);
    if (selections.some((item) => item === undefined)) return;
    updateWorkspace((current) =>
      assignAssetsToPlan(
        current,
        plan.id,
        selections.filter((item): item is BulkAssetSelection => item !== undefined),
        planCapacity(plan),
      ),
    );
  }

  function assignAsset(asset: GroupingAsset, plan: PreviewPlanDraft) {
    assignAssets([asset], plan);
  }

  function unassignAssets(assets: GroupingAsset[]) {
    const selections = assets.map((asset) => {
      const suggestion = byId(asset.id);
      return {
        id: asset.id,
        matches: (item: BulkAssetSelection['draft']) =>
          suggestion ? assetMatchesSuggestion(session, item, suggestion) : item.id === asset.id,
      };
    });
    updateWorkspace((current) => unassignAssetsFromPlans(current, selections));
  }

  function unassignAsset(asset: GroupingAsset, _plan: PreviewPlanDraft) {
    unassignAssets([asset]);
  }

  function createNewPlan(options?: {
    name?: string;
    folderId?: string | null;
    scope?: 'SHARED' | 'PERSONAL';
  }) {
    const clientId = crypto.randomUUID();
    updateWorkspace((current) => {
      const created = createPlan(current, {
        clientId,
        name: options?.name ?? `Plan ${current.planOrder.length + 1}`,
        folderId: options?.folderId,
        scope: options?.scope,
      });
      return reorderPlans(created, { order: [clientId, ...current.planOrder] });
    });
    return clientId;
  }

  function createPlansFromAssets(
    assets: GroupingAsset[],
    options: { name: string; folderId: string | null; scope: 'SHARED' | 'PERSONAL' },
  ) {
    const selections = assets.map(selection);
    if (!assets.length || selections.some((item) => !item?.accepted)) return [];
    const ready = selections.filter((item): item is BulkAssetSelection => item !== undefined);
    const ids = Array.from({ length: Math.ceil(ready.length / 10) }, () => crypto.randomUUID());
    const result = createPlansFromAssetsCommand(context.workspace, ready, ids, options);
    if (result === context.workspace) return [];
    updateWorkspace((current) => createPlansFromAssetsCommand(current, ready, ids, options));
    return ids;
  }

  function autoGroupUnassigned(preserveStructure: boolean) {
    const assets = projection.unassigned.filter((asset) => asset.valid);
    if (!assets.length) return;
    const selections = assets.map((asset): AutoGroupSelection | undefined => {
      const selected = selection(asset);
      if (!selected || !asset.sourceId) return;
      return {
        ...selected,
        sourceId: asset.sourceId,
        sourceName: asset.source ?? asset.sourceId,
        folderPath: asset.folderPath ?? [],
      };
    });
    if (selections.some((item) => !item)) return;
    const ready = selections.filter((item): item is AutoGroupSelection => item !== undefined);
    const ids = assets.map(() => crypto.randomUUID());
    updateWorkspace((current) => groupUnassigned(current, ready, preserveStructure, ids, 10));
    return ids[0];
  }

  function deletePlan(plan: Pick<PreviewPlanDraft, 'id'>) {
    updateWorkspace((current) => removePlan(current, { clientId: plan.id }));
  }


  function deletePlans(plans: Pick<PreviewPlanDraft, 'id'>[]) {
    updateWorkspace((current) => removePlans(current, { clientIds: plans.map((plan) => plan.id) }));
  }

  function editPlanMetadata(plan: Pick<PreviewPlanDraft, 'id'>, values: PlanMetadataValues) {
    updateWorkspace((current) =>
      updatePlanMetadata(current, {
        clientId: plan.id,
        name: values.name,
        description: values.description,
        folderId: values.folderId,
        scope: values.scope,
      }),
    );
  }

  function movePlansToFolder(
    plans: PreviewPlanDraft[],
    folderId: string | null,
    scope: 'SHARED' | 'PERSONAL',
  ) {
    updateWorkspace((current) =>
      movePlansToFolderCommand(current, { clientIds: plans.map((plan) => plan.id), folderId, scope }),
    );
  }

  return {
    assignAsset,
    assignAssets,
    unassignAsset,
    unassignAssets,
    createPlan: createNewPlan,
    createPlansFromAssets,
    autoGroupUnassigned,
    deletePlan,
    deletePlans,
    updatePlanMetadata: editPlanMetadata,
    movePlansToFolder,
  };
}
