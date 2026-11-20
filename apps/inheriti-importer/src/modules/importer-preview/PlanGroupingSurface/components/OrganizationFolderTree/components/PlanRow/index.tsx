import { useLayoutEffect, useRef } from 'react';
import { Box, Checkbox, IconAction, Text } from '@main-components';
import { TREE_ICON_NAMES } from '@/assets/file-type-icons/catalog';
import { planCapacity, planUsage } from '../../../../capacity';
import type { GroupingAsset, PlanDraft } from '../../../../types';
import { PlanNameEditor } from '../PlanNameEditor';
import { PlanAvatar } from '../PlanAvatar';
import { PlanAssetTreeRow } from '../PlanAssetTreeRow';
import { PlanActionsMenu } from '../PlanActionsMenu';
import './styles.css';
import '../PlanAssetTreeRow/styles.css';

export function PlanRow({ plan, depth, active, dropValid, selected, open, revealSequence, onRevealComplete, onRename, dragAssets, onSelect, onToggle, onToggleSelection, onDragStart, onEdit, onDelete, onAssign, onAssignMany, onDropEnd, onDropValidity, renderAsset }: {
  plan: PlanDraft; depth: number; active: boolean; dropValid: boolean; selected: boolean; open: boolean;
  revealSequence?: number;
  onRevealComplete: () => void;
  onRename?: (name?: string) => void;
  dragAssets: GroupingAsset[]; onSelect?: (plan: PlanDraft) => void;
  onToggle: () => void; onToggleSelection: (event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; toggle?: boolean }) => void;
  onDragStart: (event: DragEvent) => void; onEdit?: (plan: PlanDraft) => void; onDelete?: (plan: PlanDraft) => void;
  onAssign?: (asset: GroupingAsset, plan: PlanDraft) => void;
  onAssignMany?: (assets: GroupingAsset[], plan: PlanDraft) => void;
  onDropEnd: (id?: string) => void;
  onDropValidity: (valid: boolean) => void;
  renderAsset?: (asset: GroupingAsset, depth: number) => React.ReactNode;
}) {
  const element = useRef<HTMLElement | null>(null);
  const handledReveal = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    const row = element.current;
    if (!row || revealSequence === undefined || handledReveal.current === revealSequence) return;
    handledReveal.current = revealSequence;
    onRevealComplete();
    if (!onRename) row.focus({ preventScroll: true });

    const pane = row.closest<HTMLElement>('.organization-folder-scroll');
    if (!pane) return;
    const bounds = pane.getBoundingClientRect();
    const target = row.getBoundingClientRect();
    if (target.top < bounds.top) pane.scrollTop += target.top - bounds.top;
    else if (target.bottom > bounds.bottom) pane.scrollTop += target.bottom - bounds.bottom;
  }, [revealSequence, onRename, onRevealComplete]);
  const restoreFocus = useRef(false);
  useLayoutEffect(() => {
    if (onRename || !restoreFocus.current) return;
    restoreFocus.current = false;
    element.current?.focus({ preventScroll: true });
  }, [onRename]);
  const hasAssets = Boolean(plan.assignedAssets?.length);
  const additions = dragAssets.filter((asset) => !plan.assignedAssets?.some((assigned) => assigned.id === asset.id));
  const canDrop = (event: DragEvent) => !event.dataTransfer?.types?.includes('text/folder-ids') && !event.dataTransfer?.types?.includes('text/plan-id') &&
    additions.length > 0 && additions.every((asset) => asset.valid !== false) && planUsage(plan) + additions.length <= planCapacity(plan) &&
    Boolean(onAssignMany || (additions.length === 1 && onAssign));
  const handleDragOver = (event: DragEvent) => {
    event.stopPropagation();
    const valid = canDrop(event);
    onDropEnd(plan.id); onDropValidity(valid);
    if (valid) event.preventDefault();
    else if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  };
  const handleDrop = (event: DragEvent) => {
        event.preventDefault(); event.stopPropagation();
        if (canDrop(event)) {
          if (onAssignMany) onAssignMany(additions, plan);
          else if (additions.length === 1) onAssign?.(additions[0]!, plan);
          if (!open) onToggle();
        }
        onDropEnd();
      };

  return <Box>
    <Box ref={element} dataSet={{ planRowId: plan.id }} className={`folder-tree-row folder-plan-row ${active ? dropValid ? 'over-valid' : 'over-invalid' : ''} ${selected ? 'is-selected' : ''}`}
      flexDirection="row" alignItems="center" gap="xs" style={{ paddingLeft: depth * 28 + 16 }}
      draggable={!onRename} onDragStart={onRename ? undefined : onDragStart}
      onClick={(event: MouseEvent) => {
        if ((event.target as HTMLElement).closest('button, input, [role="button"]')) return;
        if (event.ctrlKey || event.metaKey || event.shiftKey) onToggleSelection(event);
        else onToggle();
      }}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
        event.preventDefault();
        if (event.ctrlKey || event.metaKey || event.shiftKey) onToggleSelection(event);
        else onToggle();
      }}
      role="treeitem" tabIndex={0} aria-expanded={open} aria-selected={selected}
      onDragOver={handleDragOver}
      onDragLeave={() => onDropEnd()}
      onDrop={handleDrop}>
      <Checkbox aria-label={`Select ${plan.name}`} checked={selected} readOnly onClick={(event) => onToggleSelection({ shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, toggle: true })} />
      <IconAction name={open ? TREE_ICON_NAMES.collapse : TREE_ICON_NAMES.expand} label={open ? `Collapse ${plan.name}` : `Expand ${plan.name}`} onPress={onToggle} />
      <PlanAvatar id={plan.id} />
      {onRename ? <PlanNameEditor initialName={plan.name} onFinish={(name, reason) => {
        restoreFocus.current = reason === 'keyboard';
        onRename(name);
      }} /> : <Box className="folder-plan-name-button" dataSet={{ marqueeRowControl: '' }} role="button" tabIndex={0} onClick={(event: MouseEvent) => { event.stopPropagation(); if (event.ctrlKey || event.metaKey || event.shiftKey) onToggleSelection(event); else onSelect?.(plan); }} onKeyDown={(event: KeyboardEvent) => { if (event.key !== 'Enter' && event.key !== ' ') return; event.preventDefault(); event.stopPropagation(); if (event.ctrlKey || event.metaKey || event.shiftKey) onToggleSelection(event); else onSelect?.(plan); }}>
        <Text className="folder-tree-name" variant="bodySmall" title={plan.name}>{plan.name}</Text>
      </Box>}
      <Box flex={1} />
      <Text className="folder-plan-count" color="gray" variant="bodySmall">{plan.assets} {plan.assets === 1 ? 'asset' : 'assets'}</Text>
      <PlanActionsMenu plan={plan} onOpen={onSelect} onEdit={onEdit} onDelete={onDelete} />
    </Box>
    {open ? <Box className="folder-plan-assets"
      onDragOver={handleDragOver}
      onDragLeave={() => onDropEnd()} onDrop={handleDrop}
    >
      {!hasAssets ? <Box padding="s" style={{ paddingLeft: depth * 28 + 70 }}><Text variant="bodySmall" color="gray50">Drag and drop an asset</Text></Box> : null}
      {(plan.assignedAssets ?? []).map((asset) => renderAsset ? renderAsset(asset, depth) : <PlanAssetTreeRow key={asset.id} asset={asset} depth={depth} />)}
    </Box> : null}
  </Box>;
}
