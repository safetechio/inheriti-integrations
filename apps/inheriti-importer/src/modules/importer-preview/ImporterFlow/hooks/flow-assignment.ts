import type { FlowState } from './flow-reducer';
import type { GroupingAsset, PlanDraft } from '../../PlanGroupingSurface';
import { hasPlanCapacity, planCapacity } from '../../PlanGroupingSurface/capacity';

export function assignAssets(
  state: FlowState,
  assets: GroupingAsset[],
  plan: PlanDraft,
): FlowState {
  const target = state.plans.find((item) => item.id === plan.id);
  const ids = new Set(assets.map((asset) => asset.id));
  const available = [
    ...state.unassigned,
    ...state.plans.flatMap((item) => item.assignedAssets ?? []),
  ];
  const selected = [...ids].map((id) => available.find((asset) => asset.id === id));
  if (!target || !selected.length || selected.some((asset) => !asset?.valid)) return state;
  const additions = selected.filter(
    (asset) => !target.assignedAssets?.some((item) => item.id === asset?.id),
  );
  if (target.assets + additions.length > planCapacity(target)) return state;
  return additions.reduce((current, asset) => {
    const latest = current.plans.find((item) => item.id === target.id);
    return asset && latest ? assignAsset(current, asset, latest) : current;
  }, state);
}

export function unassignAssets(state: FlowState, assets: GroupingAsset[]): FlowState {
  const ids = new Set(assets.map((asset) => asset.id));
  const assigned = state.plans.flatMap((plan) =>
    (plan.assignedAssets ?? []).filter((asset) => ids.has(asset.id)),
  );
  if (!ids.size || assigned.length !== ids.size) return state;
  return assigned.reduce((current, asset) => {
    const plan = current.plans.find((item) =>
      item.assignedAssets?.some((candidate) => candidate.id === asset.id),
    );
    return plan ? unassignAsset(current, asset, plan) : current;
  }, state);
}
export function assignAsset(state: FlowState, asset: GroupingAsset, plan: PlanDraft): FlowState {
  if (!asset.valid || !hasPlanCapacity(plan)) return state;
  const previous = state.plans.find((item) =>
    item.assignedAssets?.some((assigned) => assigned.id === asset.id),
  );
  return {
    ...state,
    stagingState: 'configured',
    unassigned: state.unassigned.filter((item) => item.id !== asset.id),
    plans: state.plans.map((item) => {
      const assignedAssets =
        item.id === plan.id
          ? [...(item.assignedAssets ?? []).filter((assigned) => assigned.id !== asset.id), asset]
          : (item.assignedAssets ?? []).filter((assigned) => assigned.id !== asset.id);
      const delta =
        item.id === plan.id && previous?.id !== plan.id
          ? 1
          : item.id === previous?.id && previous.id !== plan.id
            ? -1
            : 0;
      return {
        ...item,
        assets: Math.max(0, item.assets + delta),
        assignedAssets,
      };
    }),
  };
}

export function unassignAsset(state: FlowState, asset: GroupingAsset, plan: PlanDraft): FlowState {
  const assigned = plan.assignedAssets?.find((item) => item.id === asset.id);
  if (!assigned) return state;
  return {
    ...state,
    stagingState: 'configured',
    unassigned: state.unassigned.some((item) => item.id === asset.id)
      ? state.unassigned
      : [...state.unassigned, assigned],
    plans: state.plans.map((item) =>
      item.id === plan.id
        ? {
            ...item,
            assets: Math.max(0, item.assets - 1),
            assignedAssets: (item.assignedAssets ?? []).filter((item) => item.id !== asset.id),
          }
        : item,
    ),
  };
}
