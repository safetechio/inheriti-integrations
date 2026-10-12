import { Badge, Box, Card, NoItemsPlaceholder, Stack, Text } from '@main-components';
import { AssetRow } from './AssetRow';
import type { GroupingAsset, PlanDraft } from '../types';
import type { usePlanGrouping } from '../hooks/use-plan-grouping';
import { hasPlanCapacity } from '../capacity';

type UnassignedAssetsProps = {
  assets: GroupingAsset[];
  selectedPlan?: PlanDraft;
  grouping: ReturnType<typeof usePlanGrouping>;
  onAssign?: (asset: GroupingAsset, plan: PlanDraft) => void;
};
export function UnassignedAssets({
  assets,
  selectedPlan,
  grouping,
  onAssign,
}: UnassignedAssetsProps) {
  return (
    <Card className="plan-grouping-unassigned" style={{ flex: '1 1 260px', minWidth: 0 }}>
      <Stack gap="s">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text variant="heading3">Unassigned</Text>
          <Badge variant="count" tone={assets.length ? 'warning' : 'success'}>
            {assets.length}
          </Badge>
        </Box>
        <Text variant="bodySmall" color="gray">
          Drag onto a plan, or use Assign to put it in {selectedPlan?.name ?? 'the selected plan'}.
        </Text>
        {assets.length ? (
          assets.map((asset) => (
            <AssetRow
              key={asset.id}
              asset={asset}
              dragged={grouping.draggedId === asset.id}
              assigned={grouping.assignedId === asset.id}
              onStart={() => grouping.startDrag(asset.id)}
              onEnd={grouping.endDrag}
              assignDisabled={!asset.valid || !selectedPlan || !hasPlanCapacity(selectedPlan)}
              onAssign={
                asset.valid && selectedPlan && hasPlanCapacity(selectedPlan) && onAssign
                  ? () => grouping.assign(asset, selectedPlan, onAssign)
                  : undefined
              }
            />
          ))
        ) : (
          <NoItemsPlaceholder description="Every accepted Asset sits in a plan draft." />
        )}
      </Stack>
    </Card>
  );
}
