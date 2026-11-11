import { Box, Card, NoItemsPlaceholder, Stack, Text } from '@main-components';
import { useMemo, useState } from 'react';
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
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const sources = useMemo(
    () => [...new Set(assets.map((asset) => asset.source ?? 'Unknown source'))].sort(),
    [assets],
  );
  const visible = assets.filter(
    (asset) =>
      (source === 'all' || (asset.source ?? 'Unknown source') === source) &&
      asset.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <Card className="plan-grouping-unassigned" style={{ flex: '1 1 260px', minWidth: 0 }}>
      <Stack gap="s">
        <Text variant="heading3">Unassigned assets</Text>
        {assets.length ? (
          <Box flexDirection="row" gap="s" className="plan-asset-filters">
            <input
              aria-label="Search unassigned assets"
              placeholder="Search assets"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select
              aria-label="Filter unassigned assets by source"
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              <option value="all">All sources</option>
              {sources.map((sourceName) => (
                <option key={sourceName} value={sourceName}>
                  {sourceName}
                </option>
              ))}
            </select>
          </Box>
        ) : null}
        {visible.length ? (
          visible.map((asset) => (
            <AssetRow
              key={asset.id}
              asset={asset}
              dragged={grouping.draggedId === asset.id}
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
          <NoItemsPlaceholder
            description={assets.length ? 'No matching assets.' : 'All assets have been assigned.'}
          />
        )}
      </Stack>
    </Card>
  );
}
