import { Box, Button, Icon, FilterChip, NoItemsPlaceholder, Stack, Text } from '@main-components';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useMarqueeSelection } from '@modules/_shared/ui/hooks/use-marquee-selection';
import { AssetRow } from './components/AssetRow';
import { Inspector } from './components/Inspector';
import { ReviewGroupRow } from './components/ReviewGroupRow';
import { ReviewSelectionCard, type ReviewResult } from './components/ReviewSelectionCard';
import { ReviewSourceToolbar } from './components/ReviewSourceToolbar';
import { ReviewSelectionHelp } from './components/ReviewSelectionHelp';
import { exceptionFilters, isPending, statusFilters, useReviewList } from './hooks/use-review-list';
import { useReviewSelection } from './hooks/use-review-selection';
import { flattenReviewTree, indexReviewTree, type ReviewRow } from './review-tree';
import { compatibleMappingUpdates } from './review-mapping';
import { hasIncludedSchemaField, type AssetReviewQueueProps, type ReviewAsset } from './types';
import { ImportCoverage } from './components/ImportCoverage';
import { NotesDestination } from './components/NotesDestination';
import type { ImportReviewControls } from './import-review-controls';
import { AssetViewPicker } from '../AssetViewPicker';
import './styles.css';

export type {
  AssetReviewQueueProps,
  AssetReviewStatus,
  ReviewAsset,
  ReviewAssetField,
  ReviewAssetSourceCandidate,
  ReviewBatchResult,
} from './types';

const pageSize = 100;
const editable =
  'input:not([type="checkbox"]), textarea, select, [contenteditable="true"], [role="textbox"]';

export function AssetReviewQueue({
  assets,
  sourceFiles,
  selectedId,
  onSelect,
  onAction,
  onAcceptAllEligible,
  onUndoAcceptAll,
  onReviewAssets,
  onUndoReviewBatch,
  canUndoReviewBatch,
  onApplyMappings,
  autoAdvance = true,
  showKeyboardHints = true,
  resolveSourceValue,
  onMapField,
  onEditPlainText,
  preservation,
}: AssetReviewQueueProps & { preservation?: ImportReviewControls }) {
  const {
    source,
    setSource,
    search,
    setSearch,
    filter,
    setFilter,
    exception,
    setException,
    sources,
    counts,
    eligibleCount,
    canShowTree,
    visible,
    issues,
    exceptionCounts,
  } = useReviewList(assets, sourceFiles);
  const noteSources =
    preservation?.noteSources.filter((entry) => source === 'all' || entry.sourceId === source) ??
    [];
  const setSourceNoteDestination = preservation?.onSetSourceNoteDestination;
  const noteCount = noteSources.reduce((count, entry) => count + entry.fieldCount, 0);
  const noteDestination = noteSources.every(
    (entry) => entry.destination === noteSources[0]?.destination,
  )
    ? (noteSources[0]?.destination ?? null)
    : null;
  const assetNames = useMemo(
    () => new Map(assets.map((asset) => [asset.id, asset.name])),
    [assets],
  );
  const [view, setView] = useState<'list' | 'tree'>('list');
  const [page, setPage] = useState(0);
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set());
  const [localInspectedId, setLocalInspectedId] = useState<string>();
  const [revealId, setRevealId] = useState<string>();
  const [batchAccepted, setBatchAccepted] = useState<number | null>(null);
  const [batchResult, setBatchResult] = useState<ReviewResult>();

  const treeActive = view === 'tree' && canShowTree;
  const tree = useMemo(
    () => (treeActive ? indexReviewTree(visible, source === 'all', sources) : undefined),
    [treeActive, visible, source, sources],
  );
  const rows = useMemo<ReviewRow[]>(
    () =>
      tree
        ? flattenReviewTree(tree.root, openFolders)
        : visible.map((asset) => ({ key: asset.id, asset, depth: 0 })),
    [tree, openFolders, visible],
  );
  const lastPage = Math.max(0, Math.ceil(rows.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const firstRow = currentPage * pageSize;
  const endRow = Math.min(firstRow + pageSize, rows.length);
  const navigableAssets = useMemo(
    () =>
      tree
        ? flattenReviewTree(tree.root, new Set([...tree.paths.values()].flat())).flatMap((row) =>
            'asset' in row ? [row.asset] : [],
          )
        : visible,
    [tree, visible],
  );
  const rangeAssets = useMemo(
    () => (tree ? rows.flatMap((row) => ('asset' in row ? [row.asset] : [])) : visible),
    [rows, tree, visible],
  );
  const selection = useReviewSelection(navigableAssets, rangeAssets);
  const bulkEnabled = Boolean(onReviewAssets);
  const selected =
    visible.find((asset) => asset.id === (selectedId ?? localInspectedId)) ?? navigableAssets[0];
  const selectedAssets = useMemo(
    () => navigableAssets.filter((asset) => selection.selectedIdsSet.has(asset.id)),
    [navigableAssets, selection.selectedIdsSet],
  );
  const compatibleCount = useMemo(
    () =>
      !onApplyMappings || !selected
        ? 0
        : selectedAssets.reduce(
            (count, target) =>
              count + Number(compatibleMappingUpdates(selected, target).length > 0),
            0,
          ),
    [onApplyMappings, selected, selectedAssets],
  );
  const marquee = useMarqueeSelection({
    selectedIds: selection.selectedIds,
    onSelect: bulkEnabled ? selection.replace : () => {},
    resetKey: JSON.stringify([view, source, search, filter, exception]),
    rowSelector: '[data-review-asset-id]',
    getRowIds: (row) => (row.dataset.reviewAssetId ? [row.dataset.reviewAssetId] : []),
    excludeSelector: bulkEnabled ? undefined : '*',
  });
  const inspect = (asset: ReviewAsset, reveal = false) => {
    setLocalInspectedId(asset.id);
    onSelect?.(asset);
    if (!reveal) return;
    if (tree) {
      const path = tree.paths.get(asset.id) ?? [];
      setOpenFolders((current) =>
        path.every((key) => current.has(key)) ? current : new Set([...current, ...path]),
      );
    }
    setRevealId(asset.id);
  };
  useLayoutEffect(() => {
    if (!revealId) return;
    const index = rows.findIndex((row) => 'asset' in row && row.asset.id === revealId);
    const targetPage = Math.floor(index / pageSize);
    if (targetPage >= 0 && targetPage !== currentPage) {
      setPage(targetPage);
      return;
    }
    const list = marquee.containerRef.current;
    const row =
      list &&
      Array.from(list.querySelectorAll<HTMLElement>('[data-review-asset-id]')).find(
        (element) => element.dataset.reviewAssetId === revealId,
      );
    if (list && row) {
      const viewport = list.getBoundingClientRect();
      const item = row.getBoundingClientRect();
      if (item.top < viewport.top) list.scrollTop += item.top - viewport.top;
      else if (item.bottom > viewport.bottom) list.scrollTop += item.bottom - viewport.bottom;
    }
    setRevealId(undefined);
  }, [revealId, rows, currentPage, marquee.containerRef]);
  const clearSelection = () => {
    selection.replace([]);
    const list = marquee.containerRef.current;
    if (!list) return;
    const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-review-asset-id]'));
    const row = rows.find((element) => element.dataset.reviewAssetId === selected?.id) ?? rows[0];
    const focusTarget = row?.querySelector<HTMLElement>('[data-marquee-row-control]') ?? list;
    focusTarget.focus({ preventScroll: true });
  };
  const changePage = (next: number) => {
    setPage(next);
    if (marquee.containerRef.current) marquee.containerRef.current.scrollTop = 0;
  };
  const changeFilter = (change: () => void) => {
    change();
    selection.replace([]);
    changePage(0);
  };
  const nextPending = (activeId: string, changed: ReadonlySet<string>) => {
    const index = navigableAssets.findIndex((asset) => asset.id === activeId);
    const after = navigableAssets.find(
      (asset, position) => position > index && isPending(asset) && !changed.has(asset.id),
    );
    const next =
      after ?? navigableAssets.find((asset) => isPending(asset) && !changed.has(asset.id));
    if (next) inspect(next, true);
  };
  const singleReview = (action: string, asset: ReviewAsset) => {
    onAction?.(action, asset);
    if (autoAdvance && (action === 'accept' || action === 'exclude'))
      nextPending(asset.id, new Set([asset.id]));
  };
  const acceptAll = () => {
    const accepted = onAcceptAllEligible?.() ?? 0;
    if (!accepted) return;
    setBatchAccepted(accepted);
    setBatchResult(undefined);
    selection.replace([]);
  };
  const reviewSelected = (action: 'accept' | 'exclude') => {
    if (!onReviewAssets || !selectedAssets.length) return;
    const result = onReviewAssets(action, selectedAssets);
    setBatchResult({ ...result, label: action === 'accept' ? 'accepted' : 'excluded' });
    if (result.changedIds.length) setBatchAccepted(null);
    selection.replace([]);
    const changed = new Set(result.changedIds);
    if (autoAdvance && selected && changed.has(selected.id)) nextPending(selected.id, changed);
  };

  const applyMappings = () => {
    if (!onApplyMappings || !selected || !compatibleCount) return;
    const result = onApplyMappings(selected, selectedAssets);
    setBatchResult({ ...result, label: 'updated' });
    if (result.changedIds.length) setBatchAccepted(null);
    selection.replace([]);
  };
  const focusNextIssue = () => {
    const index = navigableAssets.findIndex((asset) => asset.id === selected?.id);
    const issueIds = new Set(issues.map((asset) => asset.id));
    const next =
      navigableAssets.find((asset, position) => position > index && issueIds.has(asset.id)) ??
      navigableAssets.find((asset) => issueIds.has(asset.id));
    if (next) inspect(next, true);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest('.importer-coverage-card, .importer-review-note-control, [role="dialog"]')
      )
        return;
      const editing = Boolean(target?.closest(editable));
      if (event.key === 'Escape' && selection.selectedIds.length) {
        if (editing) selection.replace([]);
        else clearSelection();
      }
      if (editing || event.altKey || event.isComposing || event.repeat) return;
      const key = event.key.toLowerCase();
      const command = event.ctrlKey || event.metaKey;
      if (key === 'a' && command) {
        if (event.shiftKey && onAcceptAllEligible) {
          event.preventDefault();
          acceptAll();
        } else if (
          !event.shiftKey &&
          bulkEnabled &&
          event.target instanceof Node &&
          marquee.containerRef.current?.contains(event.target)
        ) {
          event.preventDefault();
          selection.replace(navigableAssets.map((asset) => asset.id));
        }
        return;
      }
      if (command || event.shiftKey || !selected) return;
      if (key === 'a' || key === 'x') {
        const action = key === 'a' ? 'accept' : 'exclude';
        if (selectedAssets.length && bulkEnabled) {
          event.preventDefault();
          reviewSelected(action);
        } else if (
          onAction &&
          (action === 'accept'
            ? selected.status !== 'accepted' && hasIncludedSchemaField(selected)
            : selected.status !== 'excluded')
        ) {
          event.preventDefault();
          singleReview(action, selected);
        }
        return;
      }
      if (key !== 'arrowup' && key !== 'arrowdown') return;
      event.preventDefault();
      const index = navigableAssets.findIndex((asset) => asset.id === selected.id);
      const next = navigableAssets[index + (key === 'arrowup' ? -1 : 1)];
      if (next) inspect(next, true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <Stack gap="m" className="asset-review-surface" style={{ gap: 12 }}>
      <Box flexDirection="row" alignItems="center" gap="s" flexWrap="wrap">
        <Box flexDirection="row" gap="s" flexWrap="wrap">
          {statusFilters.map(([value, label]) => (
            <FilterChip
              key={value}
              variant="tab"
              count={counts[value]}
              selected={filter === value}
              onPress={() => changeFilter(() => setFilter(value))}
            >
              {label}
            </FilterChip>
          ))}
        </Box>
        {onAcceptAllEligible ? (
          <Box
            ref={(element) =>
              element?.setAttribute(
                'title',
                'Accept all pending eligible assets across sources and filters (Ctrl/Cmd+Shift+A)',
              )
            }
          >
            <Button
              title={`Accept all eligible (${eligibleCount})`}
              accessibilityLabel={`Accept all eligible (${eligibleCount}) across all sources and filters. Shortcut: Ctrl or Command Shift A`}
              size="sm"
              variant="outlined"
              disabled={!eligibleCount}
              onPress={acceptAll}
            />
          </Box>
        ) : null}
        {showKeyboardHints ? (
          <Box
            className="asset-review-shortcuts"
            flexDirection="row"
            alignItems="center"
            gap="xs"
            flexWrap="wrap"
          >
            {onAcceptAllEligible ? (
              <>
                <Text className="asset-review-shortcut">Ctrl/Cmd+Shift+A</Text>
                <Text variant="bodySmall" color="gray">
                  accept all
                </Text>
              </>
            ) : null}
            <Box
              className="asset-review-secondary-shortcuts"
              flexDirection="row"
              gap="xs"
              alignItems="center"
            >
              <Text className="asset-review-shortcut">A</Text>
              <Text variant="bodySmall" color="gray">
                accept
              </Text>
              <Text className="asset-review-shortcut">X</Text>
              <Text variant="bodySmall" color="gray">
                exclude
              </Text>
              <Text className="asset-review-shortcut">↑↓</Text>
              <Text variant="bodySmall" color="gray">
                move
              </Text>
            </Box>
            <ReviewSelectionHelp />
          </Box>
        ) : null}
      </Box>
      {preservation ? (
        <Box className="importer-review-preservation">
          {noteCount && setSourceNoteDestination ? (
            <NotesDestination
              key={source}
              scope={source === 'all' ? 'All sources' : (noteSources[0]?.sourceName ?? 'Source')}
              count={noteCount}
              destination={noteDestination}
              hasUnchosen={noteSources.some(({ destination }) => destination === null)}
              onChange={(destination) =>
                setSourceNoteDestination(source === 'all' ? null : source, destination)
              }
            />
          ) : null}
          <ImportCoverage
            coverage={preservation.coverage}
            sourceNames={sources}
            assetNames={assetNames}
            onPreserveFields={preservation.onPreserveFields}
            onExcludeFields={preservation.onExcludeFields}
          />
        </Box>
      ) : null}
      {batchAccepted !== null ? (
        <Box flexDirection="row" alignItems="center" gap="s" role="status">
          <Text>
            {batchAccepted} accepted · {counts.review} require review
          </Text>
          {onUndoAcceptAll ? (
            <Button
              title="Undo"
              size="sm"
              variant="outlined"
              onPress={() => {
                onUndoAcceptAll();
                setBatchAccepted(null);
              }}
            />
          ) : null}
        </Box>
      ) : null}
      <Box flexDirection="row" gap="m" className="asset-review-columns">
        <Box className="asset-review-list-pane">
          <ReviewSourceToolbar
            source={source}
            sources={sources}
            search={search}
            onSourceChange={(next) => changeFilter(() => setSource(next))}
            onSearchChange={(next) => changeFilter(() => setSearch(next))}
          />
          <Box
            className="asset-review-list-controls"
            flexDirection="row"
            alignItems="center"
            gap="s"
            flexWrap="wrap"
          >
            {canShowTree ? (
              <AssetViewPicker
                view={view}
                onChange={(next) => {
                  setView(next);
                  changePage(0);
                }}
              />
            ) : null}
            <Box
              className="asset-review-exception-chips"
              flexDirection="row"
              gap="s"
              flexWrap="wrap"
            >
              {exceptionFilters.map(([value, label]) => (
                <FilterChip
                  key={value}
                  count={exceptionCounts[value]}
                  selected={exception === value}
                  onPress={() =>
                    changeFilter(() => setException(exception === value ? undefined : value))
                  }
                >
                  {label}
                </FilterChip>
              ))}
            </Box>
            <select
              className="asset-review-exception-select"
              aria-label="Filter by exception"
              value={exception ?? ''}
              onChange={(event) => {
                const choice = exceptionFilters.find(([value]) => value === event.target.value);
                changeFilter(() => setException(choice?.[0]));
              }}
            >
              <option value="">Issues</option>
              {exceptionFilters.map(([value, label]) => (
                <option key={value} value={value}>
                  {label} ({exceptionCounts[value]})
                </option>
              ))}
            </select>
          </Box>
          <Box
            className="asset-review-list-heading"
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Text variant="bodySmall" semibold accessibilityRole="heading">
              Assets ({visible.length})
            </Text>
            {issues.length ? (
              <Box ref={(element) => element?.setAttribute('title', 'Focus next issue')}>
                <Button
                  title={
                    <Text
                      className="asset-review-next-issue-label"
                      variant="buttonSmall"
                      color="primary120"
                    >
                      Next issue
                    </Text>
                  }
                  endIcon={<Icon name="arrow-down" size={12} color="primary120" label="" />}
                  accessibilityLabel="Focus next issue"
                  size="sm"
                  minHeight={32}
                  variant="plain"
                  onPress={focusNextIssue}
                />
              </Box>
            ) : null}
          </Box>
          <Stack
            gap="s"
            className="asset-review-queue"
            ref={marquee.setContainerRef}
            tabIndex={0}
            role="region"
            aria-label="Asset review list"
          >
            {!assets.length ? (
              <NoItemsPlaceholder description="No Assets were detected. Add another source containing value-bearing entries." />
            ) : !visible.length ? (
              <NoItemsPlaceholder
                description={
                  filter === 'review' && counts.review === 0
                    ? 'All Assets have been reviewed. Switch to All to see them.'
                    : 'No Assets match this filter.'
                }
              />
            ) : null}
            {rows.slice(firstRow, endRow).map((row) =>
              'asset' in row ? (
                <Box key={row.key} style={{ paddingLeft: row.depth * 16 }}>
                  <AssetRow
                    asset={row.asset}
                    inspected={row.asset.id === selected?.id}
                    selected={selection.selectedIdsSet.has(row.asset.id)}
                    onSelect={inspect}
                    onToggle={
                      bulkEnabled ? (range) => selection.toggle(row.asset.id, range) : undefined
                    }
                  />
                </Box>
              ) : (
                <ReviewGroupRow
                  key={row.key}
                  row={row}
                  expanded={openFolders.has(row.key)}
                  selection={selection.selectedIdsSet}
                  onExpand={() =>
                    setOpenFolders((current) => {
                      const next = new Set(current);
                      if (next.has(row.key)) next.delete(row.key);
                      else next.add(row.key);
                      return next;
                    })
                  }
                  onToggle={
                    bulkEnabled ? () => selection.toggleGroup(row.group.assetIds) : undefined
                  }
                />
              ),
            )}
            {lastPage > 0 ? (
              <Box flexDirection="row" alignItems="center" gap="s" flexWrap="wrap">
                <Text variant="bodySmall" color="gray">
                  Showing {firstRow + 1}–{endRow} of {rows.length} rows
                </Text>
                <Button
                  title="Previous assets"
                  variant="plain"
                  size="sm"
                  disabled={currentPage === 0}
                  onPress={() => changePage(currentPage - 1)}
                />
                <Button
                  title="Show more assets"
                  variant="plain"
                  size="sm"
                  disabled={currentPage === lastPage}
                  onPress={() => changePage(currentPage + 1)}
                />
              </Box>
            ) : null}
          </Stack>
          <ReviewSelectionCard
            count={selectedAssets.length}
            result={batchResult}
            mapping={
              onApplyMappings && selected && selectedAssets.length
                ? {
                    template: selected.name,
                    templateId: selected.id,
                    compatibleCount,
                    onApply: applyMappings,
                  }
                : undefined
            }
            onReview={reviewSelected}
            onClear={clearSelection}
            onUndo={
              (canUndoReviewBatch ?? Boolean(batchResult?.changedIds.length)) && onUndoReviewBatch
                ? () => {
                    const result = onUndoReviewBatch();
                    setBatchResult(
                      result?.skippedIds.length ? { ...result, label: 'restored' } : undefined,
                    );
                  }
                : undefined
            }
          />
        </Box>
        <Box className="asset-review-inspector">
          <Inspector
            asset={selected}
            onAction={onAction ? singleReview : undefined}
            resolveSourceValue={resolveSourceValue}
            onMapField={onMapField}
            onEditPlainText={onEditPlainText}
            onSetNoteDestination={preservation?.onSetAssetNoteDestination}
            coverage={preservation?.coverage}
          />
        </Box>
      </Box>
    </Stack>
  );
}

export default AssetReviewQueue;
