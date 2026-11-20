import { useCallback, useEffect, useRef, useState } from 'react';

type Rectangle = { left: number; top: number; width: number; height: number };
type Options = {
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  resetKey: string;
  rowSelector: string;
  getRowIds: (element: HTMLElement) => string[];
  onStart?: () => void;
  allowFromRow?: boolean;
  startSelector?: string;
  excludeSelector?: string;
};

const controls = 'button, input, select, textarea, a, [role="button"], [role="checkbox"], [contenteditable="true"]';

export function useMarqueeSelection({ selectedIds, onSelect, resetKey, rowSelector, getRowIds, onStart, allowFromRow = true, startSelector, excludeSelector }: Options) {
  const containerRef = useRef<HTMLElement | null>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const setContainerRef = useCallback((node: HTMLElement | null) => {
    containerRef.current = node;
    setContainer(node);
  }, []);
  const [rectangle, setRectangle] = useState<Rectangle | null>(null);
  const active = useRef(false);
  const suppressClick = useRef(false);
  const cleanup = useRef<() => void>(() => {});
  const frame = useRef<number | undefined>(undefined);
  const latest = useRef({ selectedIds, onSelect, getRowIds, onStart, rowSelector, allowFromRow, startSelector, excludeSelector });
  latest.current = { selectedIds, onSelect, getRowIds, onStart, rowSelector, allowFromRow, startSelector, excludeSelector };

  const cancel = useCallback(() => {
    if (active.current) suppressClick.current = true;
    cleanup.current();
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); cancel(); };
  }, [resetKey, cancel]);

  const onPointerDownCapture = (event: globalThis.PointerEvent) => {
    suppressClick.current = false;
    const target = event.target as Element;
    if (latest.current.startSelector && !target.closest(latest.current.startSelector)) return;
    if (latest.current.excludeSelector && target.closest(latest.current.excludeSelector)) return;
    const fromRow = target.closest(latest.current.rowSelector);
    const additive = event.ctrlKey || event.metaKey;
    const canStartFromRow = additive && latest.current.allowFromRow;
    const control = target.closest(controls);
    if (event.pointerType !== 'mouse' || event.button !== 0 ||
      (fromRow && !canStartFromRow) ||
      (control && !(canStartFromRow && fromRow?.contains(control) && control.hasAttribute('data-marquee-row-control'))) ||
      (!additive && target.closest('[draggable="true"]'))) return;
    const container = containerRef.current;
    if (!container || !container.contains(target)) return;
    const start = { x: event.clientX, y: event.clientY };
    const baseline = additive ? latest.current.selectedIds : [];
    let last = start;
    let moved = false;
    const finish = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', cancel);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      frame.current = undefined;
      active.current = false;
      cleanup.current = () => {};
      setRectangle(null);
    };
    const draw = () => {
      frame.current = undefined;
      const viewport = container.getBoundingClientRect();
      const left = Math.max(Math.min(start.x, last.x), viewport.left);
      const top = Math.max(Math.min(start.y, last.y), viewport.top);
      const right = start.x === last.x && start.y !== last.y && left === start.x ? left + 1 : Math.max(start.x, last.x);
      const bottom = start.y === last.y && start.x !== last.x && top === start.y ? top + 1 : Math.max(start.y, last.y);
      const box = { left, top, width: Math.max(0, Math.min(right, viewport.right) - left), height: Math.max(0, Math.min(bottom, viewport.bottom) - top) };
      setRectangle(box);
      const next = new Set(baseline);
      container.querySelectorAll<HTMLElement>(latest.current.rowSelector).forEach((node) => {
        if (!node.isConnected || !node.getClientRects().length) return;
        const r = node.getBoundingClientRect();
        if (box.width > 0 && box.height > 0 && r.right > box.left && r.left < box.left + box.width && r.bottom > box.top && r.top < box.top + box.height)
          latest.current.getRowIds(node).forEach((id) => next.add(id));
      });
      latest.current.onSelect([...next]);
    };
    const move = (pointer: globalThis.PointerEvent) => {
      last = { x: pointer.clientX, y: pointer.clientY };
      if (!moved && Math.hypot(last.x - start.x, last.y - start.y) < 5) return;
      if (!moved) { moved = true; latest.current.onStart?.(); }
      if (frame.current === undefined) frame.current = requestAnimationFrame(draw);
    };
    const up = () => {
      if (moved) {
        if (frame.current !== undefined) { cancelAnimationFrame(frame.current); draw(); }
        suppressClick.current = true;
        setTimeout(() => { suppressClick.current = false; }, 0);
      }
      finish();
    };
    active.current = true;
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', cancel);
    cleanup.current = finish;
  };
  const pointerDown = useRef(onPointerDownCapture);
  pointerDown.current = onPointerDownCapture;
  useEffect(() => {
    if (!container) return;
    const down = (event: globalThis.PointerEvent) => pointerDown.current(event);
    const drag = (event: globalThis.DragEvent) => { if (active.current) { event.preventDefault(); event.stopPropagation(); } };
    const select = (event: Event) => { if (active.current) event.preventDefault(); };
    const click = (event: globalThis.MouseEvent) => { if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); } };
    container.addEventListener('pointerdown', down, true);
    container.addEventListener('dragstart', drag, true);
    container.addEventListener('selectstart', select, true);
    container.addEventListener('click', click, true);
    return () => {
      container.removeEventListener('pointerdown', down, true);
      container.removeEventListener('dragstart', drag, true);
      container.removeEventListener('selectstart', select, true);
      container.removeEventListener('click', click, true);
      cancel();
      suppressClick.current = false;
    };
  }, [container, cancel]);
  return {
    containerRef,
    setContainerRef,
    rectangle,
    cancel,
  };
}
