import {
  Box,
  Button,
  Card,
  FilterChip,
  Icon,
  NoItemsPlaceholder,
  Stack,
  Text,
  Tooltip,
} from '@main-components';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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

const emptyAssets: GroupingAsset[] = [];
const emptyIds: string[] = [];

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
  assigned = emptyAssets,
  footer,
  selectedPlan,
  grouping,
  onAssign,
  selection,
  folderMode = false,
}: UnassignedAssetsProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'unassigned' | 'assigned' | 'all'>('unassigned');
  const allAssets = useMemo(() => [...assets, ...assigned], [assets, assigned]);
  const candidates = filter === 'all' ? allAssets : filter === 'assigned' ? assigned : assets;
  const heading = filter === 'all' ? 'All assets' : filter === 'assigned' ? 'Assigned assets' : 'Unassigned assets';
  const [searchOpen, setSearchOpen] = useState(false);
  const [source, setSource] = useState('all');
  const [limit, setLimit] = useState(100);
  const [view, setView] = useState<'tree' | 'list'>('list');
  const sources = useMemo(() => [...new Map(allAssets.map((asset) => [asset.sourceId ?? asset.source ?? 'Unknown source', asset.source ?? 'Unknown source'])).entries()], [allAssets]);
  const searchEntries = useMemo(() => candidates.map((asset) => ({
    asset,
    sourceId: asset.sourceId ?? asset.source ?? 'Unknown source',
    text: [asset.name, asset.source, ...(asset.folderPath ?? [])].join(' ').toLocaleLowerCase(),
  })), [candidates]);
  const selectedSource = source === 'all' || sources.some(([id]) => id === source) ? source : 'all';
  const marquee = useMarqueeSelection({
    selectedIds: selection?.selectedIds ?? emptyIds,
    onSelect: (ids) => selection?.replaceSelection(ids, 'unassigned'),
    resetKey: `${view}\u0000${selectedSource}\u0000${query}\u0000${filter}`,
    rowSelector: '[data-marquee-asset-id]',
    getRowIds: (row) => [row.dataset.marqueeAssetId!],
  });
  useEffect(() => {
    if (selectedSource !== source) setSource('all');
  }, [selectedSource, source]);
  const needle = query.trim().toLocaleLowerCase();
  const visible = useMemo(() => searchEntries
    .filter(({ sourceId, text }) => (selectedSource === 'all' || sourceId === selectedSource) && text.includes(needle))
    .map(({ asset }) => asset), [searchEntries, selectedSource, needle]);
  const filterKey = `${selectedSource}\u0000${query}\u0000${filter}`;
  const clearSelection = selection?.clear;
  useEffect(() => {
    clearSelection?.();
    setLimit(100);
  }, [filterKey, clearSelection]);
  const visibleUnassigned = selection?.visibleUnassigned;
  useLayoutEffect(() => {
    if (visibleUnassigned) visibleUnassigned.current = visible;
  }, [visibleUnassigned, visible]);

  const commands = useRef({ selection, grouping, selectedPlan, onAssign, visible });
  useLayoutEffect(() => {
    commands.current = { selection, grouping, selectedPlan, onAssign, visible };
  }, [selection, grouping, selectedPlan, onAssign, visible]);
  const selectAsset = useCallback<NonNullable<React.ComponentProps<typeof AssetRow>['onSelect']>>((id, rows, event) => {
    const { selection, visible } = commands.current;
    selection?.select(id, rows ?? visible, 'unassigned', event);
  }, []);
  const focusSelection = useCallback(() => commands.current.selection?.focusPane('unassigned'), []);
  const startDrag = useCallback((asset: GroupingAsset, event: DragEvent) => {
    const { grouping, selection } = commands.current;
    grouping.startDrag(asset.id);
    selection?.startDrag(asset.id);
    const count = selection?.selectedIdSet.has(asset.id) ? selection.selectedIds.length : 1;
    if (event.dataTransfer) setItemDragImage(event.dataTransfer, event.currentTarget as HTMLElement, asset.name, count, `${count} ${count === 1 ? 'asset' : 'assets'}`, '[data-drag-icon]');
  }, []);
  const endDrag = useCallback(() => {
    commands.current.grouping.endDrag();
    commands.current.selection?.endDrag();
  }, []);
  const assignAsset = useCallback((asset: GroupingAsset) => {
    const { grouping, selectedPlan, onAssign } = commands.current;
    if (selectedPlan) grouping.assign(asset, selectedPlan, onAssign);
  }, []);

  const canAssign = selectedPlan && hasPlanCapacity(selectedPlan);
  const assetRow = (asset: GroupingAsset, selectionRows?: GroupingAsset[]) => (
    <AssetRow
      key={asset.id}
      asset={asset}
      showTypeIcon={folderMode}
      showAssign={false}
      selected={selection?.selectedIdSet.has(asset.id)}
      selectionRows={selectionRows}
      onSelect={selection ? selectAsset : undefined}
      onFocusSelect={selection ? focusSelection : undefined}
      dragged={grouping.draggedId === asset.id}
      onStart={startDrag}
      onEnd={endDrag}
      assignDisabled={!asset.valid || !canAssign}
      onAssign={asset.valid && canAssign && onAssign ? assignAsset : undefined}
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
        <Box flexDirection="row" gap="s" alignItems="center" flexWrap="wrap">
          <AssetViewPicker view={view} onChange={setView} />
          <Text variant="bodySmall" color="gray">
            {visible.length} {visible.length === 1 ? 'asset' : 'assets'} · {sources.length} {sources.length === 1 ? 'source' : 'sources'}
          </Text>
          {selection ? (
            <Tooltip content="Select all assets matching the current filters.">
              <Button
                title="Select all"
                size="sm"
                variant="plain"
                disabled={!visible.length}
                onPress={() => selection.selectAll(visible, 'unassigned')}
              />
            </Tooltip>
          ) : null}
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
