import type {
  GroupingAsset,
  PlanDraft as PreviewPlanDraft,
  PlanMetadataValues,
} from '../../PlanGroupingSurface';
import { suggestedAssetToDraft } from '@modules/mapping/application/suggestion-engine';
import {
  createAsset,
  createPlan,
  removeAsset,
  removePlan,
  updatePlanMetadata,
} from '@modules/plans/domain/workspace-commands';
import type { ImporterWorkspaceContext } from './use-importer-workspace';
import { assetMatchesSuggestion, statusKey } from './importer-workspace-suggestions';

export function createPlanActions(context: ImporterWorkspaceContext) {
  const { session, workspace, updateWorkspace, byId } = context;

  function assignAsset(asset: GroupingAsset, plan: PreviewPlanDraft) {
    const suggestion = byId(asset.id);
    if (!suggestion || !workspace.plansByClientId[plan.id]) return;
    updateWorkspace((current) => {
      const target = current.plansByClientId[plan.id];
      if (
        !target ||
        target.assets.some((item) => assetMatchesSuggestion(session, item, suggestion))
      )
        return current;
      return createAsset(current, {
        planClientId: plan.id,
        asset: suggestedAssetToDraft(suggestion, statusKey(suggestion)),
      });
    });
  }

  function unassignAsset(asset: GroupingAsset, plan: PreviewPlanDraft) {
    const productionPlan = workspace.plansByClientId[plan.id];
    const suggestion = byId(asset.id);
    const draft = productionPlan?.assets.find((item) =>
      suggestion ? assetMatchesSuggestion(session, item, suggestion) : item.id === asset.id,
    );
    if (draft)
      updateWorkspace((current) =>
        removeAsset(current, { planClientId: plan.id, assetId: draft.id }),
      );
  }

  function createNewPlan() {
    const clientId = crypto.randomUUID();
    updateWorkspace((current) =>
      createPlan(current, { clientId, name: `Plan ${current.planOrder.length + 1}` }),
    );
  }

  function deletePlan(plan: Pick<PreviewPlanDraft, 'id'>) {
    updateWorkspace((current) => removePlan(current, { clientId: plan.id }));
  }

  function editPlanMetadata(plan: Pick<PreviewPlanDraft, 'id'>, values: PlanMetadataValues) {
    updateWorkspace((current) =>
      updatePlanMetadata(current, {
        clientId: plan.id,
        name: values.name,
        description: values.description,
      }),
    );
  }

  return {
    assignAsset,
    unassignAsset,
    createPlan: createNewPlan,
    deletePlan,
    updatePlanMetadata: editPlanMetadata,
  };
}
