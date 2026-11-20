import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, Button, Icon, IconAction, NoItemsPlaceholder, Text, Tooltip } from '@main-components';
import { useMarqueeSelection } from '@modules/_shared/ui/hooks/use-marquee-selection';
import { setItemDragImage } from '@shared/ui/drag/set-item-drag-image';
import { TREE_ICON_NAMES } from '@/assets/file-type-icons/catalog';
import type { Folder, FolderWorkspaceProps, GroupingAsset, PlanDraft, PlanRevealRequest } from '../../types';
import { PlanRow } from './components/PlanRow';
import { FolderActionsMenu } from './components/FolderActionsMenu';
import { FolderTreeSkeleton } from './components/FolderTreeSkeleton';
import { InlineFolderEditor } from './components/InlineFolderEditor';
import { FolderTreeHeader } from './components/FolderTreeHeader';
import { FolderSelectionToolbar } from './components/FolderSelectionToolbar';
import { FolderMoveModal } from './components/FolderMoveModal';
import { MovePlansModal } from './components/MovePlansModal';
import { moveRoots, validFolderDestination } from './hooks/folder-drag-move';
import { PlanAssetTreeRow } from './components/PlanAssetTreeRow';
import { AssetActionsMenu } from './components/AssetActionsMenu';
import { AssetSelectionToolbar, folderTarget } from '../AssetSelectionToolbar';
import type { useAssetSelection } from '../../hooks/use-asset-selection';
import { folderPath, folderPathLabel } from '../../hooks/folder-path';
import { canCreatePlanAtDestination } from '@modules/organization/domain/plan-folder';

type Props = {
  workspace: FolderWorkspaceProps;
  toolbar?: React.ReactNode;
  targetFolderId?: string | null;
  onTargetFolderChange?: (folderId: string | null) => void;
  plans: PlanDraft[];
  dragAssets: GroupingAsset[];
  onCreatePlan?: (options?: {
    name?: string;
    folderId?: string | null;
    scope?: 'SHARED' | 'PERSONAL';
  }) => string | void;
  onCreatePlansFromAssets?: (
    assets: GroupingAsset[],
    options: { name: string; folderId: string | null; scope: 'SHARED' | 'PERSONAL' },
  ) => string[] | void;
  revealRequest?: PlanRevealRequest;
  onRenamePlan?: (plan: PlanDraft, name: string) => void;
  onSelectPlan?: (plan: PlanDraft) => void;
  onEditPlan?: (plan: PlanDraft) => void;
  onDeletePlan?: (plan: PlanDraft) => void;
  onDeletePlans?: (plans: PlanDraft[]) => void;
  onMovePlan?: (plan: PlanDraft, folderId: string | null, scope: 'SHARED' | 'PERSONAL') => void;
  onMovePlans?: (plans: PlanDraft[], folderId: string | null, scope: 'SHARED' | 'PERSONAL') => void;
  onAssign?: (asset: GroupingAsset, plan: PlanDraft) => void;
  onAssignMany?: (assets: GroupingAsset[], plan: PlanDraft) => void;
  assetSelection?: ReturnType<typeof useAssetSelection>;
  onAssetDragStart?: (asset: GroupingAsset) => void;
  onAssetDragEnd?: () => void;
  onUnassignMany?: (assets: GroupingAsset[]) => void;
};

export function OrganizationFolderTree({
  workspace,
  toolbar,
  targetFolderId: controlledTargetFolderId,
  onTargetFolderChange,
  plans,
  dragAssets,
  onCreatePlan,
  onCreatePlansFromAssets,
  revealRequest,
  onRenamePlan,
  onSelectPlan,
  onEditPlan,
  onDeletePlan,
  onDeletePlans,
  onMovePlan,
  onMovePlans,
  onAssign,
  onAssignMany,
  assetSelection,
  onAssetDragStart,
  onAssetDragEnd,
  onUnassignMany,
}: Props) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const [expandedPlans, setExpandedPlans] = useState<string[]>([]);
  const [collapsedSearchIds, setCollapsedSearchIds] = useState<string[]>([]);
  const [selectedPlanIds, setSelectedPlanIds] = useState<string[]>([]);
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
  const livePlanIds = plans.map((plan) => plan.id).join('\0');
  useEffect(() => {
    const live = new Set(plans.map((plan) => plan.id));
    setSelectedPlanIds((current) => current.every((id) => live.has(id)) ? current : current.filter((id) => live.has(id)));
  }, [livePlanIds]);
  const selectedAssetIds = assetSelection?.selectedIds.join(',');
  useEffect(() => {
    if (selectedAssetIds) { setSelectedPlanIds([]); setSelectedFolderIds([]); }
  }, [selectedAssetIds]);
  const selectionAnchor = useRef<string | undefined>(undefined);
  const [query, setQuery] = useState('');
  useEffect(() => { setCollapsedSearchIds([]); }, [query, workspace.scope]);
  const [editing, setEditing] = useState<{ folder?: Folder; parentId: string | null }>();
  // Restore the draft if collapsing or filtering unmounts the input.
  const draftName = useRef('');
  const [pending, setPending] = useState(false);
  const saving = useRef(false);
  const cancelled = useRef(false);
  const [error, setError] = useState('');
  const [localTargetFolderId, setLocalTargetFolderId] = useState<string | null>(null);
  const targetFolderId = controlledTargetFolderId === undefined ? localTargetFolderId : controlledTargetFolderId;
  const [dropId, setDropId] = useState<string | null>();
  const [dropValid, setDropValid] = useState(false);
  const [draggedFolderIds, setDraggedFolderIds] = useState<string[]>([]);
  const [draggedPlanIds, setDraggedPlanIds] = useState<string[]>([]);
  const [folderMove, setFolderMove] = useState<{ folders: Folder[]; destination: string | null }>();
  const [moveSelectedIds, setMoveSelectedIds] = useState<string[]>();
  const expandTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hoveredFolder = useRef<string | null | undefined>(undefined);
  const clearFolderDrag = () => { setDraggedFolderIds([]); clearTimeout(expandTimer.current); hoveredFolder.current = undefined; };
  const folderRoots = (ids: string[]) => moveRoots(workspace.folders, ids);
  const validFolderDrop = (ids: string[], id: string | null) =>
    Boolean(workspace.onMoveFolder && workspace.onPreviewFolderChange) && validFolderDestination(workspace.folders, folderRoots(ids), id, workspace.scope);
  const hoverFolder = (ids: string[], id: string | null) => {
    const valid = validFolderDrop(ids, id);
    setDropId(id); setDropValid(valid);
    if (hoveredFolder.current !== id) {
      clearTimeout(expandTimer.current);
      hoveredFolder.current = id;
      if (valid && id && !expanded.includes(id)) expandTimer.current = setTimeout(() => setExpanded((current) => [...new Set([...current, id])]), 600);
    }
    return valid;
  };
  const dropFolders = (event: DragEvent, id: string | null) => {
    const raw = event.dataTransfer?.getData('text/folder-ids');
    let ids: string[] = [];
    try { ids = JSON.parse(raw ?? '[]'); } catch { /* malformed drag payload */ }
    if (Array.isArray(ids) && ids.every((item) => typeof item === 'string') && validFolderDrop(ids, id) && ids.join(',') === draggedFolderIds.join(',')) {
      if (id) setExpanded((current) => [...new Set([...current, id])]);
      setFolderMove({ folders: folderRoots(ids).filter((folder) => folder.parentId !== id), destination: id });
    }
    clearFolderDrag(); setDropId(undefined);
  };
  useEffect(() => {
    const clearDropTarget = () => { setDropId(undefined); clearFolderDrag(); setDraggedPlanIds([]); };
    window.addEventListener('drop', clearDropTarget);
    window.addEventListener('dragend', clearDropTarget);
    window.addEventListener('blur', clearDropTarget);
    window.addEventListener('mouseup', clearDropTarget);
    return () => {
      window.removeEventListener('drop', clearDropTarget);
      window.removeEventListener('dragend', clearDropTarget);
      window.removeEventListener('blur', clearDropTarget);
      window.removeEventListener('mouseup', clearDropTarget);
      clearTimeout(expandTimer.current);
    };
  }, []);
  const visibleFolders = workspace.folders.filter((folder) => folder.scope === workspace.scope);
  const visiblePlans = plans.filter(
    (plan) => (plan.sharingModel === 'PRIVATE' ? 'PERSONAL' : 'SHARED') === workspace.scope,
  );
  const matchesPlanSearch = (plan: PlanDraft) => plan.name.toLowerCase().includes(query.toLowerCase());
  const matchesFolderSearch = (folder: Folder) => {
    const search = query.toLowerCase();
    const descendantsMatch = (id: string, visited: Set<string>): boolean => {
      if (visited.has(id)) return false;
      visited.add(id);
      return visibleFolders.some((child) => child.parentId === id &&
        (child.name.toLowerCase().includes(search) || descendantsMatch(child.id, visited)));
    };
    return folder.name.toLowerCase().includes(search) || descendantsMatch(folder.id, new Set()) ||
      visiblePlans.some((plan) => plan.folderId === folder.id && matchesPlanSearch(plan));
  };
  const [visibleReveal, setVisibleReveal] = useState<PlanRevealRequest>();
  const [renamingPlanId, setRenamingPlanId] = useState<string>();
  const handledReveal = useRef(0);
  useLayoutEffect(() => {
    if (!revealRequest || handledReveal.current === revealRequest.sequence || workspace.loading) return;
    const plan = visiblePlans.find((item) => item.id === revealRequest.id);
    if (!plan || (workspace.error && !workspace.hasLoaded && !visibleFolders.length)) return;
    handledReveal.current = revealRequest.sequence;

    const path = folderPath(workspace.folders, plan.folderId, workspace.scope);
    const ancestorIds = new Set(path.map((folder) => folder.id));
    setExpanded((current) => [...new Set([...current, ...ancestorIds])]);
    setExpandedPlans((current) => current.includes(plan.id) ? current : [...current, plan.id]);

    if (query) {
      if (!matchesPlanSearch(plan) || path.some((folder) => !matchesFolderSearch(folder)))
        setQuery('');
      else
        setCollapsedSearchIds((current) => current.filter((id) => !ancestorIds.has(id)));
    }
    if (revealRequest.rename && onRenamePlan) setRenamingPlanId(plan.id);
    setVisibleReveal(revealRequest);
  }, [revealRequest, plans, workspace.folders, workspace.scope, workspace.loading, workspace.error, workspace.hasLoaded, query, onRenamePlan]);
  useEffect(() => {
    if (renamingPlanId && !visiblePlans.some((plan) => plan.id === renamingPlanId))
      setRenamingPlanId(undefined);
  }, [renamingPlanId, plans, workspace.scope]);
  const visibleAssets = visiblePlans.flatMap((plan) => expandedPlans.includes(plan.id) || Boolean(query) ? plan.assignedAssets ?? [] : []);
  const renderedAssets = () => {
    const assetsById = new Map(visibleAssets.map((asset) => [asset.id, asset]));
    return Array.from(marquee.containerRef.current?.querySelectorAll<HTMLElement>('[data-assigned-asset-id]') ?? []).flatMap((row) => {
      const asset = assetsById.get(row.dataset.assignedAssetId!);
      return asset ? [asset] : [];
    });
  };
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target instanceof Element && target.closest('input:not([type="checkbox"]), textarea, select, [contenteditable="true"], [role="dialog"], .folder-menu-popover, .asset-selection-popover')) return;
      if (event.key === 'Escape') {
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        setSelectedPlanIds([]);
        setSelectedFolderIds([]);
        assetSelection?.clear();
        setDropId(undefined); clearFolderDrag();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a' && document.activeElement?.closest('.organization-folder-tree')) {
        event.preventDefault();
        if (assetSelection?.pane === 'organization') assetSelection.selectAll(renderedAssets(), 'organization');
        else setSelectedPlanIds(Array.from(marquee.containerRef.current?.querySelectorAll<HTMLElement>('[data-plan-row-id]') ?? []).map((row) => row.dataset.planRowId!).slice(0, 100));
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  });
  const destinationReady = (folderId: string | null) =>
    canCreatePlanAtDestination(folderId, workspace.scope, workspace.folders);
  const canCreateFromAssets = (assets: GroupingAsset[], folderId: string | null) =>
    Boolean(onCreatePlansFromAssets && destinationReady(folderId) && assets.length && assets.every((asset) => asset.valid !== false));
  const plansBeingDragged = () => draggedPlanIds.map((id) => plans.find((plan) => plan.id === id));
  const canDropPlans = (folderId: string | null) => draggedPlanIds.length > 0 &&
    plansBeingDragged().every((plan) => plan && (plan.sharingModel === 'PRIVATE' ? 'PERSONAL' : 'SHARED') === workspace.scope) &&
    plansBeingDragged().some((plan) => plan?.folderId !== folderId) && destinationReady(folderId) &&
    Boolean(onMovePlans || (draggedPlanIds.length === 1 && onMovePlan));
  const hoverContent = (event: DragEvent, folderId: string | null) => {
    const valid = draggedPlanIds.length || event.dataTransfer?.types?.includes('text/plan-id') ? canDropPlans(folderId) : canCreateFromAssets(dragAssets, folderId);
    setDropId(folderId); setDropValid(valid);
    if (valid) event.preventDefault();
    else if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  };
  useEffect(() => {
    setEditing(undefined); clearFolderDrag(); setDraggedPlanIds([]); setDropId(undefined);
    setSelectedPlanIds([]);
    setSelectedFolderIds([]);
    assetSelection?.clear();
    if (controlledTargetFolderId === undefined) {
      setLocalTargetFolderId(null);
      onTargetFolderChange?.(null);
    }
  }, [workspace.scope]);
  useEffect(() => {
    if (localTargetFolderId && !visibleFolders.some((folder) => folder.id === localTargetFolderId)) {
      setLocalTargetFolderId(null);
      onTargetFolderChange?.(null);
    }
  }, [localTargetFolderId, workspace.folders, workspace.scope]);
  useEffect(() => {
    const ancestors = folderPath(workspace.folders, targetFolderId, workspace.scope).slice(0, -1).map((folder) => folder.id);
    if (!ancestors.length) return;
    setExpanded((current) => [...new Set([...current, ...ancestors])]);
    setCollapsedSearchIds((current) => current.filter((id) => !ancestors.includes(id)));
  }, [targetFolderId, workspace.scope, workspace.folders]);
  useEffect(() => { setSelectedPlanIds([]); setSelectedFolderIds([]); assetSelection?.clear(); }, [query]);
  const selectPlan = (plan: PlanDraft, event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; toggle?: boolean }) => {
    const ids = Array.from(marquee.containerRef.current?.querySelectorAll<HTMLElement>('[data-plan-row-id]') ?? []).map((row) => row.dataset.planRowId!);
    setSelectedFolderIds([]);
    assetSelection?.clear();
    if (event.shiftKey && selectionAnchor.current) {
      const start = ids.indexOf(selectionAnchor.current), end = ids.indexOf(plan.id);
      if (start >= 0 && end >= 0) setSelectedPlanIds(ids.slice(Math.min(start, end), Math.max(start, end) + 1).slice(0, 100));
    } else if (event.ctrlKey || event.metaKey || event.toggle) {
      setSelectedPlanIds((current) => current.includes(plan.id) ? current.filter((id) => id !== plan.id) : [...current, plan.id].slice(0, 100));
      selectionAnchor.current = plan.id;
    }
  };
  const selectFolder = (folder: Folder, event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; toggle?: boolean }) => {
    if (!(event.ctrlKey || event.metaKey || event.shiftKey || event.toggle)) return;
    setSelectedPlanIds([]);
    assetSelection?.clear();
    setSelectedFolderIds((current) => current.includes(folder.id) ? current.filter((id) => id !== folder.id) : [...current, folder.id].slice(0, 100));
  };
  const marquee = useMarqueeSelection({ selectedIds: selectedPlanIds, onSelect: (ids) => { setSelectedFolderIds([]); assetSelection?.clear(); setSelectedPlanIds(ids.slice(0, 100)); }, resetKey: `${workspace.scope}:${query}`, rowSelector: '[data-plan-row-id]', getRowIds: (element) => [element.dataset.planRowId!], onStart: () => setSelectedFolderIds([]), excludeSelector: '[data-assigned-asset-id]' });
  const assetMarquee = useMarqueeSelection({ selectedIds: assetSelection?.pane === 'organization' ? assetSelection.selectedIds : [], onSelect: (ids) => { setSelectedPlanIds([]); setSelectedFolderIds([]); assetSelection?.replaceSelection(ids, 'organization'); }, resetKey: `${workspace.scope}:${query}`, rowSelector: '[data-assigned-asset-id]', startSelector: '[data-assigned-asset-id]', getRowIds: (element) => [element.dataset.assignedAssetId!], onStart: () => { setSelectedPlanIds([]); setSelectedFolderIds([]); } });
  const movePlans = (plansToMove: PlanDraft[], folderId: string | null) => {
    setDropId(undefined);
    if (!plansToMove.length || !destinationReady(folderId) || plansToMove.some((plan) => (plan.sharingModel === 'PRIVATE' ? 'PERSONAL' : 'SHARED') !== workspace.scope)) return;
    if (plansToMove.length > 1 && !onMovePlans) return;
    if (plansToMove.length === 1) { if (onMovePlans) onMovePlans(plansToMove, folderId, workspace.scope); else onMovePlan?.(plansToMove[0]!, folderId, workspace.scope); }
    else onMovePlans?.(plansToMove, folderId, workspace.scope);
    if (folderId) setExpanded((current) => [...new Set([...current, folderId])]);
    setSelectedPlanIds([]);
  };
  const chooseTarget = (folderId: string | null) => {
    if (controlledTargetFolderId === undefined) setLocalTargetFolderId(folderId);
    onTargetFolderChange?.(folderId);
  };

  const begin = (parentId: string | null, folder?: Folder) => {
    if (saving.current) return;
    if (parentId) setExpanded((current) => current.includes(parentId) ? current : [...current, parentId]);
    if (editing?.parentId === parentId && editing.folder?.id === folder?.id) return;
    cancelled.current = false;
    draftName.current = folder?.name ?? '';
    setEditing({ parentId, folder });
    setError('');
  };
  const save = async (name: string) => {
    if (
      !editing ||
      saving.current ||
      cancelled.current ||
      (!editing.folder && !workspace.onCreateFolder) ||
      (editing.folder && !workspace.onRenameFolder)
    )
      return;
    const next = name.trim();
    if (!next) {
      setError('Folder name is required.');
      return;
    }
    try {
      saving.current = true;
      setPending(true);
      if (editing.folder) await workspace.onRenameFolder?.(editing.folder, next);
      else
        await workspace.onCreateFolder?.({
          name: next,
          parentId: editing.parentId,
          scope: workspace.scope,
          policy: null,
        });
      setEditing(undefined);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save folder.');
    } finally {
      saving.current = false;
      setPending(false);
    }
  };
  const editor = (parentId: string | null, folder?: Folder, depth = 0) =>
    editing?.parentId === parentId && editing?.folder?.id === folder?.id ? (
      <InlineFolderEditor
        key={folder ? `rename-${folder.id}` : `create-${parentId ?? ''}`}
        folder={folder}
        depth={depth}
        initialName={draftName.current}
        onDraftChange={(value) => { draftName.current = value; }}
        pending={pending}
        error={error}
        onSave={(nextName) => void save(nextName)}
        onCancel={() => {
          if (saving.current) return;
          cancelled.current = true;
          draftName.current = '';
          setEditing(undefined);
        }}
      />
    ) : null;
  const createFromAssets = (assets: GroupingAsset[], folderId: string | null) => {
    if (!canCreateFromAssets(assets, folderId)) return;
    onCreatePlansFromAssets?.(assets, {
      name: assets.length === 1 ? assets[0]!.name : `${assets.length} imported assets`,
      folderId,
      scope: workspace.scope,
    });
    if (folderId) setExpanded((current) => [...new Set([...current, folderId])]);
  };
  const drop = (folderId: string | null) => {
    createFromAssets(dragAssets, folderId);
    setDropId(undefined);
  };
  const countLocalDrafts = (folderIds: string[]) => {
    const selected = new Set(folderIds);
    return plans.filter((plan) => {
      let id = plan.folderId;
      const seen = new Set<string>();
      while (id && !seen.has(id)) {
        if (selected.has(id)) return true;
        seen.add(id);
        id = workspace.folders.find((folder) => folder.id === id)?.parentId;
      }
      return false;
    }).length;
  };
  const clearClosedSelection = (folderIds: Set<string>, planIds: Set<string>) => {
    setSelectedFolderIds((current) => current.filter((id) => !folderIds.has(id)));
    setSelectedPlanIds((current) => current.filter((id) => !planIds.has(id)));
    if (assetSelection?.pane !== 'organization') return;
    const assetIds = new Set(plans.filter((plan) => planIds.has(plan.id)).flatMap((plan) => plan.assignedAssets?.map((asset) => asset.id) ?? []));
    const remaining = assetSelection.selectedIds.filter((id) => !assetIds.has(id));
    if (remaining.length !== assetSelection.selectedIds.length) {
      if (remaining.length) assetSelection.replaceSelection(remaining, 'organization');
      else assetSelection.clear();
    }
  };
  const toggleFolder = (id: string, open: boolean) => {
    if (open) {
      const branchIds = new Set<string>([id]);
      for (let changed = true; changed;) {
        changed = false;
        for (const folder of visibleFolders) if (folder.parentId && branchIds.has(folder.parentId) && !branchIds.has(folder.id)) {
          branchIds.add(folder.id); changed = true;
        }
      }
      clearClosedSelection(branchIds, new Set(visiblePlans.filter((plan) => plan.folderId && branchIds.has(plan.folderId)).map((plan) => plan.id)));
    }
    setExpanded((current) => open ? current.filter((item) => item !== id) : [...new Set([...current, id])]);
    if (query) setCollapsedSearchIds((current) => open ? [...new Set([...current, id])] : current.filter((item) => item !== id));
  };
  const row = (folder: Folder, depth: number): React.ReactNode => {
    const children = visibleFolders.filter((item) => item.parentId === folder.id);
    const planCount = countLocalDrafts([folder.id]);
    if (query && !matchesFolderSearch(folder)) return null;
    const open = query ? !collapsedSearchIds.includes(folder.id) : expanded.includes(folder.id);
    const branchIds = new Set<string>([folder.id]);
    for (let changed = true; changed;) {
      changed = false;
      for (const item of visibleFolders) if (!branchIds.has(item.id) && item.parentId && branchIds.has(item.parentId)) {
        branchIds.add(item.id); changed = true;
      }
    }
    const branchPlanIds = visiblePlans.filter((plan) => plan.folderId && branchIds.has(plan.folderId)).map((plan) => plan.id);
    const branchOpen = [...branchIds].every((id) => expanded.includes(id) || (query && !collapsedSearchIds.includes(id))) && branchPlanIds.every((id) => expandedPlans.includes(id));
    const toggleBranch = () => {
      if (branchOpen) clearClosedSelection(branchIds, new Set(branchPlanIds));
      setExpanded((current) => branchOpen ? current.filter((id) => !branchIds.has(id)) : [...new Set([...current, ...branchIds])]);
      setExpandedPlans((current) => branchOpen ? current.filter((id) => !branchPlanIds.includes(id)) : [...new Set([...current, ...branchPlanIds])]);
      if (query) setCollapsedSearchIds((current) => branchOpen ? [...new Set([...current, ...branchIds])] : current.filter((id) => !branchIds.has(id)));
    };
    return (
      <Box key={folder.id}>
        <Box
          className={`folder-tree-row ${dropId === folder.id ? dropValid ? 'over-valid' : 'over-invalid' : ''} ${targetFolderId === folder.id && open ? 'is-target' : ''} ${selectedFolderIds.includes(folder.id) ? 'is-selected' : ''}`}
          role="treeitem" tabIndex={0} aria-expanded={open} aria-selected={selectedFolderIds.includes(folder.id)}
          onClick={(event: MouseEvent) => { if ((event.target as HTMLElement).closest('button, input, [role="button"], [role="dialog"]')) return; if (event.ctrlKey || event.metaKey || event.shiftKey) selectFolder(folder, event); else { chooseTarget(folder.id); toggleFolder(folder.id, open); } }}
          onKeyDown={(event: KeyboardEvent) => { if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return; event.preventDefault(); if (event.ctrlKey || event.metaKey || event.shiftKey) selectFolder(folder, event); else { chooseTarget(folder.id); toggleFolder(folder.id, open); } }}
          flexDirection="row"
          alignItems="center"
          gap="xs"
          style={{ paddingLeft: depth * 28 + 16 }}
          draggable={Boolean(workspace.onMoveFolder && workspace.onPreviewFolderChange)}
          onDragStart={(event: DragEvent) => {
            if (!workspace.onMoveFolder || !workspace.onPreviewFolderChange || !event.dataTransfer) return;
            const ids = folderRoots(selectedFolderIds.includes(folder.id) ? selectedFolderIds : [folder.id]).map((item) => item.id);
            event.dataTransfer.setData('text/folder-ids', JSON.stringify(ids));
            event.dataTransfer.effectAllowed = 'move';
            setDraggedFolderIds(ids);
            setItemDragImage(event.dataTransfer, event.currentTarget as HTMLElement, folder.name, ids.length, `${ids.length} ${ids.length === 1 ? 'folder' : 'folders'}`, '.folder-tree-icon');
          }}
          onDragEnd={clearFolderDrag}
          onDragOver={(event: DragEvent) => {
            if (draggedFolderIds.length) {
              event.stopPropagation();
              event.dataTransfer!.dropEffect = hoverFolder(draggedFolderIds, folder.id) ? 'move' : 'none';
              if (validFolderDrop(draggedFolderIds, folder.id)) event.preventDefault();
              return;
            }
            event.stopPropagation(); hoverContent(event, folder.id);
          }}
          onDragLeave={(event: DragEvent) => {
            if ((event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) return;
            setDropId(undefined); clearTimeout(expandTimer.current); hoveredFolder.current = undefined;
          }}
          onDrop={(event: DragEvent) => {
            if (draggedFolderIds.length || event.dataTransfer?.types?.includes('text/folder-ids')) { event.stopPropagation(); event.preventDefault(); dropFolders(event, folder.id); return; }
            event.preventDefault();
            const plan = plans.find(
              (item) => item.id === event.dataTransfer?.getData('text/plan-id'),
            );
            if (plan && canDropPlans(folder.id)) {
              movePlans(selectedPlanIds.includes(plan.id) ? visiblePlans.filter((item) => selectedPlanIds.includes(item.id)) : [plan], folder.id);
            } else if (!event.dataTransfer?.types?.includes('text/plan-id')) drop(folder.id);
            setDraggedPlanIds([]);
          }}
        >
          <IconAction
            name={open ? TREE_ICON_NAMES.collapse : TREE_ICON_NAMES.expand}
            label={open ? 'Collapse' : 'Expand'}
            onPress={() => toggleFolder(folder.id, open)}
          />
          <Box className="folder-tree-icon"><Icon
            name={open ? TREE_ICON_NAMES.folderOpen : TREE_ICON_NAMES.folder}
            size={20}
            color={dropId === folder.id && !dropValid ? 'warning' : 'primary'}
          /></Box>
          <Box
            flex={1}

            onDoubleClick={() => workspace.onRenameFolder && begin(folder.parentId, folder)}
          >
            <Text className="folder-tree-name" variant="bodySmall">{folder.name}</Text>
          </Box>
          {targetFolderId === folder.id ? <Tooltip content="New plans will be created here"><Box alignItems="center" justifyContent="center" width={18} height={18}><Icon name="bullseye" size={12} color="primary" label="New plan destination" /></Box></Tooltip> : null}
          {!destinationReady(folder.id) ? (
            <Text
              variant="bodySmall"
              color="warning120"
              title="Set folder permissions before creating plans here."
            >
              Permissions needed
            </Text>
          ) : null}
          <Tooltip content={branchOpen ? 'Collapse all folders and plans' : 'Expand all folders and plans'}><IconAction name={branchOpen ? 'angles-up' : 'angles-down'} label={`${branchOpen ? 'Collapse' : 'Expand'} all in ${folder.name}`} onPress={toggleBranch} /></Tooltip>
          <Text className="folder-tree-count" color="gray" variant="bodySmall">
            {planCount} {planCount === 1 ? 'plan' : 'plans'}
          </Text>
          <FolderActionsMenu
            folder={folder}
            workspace={workspace}
            localDraftCount={countLocalDrafts([folder.id])}
            canCreatePlan={destinationReady(folder.id)}
            onCreatePlan={
              onCreatePlan
                ? () => onCreatePlan({ folderId: folder.id, scope: workspace.scope })
                : undefined
            }
            editingPending={pending}
            onNewSubfolder={() => begin(folder.id)}
            onRename={() => begin(folder.parentId, folder)}
          />
        </Box>
        {editor(folder.parentId, folder, depth)}
        {open ? (
          <Box>
            {editor(folder.id, undefined, depth + 1)}
            {children.map((child) => row(child, depth + 1))}
            {visiblePlans
              .filter(
                (plan) =>
                  plan.folderId === folder.id &&
                  (!query || matchesPlanSearch(plan)),
              )
              .map((plan) => planRow(plan, depth + 1))}
            {!query && !children.length && !visiblePlans.some((plan) => plan.folderId === folder.id) && editing?.parentId !== folder.id ? (
              <Box className="folder-tree-empty" padding="s" style={{ paddingLeft: (depth + 1) * 28 + 20 }}>
                <Text variant="bodySmall" color="gray50">No plans in this folder.</Text>
              </Box>
            ) : null}
          </Box>
        ) : null}
      </Box>
    );
  };
  const planRow = (plan: PlanDraft, depth: number) => (
    <PlanRow
      key={plan.id}
      plan={plan}
      depth={depth}
      active={dropId === plan.id}
      dropValid={dropValid}
      selected={selectedPlanIds.includes(plan.id)}
      open={expandedPlans.includes(plan.id)}
      revealSequence={visibleReveal?.id === plan.id ? visibleReveal.sequence : undefined}
      onRevealComplete={() => setVisibleReveal(undefined)}
      onRename={renamingPlanId === plan.id && onRenamePlan ? (name) => {
        if (name !== undefined && name !== plan.name) {
          if (query && !matchesPlanSearch({ ...plan, name })) setQuery('');
          onRenamePlan(plan, name);
        }
        setRenamingPlanId(undefined);
      } : undefined}
      onToggle={() => { if (expandedPlans.includes(plan.id)) clearClosedSelection(new Set(), new Set([plan.id])); setExpandedPlans((current) => current.includes(plan.id) ? current.filter((id) => id !== plan.id) : [...current, plan.id]); }}
      onToggleSelection={(event) => selectPlan(plan, event)}
      onDragStart={(event) => { if (!event.dataTransfer) return; const ids = selectedPlanIds.includes(plan.id) ? selectedPlanIds : [plan.id]; const count = ids.length; setDraggedPlanIds(ids); event.dataTransfer.setData('text/plan-id', plan.id); setItemDragImage(event.dataTransfer, event.currentTarget as HTMLElement, plan.name, count, `${count} ${count === 1 ? 'plan' : 'plans'}`, '.plan-mosaic'); }}
      dragAssets={dragAssets}
      onSelect={onSelectPlan}
      onEdit={onEditPlan}
      onDelete={onDeletePlan}
      onAssign={onAssign}
      onAssignMany={onAssignMany}
      onDropEnd={setDropId}
      onDropValidity={setDropValid}
      renderAsset={(asset, assetDepth) => <PlanAssetTreeRow key={asset.id} asset={asset} depth={assetDepth}
        selected={assetSelection?.pane === 'organization' && assetSelection.selectedIdSet.has(asset.id)}
        onSelect={(event) => { setSelectedPlanIds([]); setSelectedFolderIds([]); assetSelection?.select(asset.id, renderedAssets(), 'organization', event); }}
        onDragStart={(event) => { onAssetDragStart?.(asset); if (event.dataTransfer) { const count = assetSelection?.pane === 'organization' && assetSelection.selectedIdSet.has(asset.id) ? assetSelection.selectedIds.length : 1; setItemDragImage(event.dataTransfer, event.currentTarget as HTMLElement, asset.name, count, `${count} ${count === 1 ? 'asset' : 'assets'}`, '.folder-plan-asset-icon'); } }}
        onDragEnd={onAssetDragEnd}
        actions={<AssetActionsMenu asset={asset} assets={assetSelection?.pane === 'organization' && assetSelection.selectedIdSet.has(asset.id) ? assetSelection.assets : [asset]} plans={visiblePlans}
          onMove={onAssignMany} onUnassign={onUnassignMany ? (assets) => { onUnassignMany(assets); assetSelection?.clear(); } : undefined} />}
      />}
    />
  );

  return (
    <Box className="organization-folder-tree" gap="s">
      <FolderTreeHeader
        onNewFolder={() => begin(null)}
        canNewFolder={!!workspace.onCreateFolder && !pending}
        refreshing={workspace.refreshing}
        query={query}
        onQueryChange={setQuery}
        onRootTarget={() => chooseTarget(null)}
        targetPath={folderPathLabel(workspace.folders, targetFolderId, workspace.scope)}
        destinationWarning={!destinationReady(targetFolderId)}
      />
      <Box className="folder-tree-columns" flexDirection="row" alignItems="center">
        <Text variant="bodySmall" color="gray">Folder</Text>
        <Text variant="bodySmall" color="gray">Assets</Text>
        <Box width={40} />
      </Box>
      <Box className={`organization-folder-scroll ${dropId === null ? (dropValid ? 'over-valid' : 'over-invalid') : ''}`} role="tree" tabIndex={0} aria-label="Organisation folders" ref={(element: HTMLElement | null) => { marquee.containerRef.current = element; assetMarquee.containerRef.current = element; }}
        onDragOver={(event: DragEvent) => {
          if ((event.target as HTMLElement).closest('[role="treeitem"]')) return;
          if (draggedFolderIds.length) {
            event.dataTransfer!.dropEffect = hoverFolder(draggedFolderIds, null) ? 'move' : 'none';
            if (validFolderDrop(draggedFolderIds, null)) event.preventDefault();
            return;
          }
          hoverContent(event, null);
        }}
        onDrop={(event: DragEvent) => {
          if ((event.target as HTMLElement).closest('[role="treeitem"]')) return;
          if (draggedFolderIds.length || event.dataTransfer?.types?.includes('text/folder-ids')) { event.stopPropagation(); event.preventDefault(); dropFolders(event, null); return; }
          event.preventDefault();
          const plan = plans.find((item) => item.id === event.dataTransfer?.getData('text/plan-id'));
          if (plan && canDropPlans(null)) movePlans(selectedPlanIds.includes(plan.id) ? visiblePlans.filter((item) => selectedPlanIds.includes(item.id)) : [plan], null);
          else if (!event.dataTransfer?.types?.includes('text/plan-id')) drop(null);
          setDraggedPlanIds([]);
        }}
      >
        {workspace.loading ? (
          <FolderTreeSkeleton />
        ) : null}
        {!workspace.loading && workspace.error ? (
          <Box gap="s">
            <Text color="danger120" accessibilityRole="alert">{workspace.error}</Text>
            <Button
              title="Retry"
              size="sm"
              disabled={!workspace.onRetry}
              onPress={() => workspace.onRetry?.()}
            />
          </Box>
        ) : null}
        {!workspace.loading && (!workspace.error || workspace.hasLoaded || visibleFolders.length > 0) ? (
          <>
            {editor(null)}
            {visibleFolders
              .filter(
                (folder) =>
                  !folder.parentId ||
                  !visibleFolders.some((parent) => parent.id === folder.parentId),
              )
              .map((folder) => row(folder, 0))}
            {visiblePlans
              .filter(
                (plan) =>
                  (!plan.folderId || !visibleFolders.some((folder) => folder.id === plan.folderId)) &&
                  (!query || matchesPlanSearch(plan)),
              )
              .map((plan) => planRow(plan, 0))}
            {!workspace.error && !visibleFolders.length && !visiblePlans.length && !editing ? (
              <Box flex={1} minHeight={220} alignItems="center" justifyContent="center" padding="m">
                <NoItemsPlaceholder
                  iconName={TREE_ICON_NAMES.folder}
                  title={workspace.scope === 'PERSONAL' ? 'No private folders or plans yet' : 'No shared folders or plans yet'}
                  description={workspace.scope === 'PERSONAL'
                    ? 'Create a folder, or drag assets here to create a private plan.'
                    : 'Create a folder, or drag assets here to create a shared plan.'}
                />
              </Box>
            ) : null}
          </>
        ) : null}
      </Box>
      {toolbar ? <Box className="folder-tree-footer">{toolbar}</Box> : null}
      {selectedPlanIds.length ? <Box className="folder-tree-selection" flexDirection="row" alignItems="center" gap="s"><Text variant="bodySmall">{selectedPlanIds.length} {selectedPlanIds.length === 1 ? 'plan' : 'plans'} selected</Text><Button title="Move to folder" size="sm" disabled={!onMovePlans || !visiblePlans.some((plan) => selectedPlanIds.includes(plan.id))} onPress={() => setMoveSelectedIds(selectedPlanIds)} /><Button title="Clear selection" size="sm" variant="plain" onPress={() => setSelectedPlanIds([])} />{onDeletePlans ? <Button title="Delete selected" size="sm" color="danger" variant="plain" disabled={!visiblePlans.some((plan) => selectedPlanIds.includes(plan.id))} onPress={() => onDeletePlans(visiblePlans.filter((plan) => selectedPlanIds.includes(plan.id)))} /> : null}</Box> : null}
      {selectedFolderIds.length ? <Box className="folder-tree-selection"><FolderSelectionToolbar folders={visibleFolders.filter((folder) => selectedFolderIds.includes(folder.id))} workspace={workspace} localDraftCount={countLocalDrafts(selectedFolderIds)} onClear={() => setSelectedFolderIds([])} /></Box> : null}
      {assetSelection?.pane === 'organization' && assetSelection.assets.length ? (
        <AssetSelectionToolbar
          assets={assetSelection.assets}
          plans={visiblePlans}
          onClear={assetSelection.clear}
          onMove={onAssignMany}
          moveLabel="Move to plan"
          createDestination={onCreatePlansFromAssets ? folderTarget(workspace, targetFolderId, chooseTarget) : undefined}
          onCreate={onCreatePlansFromAssets ? () => createFromAssets(assetSelection.assets, targetFolderId) : undefined}
          onUnassign={onUnassignMany ? (assets) => {
            onUnassignMany(assets);
            assetSelection.clear();
          } : undefined}
        />
      ) : null}
      {folderMove ? <FolderMoveModal folder={folderMove.folders[0]!} folders={folderMove.folders} workspace={workspace} initialParentId={folderMove.destination} onDismiss={() => setFolderMove(undefined)} /> : null}
      {moveSelectedIds ? <MovePlansModal planIds={moveSelectedIds} plans={plans} workspace={workspace} initialFolderId={targetFolderId} canMove={Boolean(onMovePlans)} onDismiss={() => setMoveSelectedIds(undefined)} onConfirm={(selected, folderId) => { movePlans(selected, folderId); setMoveSelectedIds(undefined); }} /> : null}
    </Box>
  );
}
