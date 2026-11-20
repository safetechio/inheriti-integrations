import {
  Box,
  Button,
  Card,
  FilterChip,
  Icon,
  NoItemsPlaceholder,
  Stack,
  Text,
} from '@main-components';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AssetRow } from '../AssetRow';
import { SourceAssetTree } from '../SourceAssetTree';
import { SelectionHelpPopover } from '../SelectionHelpPopover';
import { AssetViewPicker } from '../../../AssetViewPicker';
import './styles.css';
import type { GroupingAsset, PlanDraft } from '../../types';
import type { usePlanGrouping } from '../../hooks/use-plan-grouping';
import { hasPlanCapacity } from '../../capacity';
import type { useAssetSelection } from '../../hooks/use-asset-selection';
import { useMarqueeSelection } from '@modules/_shared/ui/hooks/use-marquee-selection';
import { setItemDragImage } from '@modules/_shared/ui/drag/set-item-drag-image';

type UnassignedAssetsProps = {
  assets: GroupingAsset[];
  assigned?: GroupingAsset[];
  footer?: ReactNode;
  selectedPlan?: PlanDraft;
  grouping: ReturnType<typeof usePlanGrouping>;
  onAssign?: (asset: GroupingAsset, plan: PlanDraft) => void;
  selection?: ReturnType<typeof useAssetSelection>;
  folderMode?: boolean;
};
export function UnassignedAssets({
  assets,
  assigned = [],
  footer,
  selectedPlan,
  grouping,
  onAssign,
  selection,
  folderMode = false,
}: UnassignedAssetsProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'unassigned' | 'assigned' | 'all'>('unassigned');
  const allAssets = [...assets, ...assigned];
  const candidates = filter === 'all' ? allAssets : filter === 'assigned' ? assigned : assets;
  const heading = filter === 'all' ? 'All assets' : filter === 'assigned' ? 'Assigned assets' : 'Unassigned assets';
  const [searchOpen, setSearchOpen] = useState(false);
  const [source, setSource] = useState('all');
  const [limit, setLimit] = useState(100);
  const [view, setView] = useState<'tree' | 'list'>('list');
  const sources = useMemo(() => [...new Map(allAssets.map((asset) => [asset.sourceId ?? asset.source ?? 'Unknown source', asset.source ?? 'Unknown source'])).entries()], [assets, assigned]);
  const selectedSource = source === 'all' || sources.some(([id]) => id === source) ? source : 'all';
  const marquee = useMarqueeSelection({
    selectedIds: selection?.selectedIds ?? [],
    onSelect: (ids) => selection?.replaceSelection(ids, 'unassigned'),
    resetKey: `${view}\u0000${selectedSource}\u0000${query}\u0000${filter}`,
    rowSelector: '[data-marquee-asset-id]',
    getRowIds: (row) => [row.dataset.marqueeAssetId!],
  });
  useEffect(() => {
    if (selectedSource !== source) setSource('all');
  }, [selectedSource, source]);
  const visible = candidates.filter(
    (asset) =>
      (selectedSource === 'all' || (asset.sourceId ?? asset.source ?? 'Unknown source') === selectedSource) &&
      [asset.name, asset.source, ...(asset.folderPath ?? [])].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const filterKey = `${selectedSource}\u0000${query}\u0000${filter}`;
  useEffect(() => {
    selection?.clear();
    setLimit(100);
  }, [filterKey]);
  const visibleIds = visible.map((asset) => asset.id).join('\u0000');
  useEffect(() => {
    selection?.setVisibleUnassignedIds(visible.map((asset) => asset.id));
  }, [visibleIds]);
  const assetRow = (asset: GroupingAsset, selectionRows: GroupingAsset[] = visible) => (
    <AssetRow
      key={asset.id}
      asset={asset}
      showTypeIcon={folderMode}
      showAssign={false}
      selected={selection?.selectedIds.includes(asset.id)}
      onSelect={
        selection ? (event) => selection.select(asset.id, selectionRows, 'unassigned', event) : undefined
      }
      onFocusSelect={selection ? () => selection.focusPane('unassigned') : undefined}
      dragged={grouping.draggedId === asset.id}
      onStart={(event) => {
        grouping.startDrag(asset.id);
        selection?.startDrag(asset.id);
        const count = selection?.selectedIdSet.has(asset.id) ? selection.selectedIds.length : 1;
        if (event.dataTransfer) setItemDragImage(event.dataTransfer, event.currentTarget as HTMLElement, asset.name, count, `${count} ${count === 1 ? 'asset' : 'assets'}`, '[data-drag-icon]');
      }}
      onEnd={() => {
        grouping.endDrag();
        selection?.endDrag();
      }}
      assignDisabled={!asset.valid || !selectedPlan || !hasPlanCapacity(selectedPlan)}
      onAssign={
        asset.valid && selectedPlan && hasPlanCapacity(selectedPlan) && onAssign
          ? () => grouping.assign(asset, selectedPlan, onAssign)
          : undefined
      }
    />
  );
  return (
    <Card className="plan-grouping-unassigned" style={{ flex: '1 1 260px', minWidth: 0 }}>
      <Stack gap={folderMode ? 'm' : 's'}>
        <Box flexDirection="row" alignItems="center" gap="xs" minHeight={folderMode ? 28 : undefined}><Text variant="heading3">{heading}</Text><SelectionHelpPopover kind="assets" /></Box>
        {allAssets.length ? (
          <Box flexDirection="row" alignItems="center" gap="s" className="plan-asset-filters">
            <select
              aria-label="Filter unassigned assets by source"
              value={selectedSource}
              onChange={(event) => setSource(event.target.value)}
            >
              <option value="all">All sources</option>
              {sources.map(([sourceId, sourceName]) => (
                <option key={sourceId} value={sourceId}>
                  {sourceName}
                </option>
              ))}
            </select>
            {searchOpen || folderMode ? (
              <Box flexDirection="row" alignItems="center" className="plan-asset-search">
                <Icon name="magnifying-glass" size={14} color="gray" />
                <input
                  autoFocus={!folderMode}
                  aria-label="Search unassigned assets"
                  placeholder="Search assets"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query ? (
                  <button
                    type="button"
                    aria-label="Clear unassigned asset search"
                    onClick={() => setQuery('')}
                  >
                    ×
                  </button>
                ) : null}
                {!folderMode ? (
                  <button
                    type="button"
                    aria-label="Close unassigned asset search"
                    onClick={() => {
                      setSearchOpen(false);
                      setQuery('');
                    }}
                  >
                    Close
                  </button>
                ) : null}
              </Box>
            ) : (
              <button
                type="button"
                className="plan-asset-search-toggle"
                aria-label="Search unassigned assets"
                onClick={() => setSearchOpen(true)}
              >
                <Icon name="magnifying-glass" size={16} color="gray" />
              </button>
            )}
          </Box>
        ) : null}
        {folderMode ? <Box flexDirection="row" gap="s" className="source-status-filters">
          {(['unassigned', 'assigned', 'all'] as const).map((status) => <FilterChip
            key={status}
            className="source-status-chip"
            selected={filter === status}
            onPress={() => setFilter(status)}
          >{`${status === 'unassigned' ? 'Unassigned' : status === 'assigned' ? 'Assigned' : 'All'} · ${status === 'unassigned' ? assets.length : status === 'assigned' ? assigned.length : allAssets.length}`}</FilterChip>)}
        </Box> : null}
        <Box flexDirection="row" gap="s" alignItems="center">
          <AssetViewPicker view={view} onChange={setView} />
          <Text variant="bodySmall" color="gray">
            {visible.length} {visible.length === 1 ? 'asset' : 'assets'} · {sources.length} {sources.length === 1 ? 'source' : 'sources'}
          </Text>
        </Box>
        <Box className="plan-source-scroll" tabIndex={0} aria-label={`${heading} ${view}`} ref={marquee.setContainerRef}>
          {visible.length ? (
            view === 'list' ? (
              visible.slice(0, limit).map((asset) => assetRow(asset))
            ) : (
              <SourceAssetTree assets={visible} selection={selection} grouping={grouping} renderAsset={assetRow} />
            )
          ) : (
            <NoItemsPlaceholder
              description={filter === 'assigned' && !assigned.length ? 'No assets have been assigned yet.' : candidates.length ? 'No matching assets.' : 'All assets have been assigned.'}
            />
          )}
        </Box>
        {view === 'list' && visible.length > limit ? (
          <Box gap="s">
            <Text color="gray">
              Showing {limit} of {visible.length} matching assets
            </Text>
            <Button
              title="Show more assets"
              variant="plain"
              onPress={() => setLimit((current) => current + 100)}
            />
          </Box>
        ) : null}
        {footer}
      </Stack>
    </Card>
  );
}
