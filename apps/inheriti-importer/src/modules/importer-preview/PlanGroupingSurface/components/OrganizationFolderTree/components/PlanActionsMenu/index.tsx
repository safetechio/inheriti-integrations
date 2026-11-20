import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, Icon, IconAction } from '@main-components';
import type { PlanDraft } from '../../../../types';

export function PlanActionsMenu({ plan, onOpen, onEdit, onDelete }: { plan: PlanDraft; onOpen?: (plan: PlanDraft) => void; onEdit?: (plan: PlanDraft) => void; onDelete?: (plan: PlanDraft) => void }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const anchor = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent | MouseEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return;
      } else if (anchor.current?.contains(event.target as Node) || panel.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', close);
    document.addEventListener('mousedown', close);
    return () => { document.removeEventListener('keydown', close); document.removeEventListener('mousedown', close); };
  }, [open]);
  return <Box ref={anchor} className="folder-menu" onMouseDown={(event: MouseEvent) => { const rect = (event.currentTarget as HTMLElement).getBoundingClientRect(); setPosition({ top: rect.bottom + 4, left: Math.max(8, rect.right - 190) }); }}>
    <IconAction name="ellipsis-vertical" label={`Actions for ${plan.name}`} onPress={() => setOpen(!open)} />
    {open ? createPortal(<Box ref={panel} className="folder-menu-popover" style={position} gap="xs">
      <button type="button" aria-label="Open plan" className="folder-menu-item" onClick={() => { setOpen(false); onOpen?.(plan); }}><Icon name="arrow-up-right-from-square" size={14} color="currentColor" />Open plan</button>
      {onEdit ? <button type="button" aria-label="Edit details" className="folder-menu-item" onClick={() => { setOpen(false); onEdit(plan); }}><Icon name="pen" size={14} color="currentColor" />Edit details</button> : null}
      {onDelete ? <><Box className="folder-menu-separator"/><button type="button" aria-label="Delete plan" className="folder-menu-item is-danger" onClick={() => { setOpen(false); onDelete(plan); }}><Icon name="trash" size={14} color="currentColor" />Delete plan</button></> : null}
    </Box>, document.body) : null}
  </Box>;
}
