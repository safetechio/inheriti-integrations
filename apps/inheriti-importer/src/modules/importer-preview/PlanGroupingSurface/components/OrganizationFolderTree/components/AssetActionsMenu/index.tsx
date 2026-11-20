import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, Icon, IconAction } from '@main-components';
import type { GroupingAsset, PlanDraft } from '../../../../types';
import { PlanTargetPopover } from '../../../AssetSelectionToolbar/components/PlanTargetPopover';

export function AssetActionsMenu({ asset, assets, plans, onMove, onUnassign }: {
  asset: GroupingAsset;
  assets: GroupingAsset[];
  plans: PlanDraft[];
  onMove?: (assets: GroupingAsset[], plan: PlanDraft) => void;
  onUnassign?: (assets: GroupingAsset[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [targetOpen, setTargetOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const anchor = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent | MouseEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
      } else if (anchor.current?.contains(event.target as Node) || panel.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', close);
    document.addEventListener('mousedown', close);
    return () => { document.removeEventListener('keydown', close); document.removeEventListener('mousedown', close); };
  }, [open]);
  return <Box ref={anchor} className="folder-menu" onMouseDown={(event: MouseEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setPosition({ top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 96)), left: Math.max(8, Math.min(rect.right - 190, window.innerWidth - 198)) });
  }}>
    <IconAction name="ellipsis-vertical" label={`Actions for ${asset.name}`} onPress={() => setOpen((value) => !value)} />
    {open ? createPortal(<Box ref={panel} className="folder-menu-popover" style={position}>
      <button aria-label="Move to plan" className="folder-menu-item" disabled={!onMove || !plans.length} onClick={() => { setOpen(false); setTargetOpen(true); }}><Icon name="folder-open" size={14} color="currentColor" />Move to plan</button>
      <button aria-label="Unassign" className="folder-menu-item" disabled={!onUnassign} onClick={() => { setOpen(false); onUnassign?.(assets); }}><Icon name="xmark" size={14} color="currentColor" />Unassign</button>
    </Box>, document.body) : null}
    {targetOpen && anchor.current ? <PlanTargetPopover anchor={anchor.current} assets={assets} plans={plans} onDismiss={() => setTargetOpen(false)} onChoose={(plan) => {
      onMove?.(assets.filter((item) => !plan.assignedAssets?.some((assigned) => assigned.id === item.id)), plan);
      setTargetOpen(false);
    }} /> : null}
  </Box>;
}
