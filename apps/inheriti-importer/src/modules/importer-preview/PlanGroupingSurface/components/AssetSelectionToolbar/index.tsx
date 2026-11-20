import { useRef, useState } from 'react';
import { Box, Button, Text, Tooltip } from '@main-components';
import { canCreatePlanAtDestination } from '@modules/organization/domain/plan-folder';
import { folderPathLabel } from '../../hooks/folder-path';
import type { FolderWorkspaceProps, GroupingAsset, PlanDraft } from '../../types';
import { PlanTargetPopover } from './components/PlanTargetPopover';
import { FolderTargetPopover, type FolderTarget } from './components/FolderTargetPopover';
import './styles.css';

export function folderTarget(
  { folders, scope }: FolderWorkspaceProps,
  folderId: string | null,
  chooseFolder: (folderId: string | null) => void,
): FolderTarget {
  return {
    label: folderPathLabel(folders, folderId, scope),
    value: folderId ?? '',
    options: [
      { value: '', label: 'Your organisation' },
      ...folders.filter((folder) => folder.scope === scope).map((folder) => ({
        value: folder.id,
        label: folderPathLabel(folders, folder.id, scope),
      })),
    ],
    onChange: (value) => chooseFolder(value || null),
    blockedReason: canCreatePlanAtDestination(folderId, scope, folders)
      ? undefined : 'Set folder permissions before creating plans here.',
  };
}

export function AssetSelectionToolbar({ assets, plans, onTarget, onClear, onMove, onUnassign, onCreate, createDestination, moveLabel = 'Assign to plan' }: {
  assets: GroupingAsset[];
  plans: PlanDraft[];
  onTarget?: (id: string) => void;
  moveLabel?: string;
  onClear: () => void;
  onMove?: (assets: GroupingAsset[], plan: PlanDraft) => void;
  onUnassign?: (assets: GroupingAsset[]) => void;
  onCreate?: () => void;
  createDestination?: FolderTarget;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  if (!assets.length) return null;
  return <Box className="asset-selection-toolbar">
    <Box className="asset-selection-toolbar-content" flexDirection="row" justifyContent="space-between" alignItems="center" gap="m">
      <Box className="asset-selection-summary" gap="xxs">
        <Text variant="bodySmall" semibold>{assets.length.toLocaleString()} selected</Text>
        {createDestination ? <FolderTargetPopover target={createDestination} /> : null}
        <Text className="asset-selection-hint" variant="xSmall" color="gray">Shift+click to extend · Esc to clear</Text>
      </Box>
      <Box className="asset-selection-actions" flexDirection="row" alignItems="center" gap="s">
        {onCreate ? <Tooltip content={createDestination?.blockedReason ?? 'Create plans from the selected assets in the chosen folder. Large selections are split across plans.'}>
          <Button title="New plan" size="sm" minHeight={34} variant="outlined" color="gray" onPress={onCreate} disabled={Boolean(createDestination?.blockedReason) || assets.some((asset) => asset.valid === false)} />
        </Tooltip> : null}
        <Tooltip content="Search for an existing plan and move the selected assets there.">
          <button ref={anchor} type="button" className="asset-selection-assign" disabled={!onMove || !plans.length} aria-expanded={open} onClick={() => setOpen((value) => !value)}>{moveLabel}</button>
        </Tooltip>
        <Box className="asset-selection-clear">
          <Tooltip content="Deselect all assets. Plan assignments are kept.">
            <Button title="Clear" size="sm" minHeight={34} variant="plain" onPress={onClear} />
          </Tooltip>
        </Box>
        {onUnassign ? <Tooltip content="Return selected assets to Unassigned and keep them in the import.">
          <Button title="Unassign selected" size="sm" minHeight={34} variant="plain" onPress={() => onUnassign(assets)} />
        </Tooltip> : null}
      </Box>
    </Box>
    {open && anchor.current ? <PlanTargetPopover anchor={anchor.current} assets={assets} plans={plans} onDismiss={() => setOpen(false)} onChoose={(plan) => {
      const additions = assets.filter((asset) => !plan.assignedAssets?.some((assigned) => assigned.id === asset.id));
      onTarget?.(plan.id);
      onMove?.(additions, plan);
      setOpen(false);
    }} /> : null}
  </Box>;
}
