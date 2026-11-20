import {
  hasIncludedSchemaField,
  type AssetReviewStatus,
  type ReviewBatchAction,
  type ReviewBatchResult,
} from '../../AssetReviewQueue/types';
import { planCapacity } from '../../PlanGroupingSurface/capacity';
import type { GroupingAsset, PlanDraft } from '../../PlanGroupingSurface';
import type { FlowState } from './flow-reducer';

export type ReviewBatchUndo = {
  statuses: Map<string, AssetReviewStatus>;
  unassigned: GroupingAsset[];
  affectedPlans: Map<string, PlanDraft>;
};

export function getReviewBatchResult(
  assets: FlowState['assets'],
  action: ReviewBatchAction,
  ids: string[],
): ReviewBatchResult {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const result: ReviewBatchResult = { changedIds: [], skippedIds: [] };
  for (const id of new Set(ids)) {
    const asset = byId.get(id);
    const eligible =
      asset &&
      (action === 'accept'
        ? asset.status !== 'accepted' && hasIncludedSchemaField(asset)
        : asset.status !== 'excluded');
    (eligible ? result.changedIds : result.skippedIds).push(id);
  }
  return result;
}

export function reviewBatch(state: FlowState, action: ReviewBatchAction, ids: string[]): FlowState {
  const { changedIds } = getReviewBatchResult(state.assets, action, ids);
  if (!changedIds.length) return state;

  const changed = new Set(changedIds);
  const statuses = new Map<string, AssetReviewStatus>();
  const reviewed = new Map<string, GroupingAsset>();
  const affectedPlans = new Map<string, PlanDraft>();
  const status: AssetReviewStatus = action === 'accept' ? 'accepted' : 'excluded';
  const assets = state.assets.map((asset) => {
    if (!changed.has(asset.id)) return asset;
    const { id, name, type, source, sourceId, folderPath } = asset;
    statuses.set(id, asset.status);
    reviewed.set(id, { id, name, type, source, sourceId, folderPath, valid: true });
    return { ...asset, status };
  });

  const alreadyGrouped = new Set<string>();
  const updateGrouping = (group: GroupingAsset[]) =>
    group.flatMap((asset) => {
      const updated = reviewed.get(asset.id);
      if (!updated) return [asset];
      if (action === 'exclude') return [];
      alreadyGrouped.add(asset.id);
      return [
        asset.type === updated.type && asset.valid
          ? asset
          : { ...asset, type: updated.type, valid: true },
      ];
    });
  const unassigned = updateGrouping(state.unassigned);
  const plans = state.plans.map((plan) => {
    const assigned = plan.assignedAssets ?? [];
    const assignedAssets = updateGrouping(assigned);
    if (
      assignedAssets.length === assigned.length &&
      assignedAssets.every((asset, index) => asset === assigned[index])
    )
      return plan;
    affectedPlans.set(plan.id, plan);
    const assets = Math.max(0, plan.assets - (assigned.length - assignedAssets.length));
    return {
      ...plan,
      assets,
      assignedAssets,
      capacity: assets === plan.assets ? plan.capacity : `${assets} / ${planCapacity(plan)} Assets`,
    };
  });
  if (action === 'accept') {
    for (const asset of reviewed.values()) {
      if (!alreadyGrouped.has(asset.id)) unassigned.push(asset);
    }
  }
  return {
    ...state,
    stagingState: 'configured',
    assets,
    unassigned,
    plans,
    reviewBatchUndo: { statuses, unassigned: state.unassigned, affectedPlans },
  };
}

export function undoReviewBatch(state: FlowState): FlowState {
  const undo = state.reviewBatchUndo;
  if (!undo) return state;
  return {
    ...state,
    stagingState: 'configured',
    assets: state.assets.map((asset) => {
      const status = undo.statuses.get(asset.id);
      return status ? { ...asset, status } : asset;
    }),
    unassigned: undo.unassigned,
    plans: state.plans.map((plan) => undo.affectedPlans.get(plan.id) ?? plan),
    reviewBatchUndo: undefined,
  };
}
