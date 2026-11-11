import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Box } from '@main-components';

type Position = { left: number; top: number; width: number; maxHeight: number };

export function KeePassUnlockPopover({
  triggerRef,
  busy,
  onDismiss,
  children,
}: {
  triggerRef: RefObject<HTMLElement | null>;
  busy: boolean;
  onDismiss: (restoreFocus: boolean) => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  const focusedOnce = useRef(false);
  const busyRef = useRef(busy);
  const dismissRef = useRef(onDismiss);
  const triggerVisible = useRef(true);
  busyRef.current = busy;
  dismissRef.current = onDismiss;
  const [position, setPosition] = useState<Position | null>(null);

  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger || !panelRef.current) return;
    const panel = panelRef.current;
    const update = () => {
      const anchor = trigger.getBoundingClientRect();
      if (
        !triggerVisible.current ||
        ((anchor.width > 0 || anchor.height > 0) &&
          (anchor.bottom <= 0 ||
            anchor.top >= window.innerHeight ||
            anchor.right <= 0 ||
            anchor.left >= window.innerWidth))
      ) {
        if (busyRef.current) setPosition(null);
        else dismissRef.current(false);
        return;
      }
      const width = Math.min(400, Math.max(0, window.innerWidth - 32));
      const height = panel.scrollHeight;
      const below = Math.max(0, window.innerHeight - anchor.bottom - 24);
      const above = Math.max(0, anchor.top - 24);
      const placeAbove = height > below && above > below;
      const maxHeight = Math.min(window.innerHeight - 32, placeAbove ? above : below);
      setPosition({
        width,
        left: Math.max(16, Math.min(anchor.right - width, window.innerWidth - width - 16)),
        top: placeAbove
          ? Math.max(16, anchor.top - Math.min(height, maxHeight) - 8)
          : Math.max(16, Math.min(anchor.bottom + 8, window.innerHeight - 16 - maxHeight)),
        maxHeight,
      });
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(panel);
    const intersectionObserver =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([entry]) => {
            triggerVisible.current = entry.isIntersecting;
            update();
          });
    intersectionObserver?.observe(trigger);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer?.disconnect();
      intersectionObserver?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [triggerRef]);

  useLayoutEffect(() => {
    if (position && !focusedOnce.current) {
      panelRef.current
        ?.querySelector<HTMLInputElement>('input[aria-label="Master password"]')
        ?.focus();
      focusedOnce.current = true;
    }
  }, [position]);

  useEffect(() => {
    if (busy) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target))
        onDismiss(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onDismiss(true);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [busy, onDismiss, triggerRef]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <Box
      ref={(element) => {
        panelRef.current = element;
      }}
      className="source-unlock-panel"
      position="fixed"
      accessibilityRole="dialog"
      accessibilityLabel="Unlock KeePass database"
      gap="m"
      style={{
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        width: position?.width ?? 400,
        maxHeight: position?.maxHeight ?? 400,
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      {children}
    </Box>,
    document.body,
  );
}
