import { NoItemsPlaceholder, Stack } from '@main-components';
import { PlanCard } from '../PlanCard';
import type { GroupingAsset, PlanDraft, PlanGroupingSurfaceProps } from '../../types';
import type { usePlanGrouping } from '../../hooks/use-plan-grouping';
import { planCapacity, planUsage } from '../../capacity';
import type { useAssetSelection } from '../../hooks/use-asset-selection';

function draggedAssets(ids: string[], target: PlanDraft, source: GroupingAsset[]) {
  if (ids.some((id) => !source.some((asset) => asset.id === id && asset.valid !== false)))
    return [];
  const additions = ids.filter((id) => !target.assignedAssets?.some((asset) => asset.id === id));
  const assets = additions.map((id) => source.find((asset) => asset.id === id));
  return assets.filter((asset): asset is GroupingAsset => Boolean(asset));
}

type PlanDraftListProps = {
  plans: PlanGroupingSurfaceProps['plans'];
  selectedPlan?: PlanGroupingSurfaceProps['plans'][number];
  unassigned: PlanGroupingSurfaceProps['unassigned'];
  grouping: ReturnType<typeof usePlanGrouping>;
  onAssign?: PlanGroupingSurfaceProps['onAssign'];
  onEditPlan?: (plan: PlanGroupingSurfaceProps['plans'][number]) => void;
  onDeletePlan?: PlanGroupingSurfaceProps['onDeletePlan'];
  onSelectPlan?: PlanGroupingSurfaceProps['onSelectPlan'];
  onUnassign?: PlanGroupingSurfaceProps['onUnassign'];
  onAssignMany?: PlanGroupingSurfaceProps['onAssignMany'];
  selection?: ReturnType<typeof useAssetSelection>;
};
export function PlanDraftList({
  plans,
  selectedPlan,
  unassigned,
  grouping,
  onAssign,
  onEditPlan,
  onDeletePlan,
  onSelectPlan,
  onUnassign,
  onAssignMany,
  selection,
}: PlanDraftListProps) {
  const source = [...unassigned, ...plans.flatMap((plan) => plan.assignedAssets ?? [])];
  const dragIds = selection?.dragIds.length
    ? selection.dragIds
    : grouping.draggedId
      ? [grouping.draggedId]
      : [];
  return (
    <Stack gap="s" className="plan-grouping-plans" style={{ flex: '1 1 auto', minWidth: 0 }}>
      {plans.length ? (
        plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            selected={plan.id === selectedPlan?.id}
            dropState={grouping.dropState[plan.id] ?? 'idle'}
            selection={selection}
            onEdit={onEditPlan ? () => onEditPlan(plan) : undefined}
            onDelete={onDeletePlan ? () => onDeletePlan(plan) : undefined}
            onSelect={() => onSelectPlan?.(plan)}
            onDragOver={() =>
              grouping.updateDrop(
                plan,
                dragIds.length &&
                  draggedAssets(dragIds, plan, source).length > 0 &&
                  planUsage(plan) + draggedAssets(dragIds, plan, source).length <=
                    planCapacity(plan)
                  ? 'over-valid'
                  : 'over-invalid',
              )
            }
            onDragLeave={() => grouping.updateDrop(plan, 'idle')}
            onDrop={() => {
              const assets = draggedAssets(dragIds, plan, source);
              if (assets.length && planUsage(plan) + assets.length <= planCapacity(plan)) {
                if (onAssignMany) onAssignMany(assets, plan);
                else if (dragIds.length === 1) grouping.drop(assets[0], plan, onAssign);
              }
              grouping.endDrag();
              selection?.endDrag();
            }}
            onMoveAsset={
              selectedPlan && selectedPlan.id !== plan.id
                ? (asset) => grouping.assign(asset, selectedPlan, onAssign)
                : undefined
            }
            onRemoveAsset={onUnassign ? (asset) => onUnassign(asset, plan) : undefined}
          />
        ))
      ) : (
        <NoItemsPlaceholder description="Create a draft Plan to organize accepted Assets." />
      )}
    </Stack>
  );
}
