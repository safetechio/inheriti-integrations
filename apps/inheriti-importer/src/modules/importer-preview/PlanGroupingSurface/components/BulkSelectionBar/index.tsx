import { Box, Button, Text } from '@main-components';
import { planCapacity, planUsage } from '../../capacity';
import type { GroupingAsset, PlanDraft } from '../../types';

export function BulkSelectionBar({
  assets,
  plans,
  targetId,
  onTarget,
  onClear,
  onMove,
  onUnassign,
  onCreate,
}: {
  assets: GroupingAsset[];
  plans: PlanDraft[];
  targetId: string;
  onTarget: (id: string) => void;
  onClear: () => void;
  onMove?: (assets: GroupingAsset[], plan: PlanDraft) => void;
  onUnassign?: (assets: GroupingAsset[]) => void;
  onCreate?: () => void;
}) {
  if (!assets.length) return null;
  const target = plans.find((plan) => plan.id === targetId);
  const invalid = assets.some((asset) => asset.valid === false);
  const additions = target
    ? assets.filter((asset) => !target.assignedAssets?.some((assigned) => assigned.id === asset.id))
    : [];
  const fits =
    target && additions.length > 0 && planUsage(target) + additions.length <= planCapacity(target);
  return (
    <Box flexDirection="row" alignItems="center" gap="s" className="plan-bulk-bar">
      <Text variant="bodySmall">{assets.length} selected</Text>
      <Button title="Clear selection" size="sm" variant="plain" onPress={onClear} />
      {onCreate ? (
        <Button title="New plan from selected" size="sm" onPress={onCreate} disabled={invalid} />
      ) : null}
      <select
        aria-label="Move to plan"
        value={targetId}
        onChange={(event) => onTarget(event.target.value)}
      >
        <option value="">Choose plan</option>
        {plans.map((plan) => (
          <option
            key={plan.id}
            value={plan.id}
            disabled={
              planUsage(plan) +
                assets.filter(
                  (asset) => !plan.assignedAssets?.some((assigned) => assigned.id === asset.id),
                ).length >
              planCapacity(plan)
            }
          >
            {plan.name} ({planCapacity(plan) - planUsage(plan)} available)
          </option>
        ))}
      </select>
      <Button
        title={`Move ${assets.length} assets`}
        size="sm"
        disabled={!onMove || !fits || invalid}
        onPress={() => {
          if (target && fits && !invalid) onMove?.(additions, target);
        }}
      />
      {onUnassign ? (
        <Button
          title="Unassign selected"
          size="sm"
          variant="plain"
          onPress={() => onUnassign(assets)}
        />
      ) : null}
      {invalid || (target && !fits) ? (
        <Text variant="bodySmall" color="danger120">
          {invalid
            ? 'Selection contains invalid assets.'
            : !additions.length
              ? 'Already in this plan.'
              : 'Plan has insufficient capacity for the whole selection.'}
        </Text>
      ) : null}
    </Box>
  );
}
