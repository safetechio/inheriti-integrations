import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, FormSearchableSelect, Icon, Text, theme } from '@main-components';

export type FolderTarget = {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  blockedReason?: string;
};

export function FolderTargetPopover({ target }: { target: FolderTarget }) {
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLElement>(null);
  const [placement, setPlacement] = useState<ReturnType<typeof getPlacement>>();

  const open = Boolean(placement);
  const close = () => {
    setPlacement(undefined);
    anchor.current?.focus({ preventScroll: true });
  };
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      const node = event.target as Node;
      if (!popup.current?.contains(node) && !anchor.current?.contains(node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const active = document.activeElement;
      const inside = popup.current?.contains(active);
      if (event.key === 'Tab' && inside) close();
      if (event.key !== 'Escape' || (!inside && active !== anchor.current)) return;
      event.stopPropagation();
      event.preventDefault();
      close();
    };
    const reposition = () => {
      if (anchor.current) setPlacement(getPlacement(anchor.current));
    };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  return (
    <Box className="asset-selection-destination-row" flexDirection="row" alignItems="center" gap="xs">
      <Text variant="xSmall" bold>Create in:</Text>
      <button
        type="button"
        ref={anchor}
        title={target.label}
        className="asset-selection-destination"
        aria-label={`Create in: ${target.label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={placement ? id : undefined}
        onClick={(event) => setPlacement(placement ? undefined : getPlacement(event.currentTarget))}
      >
        <Text className="asset-selection-destination-label" variant="xSmall" color="gray">{target.label}</Text>
        <Box aria-hidden={true}><Icon name="chevron-right" size={9} color={theme.colors.gray} /></Box>
      </button>
      {placement ? createPortal(
        <Box
          ref={popup}
          nativeID={id}
          role="dialog"
          aria-label="Choose a folder"
          className="asset-selection-popover asset-selection-folder-popover"
          style={placement}
        >
          <FormSearchableSelect
            autoFocus
            label="Choose a folder"
            options={target.options}
            value={target.value}
            onChange={(value) => {
              target.onChange(value);
              close();
            }}
          />
        </Box>,
        document.body,
      ) : null}
    </Box>
  );
}

function getPlacement(anchor: HTMLElement) {
  const rect = anchor.getBoundingClientRect();
  const above = rect.top - 16;
  const below = window.innerHeight - rect.bottom - 16;
  const opensBelow = below > above;
  const width = Math.max(0, Math.min(320, window.innerWidth - 16));
  return {
    position: 'fixed' as const,
    left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
    width,
    ...(opensBelow ? { top: rect.bottom + 8 } : { bottom: window.innerHeight - rect.top + 8 }),
    maxHeight: Math.max(0, Math.min(360, opensBelow ? below : above)),
    zIndex: 10001,
  };
}
