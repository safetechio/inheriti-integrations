import { useLayoutEffect, useRef, useState } from 'react';
import { Box } from '@modules/_shared/ui/components/Primitives';
import { FilterChip } from '../FilterChip';
import { IconAction } from '../IconAction';
import './styles.css';

export interface ScrollableTab<Value extends string> {
  value: Value;
  label: string;
  count?: number;
  accessibilityLabel?: string;
}

export function ScrollableTabs<Value extends string>({
  label,
  tabs,
  value,
  onChange,
  variant = 'tab',
  scrollLabel = 'tabs',
}: {
  label: string;
  tabs: readonly ScrollableTab<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  variant?: 'pill' | 'tab';
  scrollLabel?: string;
}) {
  const stripRef = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const scroll = (delta: number) => {
    const strip = stripRef.current;
    if (!strip) return false;
    const next = Math.max(
      0,
      Math.min(strip.scrollWidth - strip.clientWidth, strip.scrollLeft + delta),
    );
    if (next === strip.scrollLeft) return false;
    strip.scrollLeft = next;
    return true;
  };

  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const measure = () => {
      const left = strip.scrollLeft > 1;
      const right = strip.scrollWidth - strip.clientWidth - strip.scrollLeft > 1;
      const focusedArrow = document.activeElement?.closest('.scrollable-tabs-arrow');
      if (
        focusedArrow?.parentElement === strip.parentElement &&
        ((!left && focusedArrow.classList.contains('scrollable-tabs-left')) ||
          (!right && focusedArrow.classList.contains('scrollable-tabs-right')))
      ) {
        strip.focus({ preventScroll: true });
      }
      setEdges((current) =>
        current.left === left && current.right === right ? current : { left, right },
      );
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      const movement =
        Math.abs(event.deltaX) >= Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? strip.clientWidth : 1;
      if (scroll(movement * multiplier)) {
        event.preventDefault();
        measure();
      }
    };
    let drag: { id: number; x: number; initial: number } | undefined;
    let suppressClick = false;
    const down = (event: PointerEvent) => {
      suppressClick = false;
      if (
        event.pointerType !== 'mouse' ||
        event.button !== 0 ||
        strip.scrollWidth <= strip.clientWidth
      )
        return;
      drag = { id: event.pointerId, x: event.clientX, initial: strip.scrollLeft };
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      const distance = event.clientX - drag.x;
      if (!suppressClick && Math.abs(distance) < 5) return;
      suppressClick = true;
      strip.dataset.dragging = '';
      event.preventDefault();
      scroll(drag.initial - distance - strip.scrollLeft);
      measure();
    };
    const stop = () => {
      drag = undefined;
      delete strip.dataset.dragging;
    };
    const click = (event: MouseEvent) => {
      if (!suppressClick || event.detail === 0) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined;
    observer?.observe(strip);
    if (strip.firstElementChild) observer?.observe(strip.firstElementChild);
    window.addEventListener('resize', measure);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('blur', stop);
    strip.addEventListener('scroll', measure);
    strip.addEventListener('wheel', wheel, { passive: false });
    strip.addEventListener('pointerdown', down);
    strip.addEventListener('click', click, true);
    measure();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
      strip.removeEventListener('scroll', measure);
      strip.removeEventListener('wheel', wheel);
      strip.removeEventListener('pointerdown', down);
      strip.removeEventListener('click', click, true);
    };
  }, []);

  useLayoutEffect(() => {
    const strip = stripRef.current;
    const selected = strip?.querySelector('[aria-pressed="true"]');
    if (!strip || !selected) return;
    const viewport = strip.getBoundingClientRect();
    const tab = selected.getBoundingClientRect();
    if (tab.left < viewport.left) scroll(tab.left - viewport.left);
    else if (tab.right > viewport.right) scroll(tab.right - viewport.right);
  }, [value]);

  return (
    <Box className="scrollable-tabs">
      <Box
        ref={stripRef}
        role="group"
        aria-label={label}
        tabIndex={-1}
        className="scrollable-tabs-strip"
      >
        <Box flexDirection="row" gap="xs" className="scrollable-tabs-track">
          {tabs.map((tab) => (
            <FilterChip
              key={tab.value}
              variant={variant}
              accessibilityLabel={tab.accessibilityLabel}
              count={tab.count}
              selected={value === tab.value}
              onPress={() => onChange(tab.value)}
            >
              {tab.label}
            </FilterChip>
          ))}
        </Box>
      </Box>
      {edges.left ? (
        <Box className="scrollable-tabs-arrow scrollable-tabs-left">
          <IconAction
            name="chevron-left"
            label={`Scroll ${scrollLabel} left`}
            onPress={() => scroll(-stripRef.current!.clientWidth * 0.75)}
          />
        </Box>
      ) : null}
      {edges.right ? (
        <Box className="scrollable-tabs-arrow scrollable-tabs-right">
          <IconAction
            name="chevron-right"
            label={`Scroll ${scrollLabel} right`}
            onPress={() => scroll(stripRef.current!.clientWidth * 0.75)}
          />
        </Box>
      ) : null}
    </Box>
  );
}
