import type { FlowState } from './flow-reducer';
import type { GroupingAsset, PlanDraft } from '../../PlanGroupingSurface';
import { hasPlanCapacity } from '../../PlanGroupingSurface/capacity';
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
