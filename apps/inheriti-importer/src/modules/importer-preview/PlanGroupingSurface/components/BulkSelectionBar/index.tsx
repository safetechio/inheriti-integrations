import { Box, Button, Text, Tooltip } from '@main-components';
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
      <Tooltip content="Deselect all assets. Plan assignments are kept.">
        <Button title="Clear selection" size="sm" variant="plain" onPress={onClear} />
      </Tooltip>
      {onCreate ? (
        <Tooltip content="Create plans from the selected assets. Large selections are split across plans.">
          <Button title="New plan from selected" size="sm" onPress={onCreate} disabled={invalid} />
        </Tooltip>
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
      <Tooltip content="Move the selected assets to the chosen plan.">
        <Button
          title={`Move ${assets.length} assets`}
          size="sm"
          disabled={!onMove || !fits || invalid}
          onPress={() => {
            if (target && fits && !invalid) onMove?.(additions, target);
          }}
        />
      </Tooltip>
      {onUnassign ? (
        <Tooltip content="Return selected assets to Unassigned and keep them in the import.">
          <Button
            title="Unassign selected"
            size="sm"
            variant="plain"
            onPress={() => onUnassign(assets)}
          />
        </Tooltip>
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
