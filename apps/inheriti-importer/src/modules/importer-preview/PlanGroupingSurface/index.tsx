import { useState } from 'react';
import { BaseModal, Box, Button, Checkbox, Icon, PanelHeader, Stack, Text, Tooltip, theme } from '@main-components';
import { UnassignedAssets } from './components/UnassignedAssets';
import { PlanDraftList } from './components/PlanDraftList';
import { usePlanGrouping } from './hooks/use-plan-grouping';
import { PlanMetadataModal, type PlanMetadataValues } from './components/PlanMetadataModal';
import { BulkSelectionBar } from './components/BulkSelectionBar';
import { AssetSelectionToolbar, folderTarget } from './components/AssetSelectionToolbar';
import { OrganizationFolderTree } from './components/OrganizationFolderTree';
import { PlanAssetsModal } from './components/PlanAssetsModal';
import { PlanAvatar } from './components/OrganizationFolderTree/components/PlanAvatar';
import { useAssetSelection } from './hooks/use-asset-selection';
import { canCreatePlanAtDestination } from '@modules/organization/domain/plan-folder';
import type { FolderWorkspaceProps, PlanGroupingSurfaceProps, PlanRevealRequest } from './types';
import './styles.css';

export type {
  GroupingAsset,
  PlanDraft,
  PlanGroupingSurfaceProps,
  PlanMetadataValues,
  Folder,
  FolderWorkspaceProps,
} from './types';

export function PlanGroupingSurface({
  unassigned,
  plans,
  selectedPlanId,
  onAssign,
  onSelectPlan,
  onCreatePlan,
  onDeletePlan,
  onDeletePlans,
  onUpdatePlan,
  onMovePlans,
  onUnassign,
  onAssignMany,
  onUnassignMany,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onAutoGroup,
  folders,
  onCreatePlansFromAssets,
}: PlanGroupingSurfaceProps) {
  const grouping = usePlanGrouping();
  const selection = useAssetSelection(unassigned, plans);
  const [targetId, setTargetId] = useState('');
  const [preserveStructure, setPreserveStructure] = useState(true);
  const undoHint = `Undo the last change to draft plans or asset assignments. Organisation folder changes cannot be undone here.${canUndo && onUndo ? '' : ' No draft changes to undo.'}`;
  const redoHint = `Reapply the last draft change you undid.${canRedo && onRedo ? '' : ' No draft changes to redo.'}`;
  const groupHint = unassigned.some((asset) => asset.valid !== false)
    ? `Create draft plans from all eligible unassigned assets, grouped by ${preserveStructure ? 'source and source folder' : 'source'}.${folders ? ' New plans are created at the organisation root.' : ''}`
    : 'There are no eligible unassigned assets to group.';
  const [destination, setDestination] = useState<{ id: string; scope: FolderWorkspaceProps['scope'] }>();
  const targetFolderId = destination && folders && destination.scope === folders.scope &&
    folders.folders.some((folder) => folder.id === destination.id && folder.scope === folders.scope)
    ? destination.id : null;
  if (destination && !targetFolderId) setDestination(undefined);
  const chooseDestination = (id: string | null) => {
    setDestination(id && folders ? { id, scope: folders.scope } : undefined);
  };
  const [revealRequest, setRevealRequest] = useState<PlanRevealRequest>();
  const revealPlan = (id: string, rename = false) => {
    setRevealRequest((previous) => ({ id, rename, sequence: (previous?.sequence ?? 0) + 1 }));
  };
  const createPlansFromAssets: PlanGroupingSurfaceProps['onCreatePlansFromAssets'] =
    onCreatePlansFromAssets && ((assets, options) => {
      const result = onCreatePlansFromAssets(assets, options);
      if (result?.[0]) {
        revealPlan(result[0], true);
        selection.clear();
        selection.endDrag();
        grouping.endDrag();
      }
      return result;
    });
  const assignMany: PlanGroupingSurfaceProps['onAssignMany'] =
    onAssignMany && ((assets, plan) => {
      onAssignMany(assets, plan);
      revealPlan(plan.id);
      selection.clear();
      selection.endDrag();
      grouping.endDrag();
    });
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? plans[0];
  const [editingPlanId, setEditingPlanId] = useState<string>();
  const [detailsPlanId, setDetailsPlanId] = useState<string>();
  const [deletingPlanId, setDeletingPlanId] = useState<string>();
  const [deletingPlanIds, setDeletingPlanIds] = useState<string[]>([]);
  const editingPlan = plans.find((plan) => plan.id === editingPlanId);
  const deletingPlan = plans.find((plan) => plan.id === deletingPlanId);
  const deletingPlans = deletingPlanIds.map((id) => plans.find((plan) => plan.id === id));
  const deletingAssetCount = deletingPlans.reduce((sum, plan) => sum + (plan?.assignedAssets?.length ?? 0), 0);
  const canDeleteSelected = deletingPlanIds.length > 0 && deletingPlans.every(Boolean);
  const detailsPlan = plans.find((plan) => plan.id === detailsPlanId);
  const selectedUnassigned = unassigned.filter((asset) => selection.selectedIdSet.has(asset.id));
  const selectedAssigned = plans
    .flatMap((plan) => plan.assignedAssets ?? [])
    .filter((asset) => selection.selectedIdSet.has(asset.id));
  const allAssets = new Map(
    [...unassigned, ...plans.flatMap((plan) => plan.assignedAssets ?? [])].map((asset) => [
      asset.id,
      asset,
    ]),
  );
  const dragIds = selection.dragIds.length
    ? selection.dragIds
    : grouping.draggedId
      ? [grouping.draggedId]
      : [];
  const dragAssets = dragIds.every((id) => allAssets.has(id))
    ? [...new Set(dragIds)].map((id) => allAssets.get(id)!)
    : [];
  return (
    <Stack
      gap="l"
      className={`plan-grouping-surface ${folders ? 'has-folder-workspace' : ''}`}
      onKeyDown={(event: KeyboardEvent) => {
        const target = event.target as HTMLElement;
        if (
          target.closest(
            'textarea, select, [contenteditable="true"], [role="dialog"], input:not([type="checkbox"])',
          ) ||
          event.isComposing ||
          event.repeat ||
          event.altKey
        )
          return;
        if (event.key === 'Escape') {
          selection.clear();
          selection.endDrag();
          grouping.endDrag();
        }
        if (
          event.key.toLowerCase() === 'a' &&
          (event.ctrlKey || event.metaKey) &&
          !event.shiftKey &&
          selection.pane && selection.pane !== 'organization'
        ) {
          const rows =
            selection.pane === 'unassigned'
              ? [...unassigned, ...plans.flatMap((plan) => plan.assignedAssets ?? [])].filter(
                  (asset) => selection.visibleUnassignedIds.includes(asset.id),
                )
              : (plans.find((plan) => plan.id === selection.pane)?.assignedAssets ?? []);
          event.preventDefault();
          selection.selectAll(rows, selection.pane);
        }
        if (
          (event.ctrlKey || event.metaKey) &&
          (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')
        ) {
          const redo = event.key.toLowerCase() === 'y' || event.shiftKey;
          if (redo && canRedo && onRedo) {
            event.preventDefault();
            onRedo();
          } else if (!redo && canUndo && onUndo) {
            event.preventDefault();
            onUndo();
          }
        }
      }}
    >
      <Box
        className="plan-grouping-columns"
        flexDirection="row"
        gap="l"
        style={{ flexWrap: 'wrap' }}
      >
        <UnassignedAssets
          assets={unassigned}
          assigned={folders ? plans.flatMap((plan) => plan.assignedAssets ?? []) : undefined}
          selectedPlan={selectedPlan}
          grouping={grouping}
          onAssign={onAssign}
          selection={onAssignMany ? selection : undefined}
          folderMode={Boolean(folders)}
          footer={
            folders && selection.pane !== 'organization' &&
            (selectedUnassigned.length || selectedAssigned.length) &&
            (onAssignMany || onUnassignMany) ? (
              <AssetSelectionToolbar
                assets={selection.assets}
                plans={plans}
                onTarget={setTargetId}
                onClear={selection.clear}
                onMove={assignMany}
                createDestination={createPlansFromAssets
                  ? folderTarget(folders, targetFolderId, chooseDestination)
                  : undefined}
                onUnassign={
                  selectedAssigned.length && onUnassignMany
                    ? () => {
                        onUnassignMany(selectedAssigned);
                        selection.clear();
                      }
                    : undefined
                }
                onCreate={
                  selection.assets.length && createPlansFromAssets
                    ? () => {
                        if (
                          !canCreatePlanAtDestination(
                            targetFolderId,
                            folders.scope,
                            folders.folders,
                          )
                        )
                          return;
                        const chosen = selection.assets;
                        const first = chosen[0]!;
                        const sameFolder = chosen.every(
                          (asset) =>
                            asset.sourceId === first.sourceId &&
                            JSON.stringify(asset.folderPath ?? []) ===
                              JSON.stringify(first.folderPath ?? []),
                        );
                        const name =
                          sameFolder && first.folderPath?.length
                            ? first.folderPath[first.folderPath.length - 1]!
                            : chosen.length === 1
                              ? first.name
                              : `${chosen.length} imported assets`;
                        createPlansFromAssets(chosen, {
                          name,
                          folderId: targetFolderId,
                          scope: folders.scope,
                        });
                      }
                    : undefined
                }
              />
            ) : undefined
          }
        />
        <Stack gap="m" className="plan-draft-column" style={{ flex: '1 1 440px', minWidth: 0 }}>
          {!folders ? (
            <PanelHeader
              title="Draft plans"
              actions={
                <Box flexDirection="row" gap="s" alignItems="center" style={{ flexWrap: 'wrap' }}>
                  {onUndo || onRedo ? (
                    <>
                      <Tooltip content={undoHint}><Button
                        title="Undo"
                        size="sm"
                        variant="plain"
                        disabled={!canUndo || !onUndo}
                        onPress={() => onUndo?.()}
                      /></Tooltip>
                      <Tooltip content={redoHint}><Button
                        title="Redo"
                        size="sm"
                        variant="plain"
                        disabled={!canRedo || !onRedo}
                        onPress={() => onRedo?.()}
                      /></Tooltip>
                    </>
                  ) : null}
                  <Button
                    title="New plan"
                    startIcon={<Icon name="plus" size={12} color={theme.colors.gray} />}
                    variant="outlined"
                    color="gray"
                    disabled={!onCreatePlan}
                    onPress={() => onCreatePlan?.()}
                  />
                </Box>
              }
            />
          ) : null}
          {onAutoGroup && !folders ? (
            <Box flexDirection="row" gap="s" alignItems="center" style={{ flexWrap: 'wrap' }}>
              <Tooltip content={groupHint}><Button
                title={`Group unassigned assets (${unassigned.filter((asset) => asset.valid !== false).length})`}
                size="sm"
                variant="outlined"
                disabled={!unassigned.some((asset) => asset.valid !== false)}
                onPress={() => onAutoGroup(preserveStructure)}
              /></Tooltip>
              <label className="plan-auto-group-option">
                <Checkbox
                  checked={preserveStructure}
                  onChange={(event) => setPreserveStructure(event.target.checked)}
                />{' '}
                Group by source folders
              </label>
            </Box>
          ) : null}
          {!folders && (onAssignMany || onUnassignMany) ? (
            <BulkSelectionBar
              assets={selectedUnassigned.length ? selectedUnassigned : selectedAssigned}
              plans={plans}
              targetId={targetId}
              onTarget={setTargetId}
              onClear={selection.clear}
              onMove={
                onAssignMany
                  ? (assets, plan) => {
                      onAssignMany(assets, plan);
                      selection.clear();
                    }
                  : undefined
              }
              onUnassign={
                selectedAssigned.length && onUnassignMany
                  ? (assets) => {
                      onUnassignMany(assets);
                      selection.clear();
                    }
                  : undefined
              }
            />
          ) : null}
          {folders ? (
            <OrganizationFolderTree
              workspace={folders}
              plans={plans}
              dragAssets={dragAssets}
              assetSelection={onAssignMany || onUnassignMany ? selection : undefined}
              onAssetDragStart={(asset) => { selection.startDrag(asset.id, selection.pane === 'organization' ? undefined : [asset.id]); grouping.startDrag(asset.id); }}
              onAssetDragEnd={() => { selection.endDrag(); grouping.endDrag(); }}
              onUnassignMany={onUnassignMany}
              onCreatePlan={onCreatePlan && ((options) => {
                const id = onCreatePlan(options);
                if (id) revealPlan(id, true);
                return id;
              })}
              onCreatePlansFromAssets={createPlansFromAssets}
              revealRequest={revealRequest}
              onRenamePlan={onUpdatePlan && ((plan, name) =>
                onUpdatePlan(plan, { name, description: plan.description ?? '' }))}
              targetFolderId={targetFolderId}
              onTargetFolderChange={chooseDestination}
              toolbar={
                onUndo || onRedo || onAutoGroup ? (
                  <Box flexDirection="row" gap="s" alignItems="center">
                    {onUndo ? (
                      <Tooltip content={undoHint}><Button
                        title="Undo"
                        size="sm"
                        variant="plain"
                        disabled={!canUndo}
                        onPress={() => onUndo()}
                      /></Tooltip>
                    ) : null}
                    {onRedo ? (
                      <Tooltip content={redoHint}><Button
                        title="Redo"
                        size="sm"
                        variant="plain"
                        disabled={!canRedo}
                        onPress={() => onRedo()}
                      /></Tooltip>
                    ) : null}
                    {onAutoGroup ? (
                      <Tooltip content={groupHint}><Button
                        title={`Group unassigned assets (${unassigned.filter((asset) => asset.valid !== false).length})`}
                        size="sm"
                        variant="outlined"
                        disabled={!unassigned.some((asset) => asset.valid !== false)}
                        onPress={() => {
                          const id = onAutoGroup(preserveStructure);
                          if (id) revealPlan(id);
                        }}
                      /></Tooltip>
                    ) : null}
                  </Box>
                ) : undefined
              }
              onAssign={onAssign ? (asset, plan) => {
                onAssign(asset, plan);
                revealPlan(plan.id);
                selection.clear();
                selection.endDrag();
                grouping.endDrag();
              } : undefined}
              onAssignMany={assignMany}
              onMovePlans={onMovePlans}
              onSelectPlan={(plan) => {
                setDetailsPlanId(plan.id);
                onSelectPlan?.(plan);
              }}
              onEditPlan={onUpdatePlan ? (plan) => setDetailsPlanId(plan.id) : undefined}
              onDeletePlan={onDeletePlan ? (plan) => setDeletingPlanId(plan.id) : undefined}
              onDeletePlans={onDeletePlans ? (selected) => setDeletingPlanIds(selected.map((plan) => plan.id)) : undefined}
              onMovePlan={
                onUpdatePlan
                  ? (plan, folderId, scope) => {
                      if (
                        scope !== (plan.sharingModel === 'PRIVATE' ? 'PERSONAL' : 'SHARED') ||
                        !canCreatePlanAtDestination(folderId, scope, folders.folders)
                      )
                        return;
                      onUpdatePlan(plan, {
                        name: plan.name,
                        description: plan.description ?? '',
                        folderId,
                        scope,
                      });
                    }
                  : undefined
              }
            />
          ) : (
            <PlanDraftList
              plans={plans}
              selectedPlan={selectedPlan}
              unassigned={unassigned}
              grouping={grouping}
              onAssign={onAssign}
              onAssignMany={onAssignMany}
              selection={onAssignMany || onUnassignMany ? selection : undefined}
              onEditPlan={onUpdatePlan ? (plan) => setEditingPlanId(plan.id) : undefined}
              onDeletePlan={
                onDeletePlan
                  ? (plan) => {
                      if (plans.length === 1 || plan.assignedAssets?.length) setDeletingPlanId(plan.id);
                      else onDeletePlan(plan);
                    }
                  : undefined
              }
              onSelectPlan={onSelectPlan}
              onUnassign={onUnassign}
            />
          )}
        </Stack>
      </Box>
      {folders ? <PlanAssetsModal
        plan={detailsPlan}
        folders={folders.folders}
        onDismiss={() => setDetailsPlanId(undefined)}
        onSave={onUpdatePlan}
        onRemove={onUnassign}
        onDelete={onDeletePlan ? (plan) => {
          setDetailsPlanId(undefined);
          setDeletingPlanId(plan.id);
        } : undefined}
      /> : null}
      <PlanMetadataModal
        plan={editingPlan}
        visible={Boolean(editingPlan)}
        onDismiss={() => setEditingPlanId(undefined)}
        onSave={(values: PlanMetadataValues) => {
          if (!editingPlan) return;
          onUpdatePlan?.(editingPlan, values);
          setEditingPlanId(undefined);
        }}
      />
      <BaseModal
        visible={Boolean(deletingPlan)}
        title="Delete plan?"
        titleIcon={<Icon name="trash" size={20} color="danger" />}
        onDismiss={() => setDeletingPlanId(undefined)}
        footer={
          <>
            <Button title="Cancel" variant="outlined" color="gray" onPress={() => setDeletingPlanId(undefined)} />
            <Button
              title="Delete plan"
              disabled={!deletingPlan}
              color="danger"
              onPress={() => {
                if (deletingPlan) onDeletePlan?.(deletingPlan);
                setDeletingPlanId(undefined);
              }}
            />
          </>
        }
      >
        {deletingPlan ? <Box gap="m">
          <Box flexDirection="row" alignItems="center" gap="s" padding="m" backgroundColor="gray5" borderColor="gray10" borderWidth={1} borderRadius="s">
            <PlanAvatar id={deletingPlan.id} />
            <Text variant="bodyRegular" semibold>{deletingPlan.name}</Text>
          </Box>
          <Text variant="bodySmall" color="gray">{deletingPlan.assignedAssets?.length
            ? `The ${deletingPlan.assignedAssets.length} ${deletingPlan.assignedAssets.length === 1 ? 'asset' : 'assets'} in this plan will return to Unassigned.`
            : 'This empty plan will be deleted.'}</Text>
        </Box> : null}
      </BaseModal>
      <BaseModal
        visible={deletingPlanIds.length > 0}
        title={deletingPlanIds.length === 1 ? 'Delete plan?' : 'Delete plans?'}
        titleIcon={<Icon name="trash" size={20} color="danger" />}
        onDismiss={() => setDeletingPlanIds([])}
        footer={<>
          <Button title="Cancel" variant="outlined" color="gray" onPress={() => setDeletingPlanIds([])} />
          <Button title={deletingPlanIds.length === 1 ? 'Delete plan' : 'Delete selected'} color="danger" disabled={!canDeleteSelected} onPress={() => {
            if (canDeleteSelected) {
              const selected = deletingPlans as NonNullable<typeof deletingPlans[number]>[];
              if (selected.length === 1 && onDeletePlan) onDeletePlan(selected[0]);
              else onDeletePlans?.(selected);
            }
            setDeletingPlanIds([]);
          }} />
        </>}
      >
        <Box gap="m">
          {deletingPlans.filter((plan) => plan !== undefined).map((plan) => <Box key={plan.id} flexDirection="row" alignItems="center" gap="s" padding="m" backgroundColor="gray5" borderColor="gray10" borderWidth={1} borderRadius="s"><PlanAvatar id={plan.id} /><Text variant="bodyRegular" semibold>{plan.name}</Text></Box>)}
          <Text variant="bodySmall" color="gray">{deletingPlanIds.length} {deletingPlanIds.length === 1 ? 'plan' : 'plans'} will be deleted. {deletingAssetCount} {deletingAssetCount === 1 ? 'asset' : 'assets'} will return to Unassigned.</Text>
        </Box>
      </BaseModal>
    </Stack>
  );
}

export default PlanGroupingSurface;
