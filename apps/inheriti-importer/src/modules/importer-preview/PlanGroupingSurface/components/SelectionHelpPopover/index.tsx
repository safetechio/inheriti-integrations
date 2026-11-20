import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, Icon, Text } from '@main-components';
import './styles.css';

type Kind = 'assets' | 'organisation';

const help: Record<Kind, { title: string; groups: { heading: string; detail: string }[] }> = {
  assets: {
    title: 'Asset controls',
    groups: [
      { heading: 'Select', detail: 'Checkbox or Ctrl/Cmd+click to toggle; Shift+click for a range.' },
      { heading: 'Select an area', detail: 'Ctrl/Cmd+drag to select assets in a rectangle.' },
      { heading: 'Move', detail: 'Drag a selected asset to move the group, or an unselected asset to move only it.' },
      { heading: 'Clear', detail: 'Escape clears the selection.' },
    ],
  },
  organisation: {
    title: 'Organisation controls',
    groups: [
      { heading: 'Select', detail: 'Checkbox or Ctrl/Cmd+click to toggle; Shift+click for a range.' },
      { heading: 'Select an area', detail: 'Ctrl/Cmd+drag from a plan selects plans; from an asset selects assets.' },
      { heading: 'Move and open', detail: 'Drag selected items as a group. Ctrl/Cmd+click selects folders; drag to move them. Use an asset’s three dots to move or unassign it. Click a plan title to open it, or its blank row to expand it.' },
      { heading: 'Clear', detail: 'Escape clears the selection.' },
    ],
  },
};

export function SelectionHelpPopover({ kind }: { kind: Kind }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const label = kind === 'assets' ? 'Unassigned asset selection help' : 'Organisation tree selection help';

  const cancelClose = () => { if (timer.current) clearTimeout(timer.current); };
  const close = () => { cancelClose(); setOpen(false); setPinned(false); };
  const show = () => {
    cancelClose();
    const rect = button.current?.getBoundingClientRect();
    if (rect) setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)),
      top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - 180)),
    });
    setOpen(true);
  };
  const scheduleClose = () => { if (!pinned) timer.current = setTimeout(() => setOpen(false), 150); };

  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    const height = panel.current.getBoundingClientRect().height;
    setPosition((current) => {
      const top = Math.max(8, Math.min(current.top, window.innerHeight - height - 8));
      return top === current.top ? current : { ...current, top };
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (!button.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  useEffect(() => () => cancelClose(), []);

  return <>
    <button ref={button} type="button" className="selection-help-trigger" aria-label={label} aria-expanded={open}
      onMouseEnter={show} onMouseLeave={scheduleClose}
      onClick={() => { if (pinned) close(); else { show(); setPinned(true); } }}>
      <Icon name="circle-question" type="font-awesome-6" size={15} color="gray" label="" />
    </button>
    {open ? createPortal(<Box ref={panel} className="selection-help-popover" role="tooltip" aria-label={label}
      style={{ position: 'fixed', top: position.top, left: position.left, zIndex: 10002 }}
      onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>
      <Text variant="bodyRegular" semibold>{help[kind].title}</Text>
      {help[kind].groups.map((group, index) => <Box key={group.heading} className="selection-help-group" borderColor="gray10" borderWidth={1} borderRadius="s">
        <Box flexDirection="row" alignItems="center" gap="s">
          <Box className="selection-help-number" borderRadius="s" backgroundColor="gray5"><Text variant="bodySmall" semibold>{index + 1}</Text></Box>
          <Text variant="bodySmall" semibold accessibilityRole="heading">{group.heading}</Text>
        </Box>
        <Text variant="bodySmall">{group.detail}</Text>
      </Box>)}
    </Box>, document.body) : null}
  </>;
}
