import type { FlowState } from './flow-reducer';
import type { ReviewAsset } from '../../AssetReviewQueue';
import type { PlanDraft } from '../../PlanGroupingSurface';

export function removeAsset(plans: PlanDraft[], assetId: string) {
  return plans.map((plan) => {
    const assigned = plan.assignedAssets ?? [];
    return assigned.some((item) => item.id === assetId)
      ? {
          ...plan,
          assets: Math.max(0, plan.assets - 1),
          assignedAssets: assigned.filter((item) => item.id !== assetId),
        }
      : plan;
  });
}
export function reviewAsset(
  state: FlowState,
  action: string,
  asset: ReviewAsset,
  autoAdvance = true,
): FlowState {
  if (action === 'exclude') {
    const assets = state.assets.map((item) =>
      item.id === asset.id ? { ...item, status: 'excluded' as const } : item,
    );
    return {
      ...state,
      stagingState: 'configured',
      assets,
      selectedAssetId: autoAdvance ? nextReviewId(assets, asset.id) : asset.id,
      unassigned: state.unassigned.filter((item) => item.id !== asset.id),
      plans: removeAsset(state.plans, asset.id),
    };
  }
  const alternateType = action.startsWith('alternate:')
    ? action.slice('alternate:'.length)
    : undefined;
  const type = action === 'fallback' ? 'PLAIN-TEXT' : alternateType ? alternateType : asset.type;
  const alternatives = alternateType
    ? asset.alternatives.filter((item) => item !== alternateType).concat(asset.type)
    : asset.alternatives;
  if (alternateType && asset.status === 'excluded') {
    return {
      ...state,
      stagingState: 'configured',
      assets: state.assets.map((item) =>
        item.id === asset.id ? { ...item, type, alternatives } : item,
      ),
    };
  }
  const assigned = state.plans.some((plan) =>
    plan.assignedAssets?.some((item) => item.id === asset.id),
  );
  const unassigned = assigned
    ? state.unassigned
    : state.unassigned.some((item) => item.id === asset.id)
      ? state.unassigned.map((item) =>
          item.id === asset.id ? { ...item, type, valid: true } : item,
        )
      : [...state.unassigned, { id: asset.id, name: asset.name, type, valid: true }];
  const assets = state.assets.map((item) =>
    item.id === asset.id
      ? {
          ...item,
          status: alternateType ? item.status : ('accepted' as const),
          type,
          alternatives,
        }
      : item,
  );
  return {
    ...state,
    stagingState: 'configured',
    assets,
    selectedAssetId: alternateType || !autoAdvance ? asset.id : nextReviewId(assets, asset.id),
    unassigned,
    plans: state.plans.map((plan) => ({
      ...plan,
      assignedAssets: (plan.assignedAssets ?? []).map((item) =>
        item.id === asset.id ? { ...item, type, valid: true } : item,
      ),
    })),
  };
}

function nextReviewId(assets: ReviewAsset[], currentId: string) {
  const currentIndex = assets.findIndex((item) => item.id === currentId);
  const ordered = assets.slice(currentIndex + 1).concat(assets.slice(0, currentIndex));
  return ordered.find((item) => !['accepted', 'excluded'].includes(item.status))?.id ?? currentId;
}
