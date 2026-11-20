import { useRef, useState } from 'react';
import { Box, Button, Text, Tooltip } from '@main-components';
import type { GroupingAsset, PlanDraft } from '../../types';
import { PlanTargetPopover } from './components/PlanTargetPopover';
import { FolderTargetPopover, type FolderTarget } from './components/FolderTargetPopover';
import './styles.css';

export function AssetSelectionToolbar({ assets, plans, onTarget, onClear, onMove, onUnassign, onCreate, createDestination }: {
  assets: GroupingAsset[];
  plans: PlanDraft[];
  targetId: string;
  onTarget: (id: string) => void;
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
        {onCreate ? <Tooltip content={createDestination?.blockedReason}>
          <Button title="New plan" size="sm" minHeight={34} variant="outlined" color="gray" onPress={onCreate} disabled={Boolean(createDestination?.blockedReason) || assets.some((asset) => asset.valid === false)} />
        </Tooltip> : null}
        <button ref={anchor} type="button" className="asset-selection-assign" disabled={!onMove || !plans.length} aria-expanded={open} onClick={() => setOpen((value) => !value)}>Assign to plan</button>
        <Box className="asset-selection-clear"><Button title="Clear" size="sm" minHeight={34} variant="plain" onPress={onClear} /></Box>
        {onUnassign ? <Button title="Unassign selected" size="sm" minHeight={34} variant="plain" onPress={() => onUnassign(assets)} /> : null}
      </Box>
    </Box>
    {open && anchor.current ? <PlanTargetPopover anchor={anchor.current} assets={assets} plans={plans} onDismiss={() => setOpen(false)} onChoose={(plan) => {
      const additions = assets.filter((asset) => !plan.assignedAssets?.some((assigned) => assigned.id === asset.id));
      onTarget(plan.id);
      onMove?.(additions, plan);
      setOpen(false);
    }} /> : null}
  </Box>;
}
