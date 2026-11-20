import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { FormSelectProps } from '../../Select';

export function useSearchableSelect({ options, onChange, disabled }: FormSelectProps, autoFocus = false) {
  const root = useRef<HTMLElement>(null);
  const pressingOutside = useRef(false);
  const fieldId = useId();
  const [query, setQuery] = useState<string | null>(autoFocus && !disabled ? '' : null);
  const [activeValue, setActiveValue] = useState<string>();
  const open = !disabled && query !== null;
  const search = query?.trim().toLowerCase() ?? '';
  const matches = options.filter(({ label }) => label.toLowerCase().includes(search));
  const activeIndex = matches.findIndex(({ value }) => value === activeValue);
  const optionId = (index: number) => `${fieldId}-option-${index}`;
  const activeId = open && activeIndex >= 0 ? optionId(activeIndex) : undefined;

  function close() {
    setQuery(null);
    setActiveValue(undefined);
  }

  function onBlur() {
    // Closing before an outside click lands can move the modal's buttons.
    if (!pressingOutside.current) close();
  }

  useEffect(() => {
    if (disabled) close();
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => !root.current?.contains(event.target as Node);
    const onPointerDown = (event: PointerEvent) => {
      pressingOutside.current = outside(event);
    };
    const onClick = (event: MouseEvent) => {
      if (outside(event)) close();
      pressingOutside.current = false;
    };
    const onPointerCancel = () => {
      if (pressingOutside.current) close();
      pressingOutside.current = false;
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointercancel', onPointerCancel);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointercancel', onPointerCancel);
      document.removeEventListener('click', onClick);
      pressingOutside.current = false;
    };
  }, [open]);

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  function searchFor(text: string) {
    if (disabled) return;
    setActiveValue(undefined);
    setQuery(text);
  }

  function choose(value: string) {
    if (disabled) return;
    close();
    onChange(value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    pressingOutside.current = false;
    if (disabled || event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) searchFor('');
      const next = event.key === 'ArrowDown'
        ? Math.min(activeIndex + 1, matches.length - 1)
        : activeIndex < 0 ? matches.length - 1 : Math.max(activeIndex - 1, 0);
      setActiveValue(matches[next]?.value);
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (!open) searchFor('');
      else if (activeIndex >= 0) choose(matches[activeIndex].value);
    }
  }

  return { root, fieldId, query, open, matches, activeIndex, activeId, optionId, onBlur, searchFor, choose, onKeyDown };
}
