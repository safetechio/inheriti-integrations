import { Badge, Box, Icon, IconAction, Meter, Pressable, Stack, Text } from '@main-components';
import { keyboardActivation } from '@modules/_shared/ui/keyboard-activation';
import { AssignedAssets } from '../AssignedAssets';
import { PlanAlerts } from '../PlanAlerts';
import type { DropState, GroupingAsset, PlanDraft } from '../../types';
import { planCapacity, planUsage } from '../../capacity';

type PlanCardProps = {
  plan: PlanDraft;
  selected: boolean;
  onSelect: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  dropState: DropState;
  onMoveAsset?: (asset: GroupingAsset) => void;
  onRemoveAsset?: (asset: GroupingAsset) => void;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDrop: () => void;
};
export function PlanCard({
  plan,
  selected,
  onSelect,
  onEdit,
  onDelete,
  onMoveAsset,
  onRemoveAsset,
  dropState,
  onDragOver,
  onDragLeave,
  onDrop,
}: PlanCardProps) {
  const capacityUsed = planUsage(plan);
  const capacityLimit = planCapacity(plan);
  const capacityRatio = capacityUsed / capacityLimit;
  const overCapacity = capacityRatio > 1;
  return (
    <Box
      className={`plan-drop-target plan-grouping-plan ${dropState} ${selected ? 'is-selected' : ''}`}
      padding="m"
      gap="s"
      borderRadius="s"
      borderWidth={1}
      borderColor="primary30"
      backgroundColor="white"
      onDragOver={(event: DragEvent) => {
        event.preventDefault();
        onDragOver();
      }}
      onDragLeave={onDragLeave}
      onDrop={(event: DragEvent) => {
        event.preventDefault();
        onDrop();
      }}
    >
      <Stack gap="s">
        <Box
          className="plan-card-header"
          flexDirection="row"
          justifyContent="space-between"
          alignItems="center"
        >
          <Pressable
            onPress={onSelect}
            accessibilityRole="button"
            accessibilityLabel={`Select ${plan.name}`}
            style={{ flex: 1 }}
            {...keyboardActivation(onSelect)}
          >
            <Box flexDirection="row" alignItems="center" gap="s">
              <Icon name="layer-group" size={15} />
              <Text variant="importerPlanTitle">{plan.name}</Text>
            </Box>
          </Pressable>
          <Box flexDirection="row" alignItems="center" gap="s">
            {onEdit ? (
              <IconAction name="pen-to-square" label={`Edit ${plan.name}`} onPress={onEdit} />
            ) : null}
            {onDelete ? (
              <IconAction name="trash" label={`Delete ${plan.name}`} onPress={onDelete} />
            ) : null}
            {selected ? (
              <Badge size="sm" tone="primary" variant="soft" emphasis="selected">
                Selected
              </Badge>
            ) : null}
            <Badge
              tone={overCapacity ? 'danger' : plan.valid ? 'success' : 'warning'}
              icon={overCapacity || !plan.valid ? 'circle-exclamation' : 'circle-check'}
            >
              {overCapacity ? 'Over capacity' : plan.valid ? 'Valid draft' : 'Needs review'}
            </Badge>
          </Box>
        </Box>
        {plan.description ? (
          <Text className="plan-card-description" variant="importerPlanBody" color="gray">
            {plan.description}
          </Text>
        ) : null}
        <Box gap="xs">
          <Box flexDirection="row" justifyContent="space-between" gap="s">
            <Text variant="importerPlanBody" color="gray">
              {capacityUsed} of {capacityLimit} Assets
            </Text>
            <Text
              variant="importerPlanBody"
              color={
                overCapacity
                  ? 'danger120'
                  : plan.capacityWarning || capacityRatio >= 0.8
                    ? 'warning120'
                    : 'success120'
              }
              semibold
            >
              {overCapacity
                ? 'Advisory limit exceeded'
                : `${capacityLimit - capacityUsed} slots left`}
            </Text>
          </Box>
          <Meter
            value={capacityUsed}
            max={capacityLimit}
            tone={
              overCapacity
                ? 'danger'
                : plan.capacityWarning || capacityRatio >= 0.8
                  ? 'warning'
                  : 'success'
            }
            label={`${capacityUsed} of ${capacityLimit} assets used`}
          />
        </Box>
        {plan.assignedAssets?.length ? (
          <AssignedAssets
            assets={plan.assignedAssets}
            onMove={onMoveAsset}
            onRemove={onRemoveAsset}
          />
        ) : null}
        <Box className="plan-drop-zone">
          <Text variant="importerPlanBody">
            {dropState === 'over-valid'
              ? `Drop to add to ${plan.name}`
              : dropState === 'over-invalid'
                ? 'This plan cannot accept it'
                : 'Drag an Asset here'}
          </Text>
        </Box>
        <PlanAlerts plan={plan} dropState={dropState} showGovernance={selected} />
      </Stack>
    </Box>
  );
}
