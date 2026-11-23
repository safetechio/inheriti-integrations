import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export function useAnchoredPopover({ closeOnScroll = false } = {}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();
      if (!trigger || !panel) return;
      setPosition({
        top: Math.max(8, Math.min(trigger.bottom + 6, window.innerHeight - panel.height - 8)),
        left: Math.max(
          8,
          Math.min(trigger.right - panel.width, window.innerWidth - panel.width - 8),
        ),
      });
    };
    place();
    const panel = panelRef.current;
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    if (panel) observer?.observe(panel);
    window.addEventListener('resize', place);
    const onScroll = (event: Event) => {
      if (!closeOnScroll) return place();
      if (event.target instanceof Node && panelRef.current?.contains(event.target)) return;
      if (panelRef.current?.contains(document.activeElement))
        triggerRef.current?.focus({ preventScroll: true });
      setOpen(false);
    };
    window.addEventListener('scroll', onScroll, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, closeOnScroll]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        triggerRef.current?.focus({ preventScroll: true });
        setOpen(false);
      } else if (['a', 'x'].includes(event.key.toLowerCase())) {
        event.stopPropagation();
      }
    };
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', escape, true);
    document.addEventListener('mousedown', outside);
    return () => {
      document.removeEventListener('keydown', escape, true);
      document.removeEventListener('mousedown', outside);
    };
  }, [open]);
  return { open, setOpen, triggerRef, panelRef, position };
}
