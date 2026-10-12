import { NoItemsPlaceholder, Stack } from '@main-components';
import { PlanCard } from './PlanCard';
import type { PlanGroupingSurfaceProps } from '../types';
import type { usePlanGrouping } from '../hooks/use-plan-grouping';
import { hasPlanCapacity } from '../capacity';

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
}: PlanDraftListProps) {
  return (
    <Stack gap="s" className="plan-grouping-plans" style={{ flex: '2 1 420px', minWidth: 0 }}>
      {plans.length ? (
        plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            selected={plan.id === selectedPlan?.id}
            dropState={grouping.dropState[plan.id] ?? 'idle'}
            onEdit={onEditPlan ? () => onEditPlan(plan) : undefined}
            onDelete={onDeletePlan ? () => onDeletePlan(plan) : undefined}
            onSelect={() => onSelectPlan?.(plan)}
            onDragOver={() =>
              grouping.updateDrop(
                plan,
                grouping.draggedId && hasPlanCapacity(plan) ? 'over-valid' : 'over-invalid',
              )
            }
            onDragLeave={() => grouping.updateDrop(plan, 'idle')}
            onDrop={() =>
              hasPlanCapacity(plan)
                ? grouping.drop(
                    unassigned.find((asset) => asset.id === grouping.draggedId),
                    plan,
                    onAssign,
                  )
                : undefined
            }
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
