import {
  Box,
  Button,
  Icon,
  FilterChip,
  NoItemsPlaceholder,
  Stack,
  Text,
  Tooltip,
} from '@main-components';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useMarqueeSelection } from '@modules/_shared/ui/hooks/use-marquee-selection';
import { AssetRow } from './components/AssetRow';
import { Inspector } from './components/Inspector';
import { ReviewGroupRow } from './components/ReviewGroupRow';
import { ReviewPatterns } from './components/ReviewPatterns';
import { ReviewSelectionCard, type ReviewResult } from './components/ReviewSelectionCard';
import { ReviewSourceToolbar } from './components/ReviewSourceToolbar';
import { ReviewSelectionHelp } from './components/ReviewSelectionHelp';
import { exceptionFilters, isPending, statusFilters, useReviewList } from './hooks/use-review-list';
import { useReviewSelection } from './hooks/use-review-selection';
import { flattenReviewTree, indexReviewTree, type ReviewRow } from './review-tree';
import { compatibleMappingUpdates } from './review-mapping';
import {
  canReviewAsset,
  type AssetReviewQueueProps,
  type ReviewAsset,
  type ReviewBatchAction,
} from './types';
import { ImportCoverage } from './components/ImportCoverage';
import { NotesDestination } from './components/NotesDestination';
import type { FieldOperationResult } from './field-operations';
import type { ImportReviewControls } from './import-review-controls';
import { getReviewBlockers, isNoteDestinationPending } from './review-blockers';
import { AssetViewPicker } from '../AssetViewPicker';
import './styles.css';

export type {
  AssetReviewQueueProps,
  AssetReviewStatus,
  ReviewAsset,
  ReviewAssetField,
  ReviewAssetSourceCandidate,
  ReviewBatchResult,
  ReviewRecoveryHandle,
} from './types';

const pageSize = 100;
const editable =
  'input:not([type="checkbox"]), textarea, select, [contenteditable="true"], [role="textbox"]';

export function AssetReviewQueue({
  assets,
  recoveryRef,
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
    issueCount,
    exceptionCounts,
  } = useReviewList(assets, sourceFiles, preservation?.coverage);
  const coverage = preservation?.coverage;
  const allNoteSources = preservation?.noteSources;
  const setSourceNoteDestination = preservation?.onSetSourceNoteDestination;
  const {
    noteSources,
    noteCount,
    noteDestination,
    effectiveNoteDestination,
    needsNoteDestination,
    hasMixedDestinations,
  } = useMemo(() => {
    const noteSources =
      allNoteSources?.filter((entry) => source === 'all' || entry.sourceId === source) ?? [];
    const noteCount = noteSources.reduce((count, entry) => count + entry.fieldCount, 0);
    const noteDestination = noteSources.every(
      (entry) => entry.destination === noteSources[0]?.destination,
    )
      ? (noteSources[0]?.destination ?? null)
      : null;
    const excludedSourceFields = new Set(
      coverage?.fields.filter(({ status }) => status === 'excluded').map(({ id }) => id),
    );
    const activeNotes = assets.flatMap((asset) =>
      (source === 'all' || asset.sourceId === source) &&
      asset.note &&
      !excludedSourceFields.has(asset.note.sourceFieldId)
        ? [asset.note]
        : [],
    );
    const needsNoteDestination = assets.some(
      (asset) =>
        (source === 'all' || asset.sourceId === source) &&
        isNoteDestinationPending(asset, excludedSourceFields),
    );
    const effectiveDestinations = new Set(activeNotes.map(({ destination }) => destination));
    const resolvedNoteIds = new Set(activeNotes.map(({ sourceFieldId }) => sourceFieldId));
    const nativeNoteIds = new Set(noteSources.flatMap(({ fieldIds }) => fieldIds ?? []));
    const isUnresolvedNote = (id: string) =>
      nativeNoteIds.has(id) && !resolvedNoteIds.has(id) && !excludedSourceFields.has(id);
    const addDestination = (key: string) => {
      if (key === 'meta.notes') effectiveDestinations.add('asset-notes');
      else if (key.startsWith('secret.')) effectiveDestinations.add('protected');
      else return false;
      return true;
    };
    for (const field of coverage?.fields ?? []) {
      if (!isUnresolvedNote(field.id)) continue;
      for (const { fieldId, valid } of field.destinations) {
        if (valid !== false && addDestination(fieldId)) resolvedNoteIds.add(field.id);
      }
    }
    if ([...nativeNoteIds].some(isUnresolvedNote)) {
      for (const asset of assets) {
        if (asset.status === 'excluded') continue;
        for (const field of asset.schemaFields ?? []) {
          if (field.validationError) continue;
          if (field.sourceFieldId && isUnresolvedNote(field.sourceFieldId))
            addDestination(field.key);
          if (
            field.key === 'secret.text' &&
            asset.plainTextSources?.some(({ id }) => isUnresolvedNote(id))
          )
            addDestination(field.key);
        }
      }
    }
    return {
      noteSources,
      noteCount,
      noteDestination,
      effectiveNoteDestination: effectiveDestinations.values().next().value ?? noteDestination,
      needsNoteDestination,
      hasMixedDestinations: effectiveDestinations.size > 1,
    };
  }, [allNoteSources, assets, coverage, source]);
  const assetNames = useMemo(
    () => new Map(assets.map((asset) => [asset.id, asset.name])),
    [assets],
  );
  const openCoverage = useRef<(status: 'pending' | 'invalid') => void>(null);
  const openNotes = useRef<() => void>(null);
  const openIssues = useRef<() => void>(null);
  const [openGlobalNotes, setOpenGlobalNotes] = useState(false);
  const [issueAssetId, setIssueAssetId] = useState<string>();
  const [view, setView] = useState<'list' | 'tree'>('list');
  const [page, setPage] = useState(0);
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set());
  const [localInspectedId, setLocalInspectedId] = useState<string>();
  const [revealId, setRevealId] = useState<string>();
  const [batchAccepted, setBatchAccepted] = useState<number | null>(null);
  const [batchResult, setBatchResult] = useState<ReviewResult>();
  const [fieldResult, setFieldResult] = useState<string>();
  const [pendingInspectIds, setPendingInspectIds] = useState<string[]>([]);
  const [focusRevealedRow, setFocusRevealedRow] = useState(false);

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
  useLayoutEffect(() => {
    if (!openGlobalNotes) return;
    setOpenGlobalNotes(false);
    if (source === 'all') openNotes.current?.();
  }, [openGlobalNotes, source]);
  useLayoutEffect(() => {
    if (!issueAssetId) return;
    setIssueAssetId(undefined);
    if (selected?.id === issueAssetId) openIssues.current?.();
  }, [issueAssetId, selected]);
  useImperativeHandle(recoveryRef, () => ({
    resolve() {
      const blockers = getReviewBlockers(assets, preservation?.coverage);
      if (
        blockers.pendingNoteCount &&
        setSourceNoteDestination &&
        preservation?.noteSources.length
      ) {
        setSource('all');
        setOpenGlobalNotes(true);
      } else if (blockers.undecidedCount) {
        const next = assets.find(isPending);
        if (!next) return;
        setSearch('');
        if (filter !== 'review') selection.replace([]);
        setFilter('review');
        setException(undefined);
        setSource('all');
        setPendingInspectIds([next.id]);
      } else if (blockers.invalidFieldCount || blockers.pendingFieldCount) {
        openCoverage.current?.(blockers.invalidFieldCount ? 'invalid' : 'pending');
      }
    },
  }));
  const selectedAssets = useMemo(
    () => navigableAssets.filter((asset) => selection.selectedIdsSet.has(asset.id)),
    [navigableAssets, selection.selectedIdsSet],
  );
  const selectedReviewActions = {
    accept: selectedAssets.some((asset) => canReviewAsset('accept', asset)),
    exclude: selectedAssets.some((asset) => canReviewAsset('exclude', asset)),
    restore: selectedAssets.some((asset) => canReviewAsset('restore', asset)),
  };
  const allMatchingSelected = selectedAssets.length === navigableAssets.length;
  const selectAll = () => selection.replace(navigableAssets.map(({ id }) => id));
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
  const assetsById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const inspection = useRef({ assetsById, onSelect });
  useLayoutEffect(() => {
    inspection.current = { assetsById, onSelect };
  }, [assetsById, onSelect]);
  const inspectRow = useCallback((assetId: string) => {
    const { assetsById, onSelect } = inspection.current;
    const asset = assetsById.get(assetId);
    if (!asset) return;
    setLocalInspectedId(assetId);
    onSelect?.(asset);
  }, []);
  const inspect = (asset: ReviewAsset) => {
    inspectRow(asset.id);
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
      if (focusRevealedRow)
        row
          .querySelector<HTMLElement>('[data-marquee-row-control]')
          ?.focus({ preventScroll: true });
    }
    setFocusRevealedRow(false);
    setRevealId(undefined);
  }, [revealId, rows, currentPage, marquee.containerRef, focusRevealedRow]);

  useLayoutEffect(() => {
    if (!pendingInspectIds.length) return;
    const readyId = pendingInspectIds.find((id) => assetNames.has(id));
    const asset = assets.find(({ id }) => id === readyId);
    if (!asset) {
      setPendingInspectIds([]);
      return;
    }
    if (!visible.some(({ id }) => id === asset.id)) {
      setSearch('');
      if (filter !== 'all') selection.replace([]);
      setFilter('all');
      setException(undefined);
      if (source !== asset.sourceId) setSource('all');
      return;
    }
    setPendingInspectIds([]);
    setFocusRevealedRow(true);
    inspect(asset);
  });

  const handleFieldResult = useCallback((result: FieldOperationResult) => {
    const skipped = result.skippedNodeIds?.length;
    if (result.success && result.removedAssetIds?.length) selection.replace([]);
    setFieldResult(
      skipped
        ? `${result.message} ${skipped} ${skipped === 1 ? 'entry skipped' : 'entries skipped'}.`
        : result.message.startsWith('Fields organized.')
          ? undefined
          : result.message,
    );
    if (result.success)
      setPendingInspectIds([...result.createdAssetIds, ...result.changedAssetIds]);
  }, []);
  const inspectRelatedAsset = useCallback(
    (asset: ReviewAsset) => setPendingInspectIds([asset.id]),
    [],
  );
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
    setOpenGlobalNotes(false);
    setIssueAssetId(undefined);
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
    if (next) inspect(next);
  };
  const singleReview = (action: string, asset: ReviewAsset) => {
    onAction?.(action, asset);
    if (autoAdvance && (action === 'accept' || action === 'exclude'))
      nextPending(asset.id, new Set([asset.id]));
  };
  // Memoized children dispatch against the current filtered view and selection.
  const commands = useRef({ toggle: selection.toggle, singleReview });
  useLayoutEffect(() => {
    commands.current = { toggle: selection.toggle, singleReview };
  });
  const toggleRow = useCallback(
    (id: string, range: boolean) => commands.current.toggle(id, range),
    [],
  );
  const reviewInspected = useCallback(
    (action: string, asset: ReviewAsset) => commands.current.singleReview(action, asset),
    [],
  );
  const acceptAll = () => {
    const accepted = onAcceptAllEligible?.() ?? 0;
    if (!accepted) return;
    setBatchAccepted(accepted);
    setBatchResult(undefined);
    selection.replace([]);
  };
  const reviewSelected = (action: ReviewBatchAction) => {
    if (!onReviewAssets || !selectedReviewActions[action]) return;
    const result = onReviewAssets(action, selectedAssets);
    setBatchResult({
      ...result,
      label:
        action === 'restore' ? 'restored to review' : action === 'accept' ? 'accepted' : 'excluded',
    });
    if (result.changedIds.length) setBatchAccepted(null);
    selection.replace([]);
    const changed = new Set(result.changedIds);
    if (action !== 'restore' && autoAdvance && selected && changed.has(selected.id))
      nextPending(selected.id, changed);
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
    const next =
      navigableAssets.find((asset, position) => position > index && issues.has(asset.id)) ??
      navigableAssets.find((asset) => issues.has(asset.id));
    if (!next) return;
    inspect(next);
    setIssueAssetId(next.id);
  };
  const issueHint = issueCount
    ? `Open the next asset with issues. ${issueCount} ${issueCount === 1 ? 'issue' : 'issues'} across ${issues.size} ${issues.size === 1 ? 'asset' : 'assets'} in this view.`
    : 'No asset issues in this view';

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('[role="dialog"][aria-modal="true"]'))
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          '.importer-coverage-card, .importer-review-note-control, .asset-source-fields-controls, .asset-review-pattern-popover, .asset-review-actions-menu, [role="dialog"]',
        )
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
          selectAll();
        }
        return;
      }
      if (command || event.shiftKey || !selected) return;
      if (key === 'a' || key === 'x') {
        const action = key === 'a' ? 'accept' : 'exclude';
        if (selectedAssets.length && bulkEnabled) {
          if (selectedReviewActions[action]) {
            event.preventDefault();
            reviewSelected(action);
          }
        } else if (onAction && canReviewAsset(action, selected)) {
          event.preventDefault();
          singleReview(action, selected);
        }
        return;
      }
      if (key !== 'arrowup' && key !== 'arrowdown') return;
      event.preventDefault();
      const index = navigableAssets.findIndex((asset) => asset.id === selected.id);
      const next = navigableAssets[index + (key === 'arrowup' ? -1 : 1)];
      if (next) inspect(next);
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
          <ImportCoverage
            coverage={preservation.coverage}
            recoveryRef={openCoverage}
            sourceNames={sources}
            assetNames={assetNames}
            reviewAssets={assets}
            onReviewMapping={inspectRelatedAsset}
            fieldOperations={preservation.fieldOperations}
            onExcludeFields={preservation.onExcludeFields}
          />
          {noteCount && setSourceNoteDestination ? (
            <NotesDestination
              key={source}
              recoveryRef={openNotes}
              scope={source === 'all' ? 'All sources' : (noteSources[0]?.sourceName ?? 'Source')}
              count={noteCount}
              destination={noteDestination}
              effectiveDestination={effectiveNoteDestination}
              hasUnchosen={needsNoteDestination}
              hasMixedDestinations={hasMixedDestinations}
              onChange={(destination) =>
                setSourceNoteDestination(source === 'all' ? null : source, destination)
              }
            />
          ) : null}
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
      {fieldResult || preservation?.fieldOperations?.canUndo ? (
        <Box
          role="status"
          className="asset-source-fields-controls"
          flexDirection="row"
          alignItems="center"
          gap="s"
          flexWrap="wrap"
        >
          {fieldResult ? <Text variant="bodySmall">{fieldResult}</Text> : null}
          {preservation?.fieldOperations?.canUndo ? (
            <Button
              title="Undo"
              accessibilityLabel="Undo field changes"
              variant="plain"
              size="sm"
              onPress={() => handleFieldResult(preservation.fieldOperations!.undo())}
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
            flexWrap="wrap"
            gap="xs"
          >
            <Text variant="bodySmall" semibold accessibilityRole="heading">
              Assets ({visible.length})
            </Text>
            <Box flexDirection="row" alignItems="center" gap="xs" flexWrap="wrap">
              {bulkEnabled ? (
                <Button
                  title={
                    navigableAssets.length && allMatchingSelected ? 'Deselect all' : 'Select all'
                  }
                  size="sm"
                  variant="plain"
                  disabled={!navigableAssets.length}
                  onPress={() => (allMatchingSelected ? selection.replace([]) : selectAll())}
                />
              ) : null}
              {bulkEnabled ? (
                <ReviewPatterns
                  key={JSON.stringify([source, search, filter, exception])}
                  assets={visible}
                  issues={issues}
                  onSelect={({ assetIds, representative }) => {
                    selection.replace(assetIds);
                    setFocusRevealedRow(true);
                    inspect(representative);
                  }}
                />
              ) : null}
              <Tooltip content={issueHint}>
                <Button
                  title={
                    <Text
                      className="asset-review-next-issue-label"
                      variant="buttonSmall"
                      color={issueCount ? 'primary120' : 'gray'}
                    >
                      Next issue
                    </Text>
                  }
                  endIcon={
                    <Icon
                      name="arrow-down"
                      size={12}
                      color={issueCount ? 'primary120' : 'gray'}
                      label=""
                    />
                  }
                  accessibilityLabel="Focus next issue"
                  size="sm"
                  minHeight={32}
                  variant="plain"
                  disabled={!issueCount}
                  onPress={focusNextIssue}
                />
              </Tooltip>
            </Box>
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
                <AssetRow
                  key={row.key}
                  asset={row.asset}
                  depth={row.depth}
                  inspected={row.asset.id === selected?.id}
                  selected={selection.selectedIdsSet.has(row.asset.id)}
                  onSelect={inspectRow}
                  onToggle={bulkEnabled ? toggleRow : undefined}
                />
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
            reviewActions={selectedReviewActions}
            result={batchResult}
            removal={
              selectedReviewActions.exclude &&
              preservation?.fieldOperations?.remove &&
              selectedAssets.some((asset) => asset.canRemoveDraft)
                ? {
                    canRemove: selectedAssets.every((asset) => asset.canRemoveDraft),
                    onRemove: () =>
                      handleFieldResult(
                        preservation.fieldOperations!.remove!(selectedAssets.map(({ id }) => id)),
                      ),
                  }
                : undefined
            }
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
            openIssuesRef={openIssues}
            assets={assets}
            onInspect={inspectRelatedAsset}
            fieldOperations={preservation?.fieldOperations}
            onFieldResult={handleFieldResult}
            onAction={onAction ? reviewInspected : undefined}
            resolveSourceValue={resolveSourceValue}
            onMapField={onMapField}
            onEditPlainText={onEditPlainText}
            onRenameAsset={preservation?.onRenameAsset}
            onSetNoteDestination={preservation?.onSetAssetNoteDestination}
            coverage={preservation?.coverage}
            onPreserveFields={preservation?.onPreserveFields}
            onExcludeFields={preservation?.onExcludeFields}
          />
        </Box>
      </Box>
    </Stack>
  );
}

export default AssetReviewQueue;
