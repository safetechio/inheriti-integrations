import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Box, Text } from '@modules/_shared/ui/components/Primitives';
import './styles.css';

export function Tooltip({ content, children }: { content?: string; children: ReactNode }) {
  const id = useId();
  const anchor = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number; below: boolean }>();
  const hide = () => setPosition(undefined);
  const show = () => {
    if (!anchor.current) return;
    const rect = anchor.current.getBoundingClientRect();
    setPosition({
      top: rect.top >= 72 ? rect.top - 8 : rect.bottom + 8,
      left: Math.max(Math.min(160, window.innerWidth / 2), Math.min(rect.left + rect.width / 2, window.innerWidth - Math.min(160, window.innerWidth / 2))),
      below: rect.top < 72,
    });
  };
  const isEnabledControl = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return false;
    const control = event.target.closest('button, [role="button"], a[href], input');
    return Boolean(control && anchor.current?.contains(control) && !control.matches(':disabled, [aria-disabled="true"]'));
  };
  useEffect(() => {
    if (!position) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
    const onPointerDown = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) hide();
    };
    const trigger = anchor.current;
    const onClick = (event: MouseEvent) => { if (isEnabledControl(event)) hide(); };
    // React Native Web buttons can stop the event before it bubbles to the tooltip.
    trigger?.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      trigger?.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [position]);
  if (!content) return <>{children}</>;
  return <>
    <Box ref={anchor} className="importer-tooltip-anchor" tabIndex={0} aria-describedby={position ? id : undefined}
      onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}
      onClick={(event: MouseEvent) => { event.stopPropagation(); if (!isEnabledControl(event)) show(); }}
      onDoubleClick={(event: MouseEvent) => event.stopPropagation()}>
      {children}
    </Box>
    {position && createPortal(<Box nativeID={id} role="tooltip" className={`importer-tooltip ${position.below ? 'importer-tooltip-below' : ''}`}
      style={{ position: 'fixed', top: position.top, left: position.left }}><Text variant="xSmall" color="gray">{content}</Text></Box>, document.body)}
  </>;
}
