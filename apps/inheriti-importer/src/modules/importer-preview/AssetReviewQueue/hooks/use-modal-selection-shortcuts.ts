import { useEffect } from 'react';

export function useModalSelectionShortcuts({
  enabled,
  title,
  canSelectAll,
  canClear,
  onSelectAll,
  onClear,
}: {
  enabled: boolean;
  title: string;
  canSelectAll: boolean;
  canClear: boolean;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : document.activeElement;
      if (target?.closest('[role="dialog"]')?.getAttribute('aria-label') !== title) return;
      if (event.key === 'Escape' && canClear) {
        event.preventDefault();
        event.stopPropagation();
        onClear();
      } else if (
        canSelectAll &&
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'a' &&
        !target?.closest('input:not([type="checkbox"]), select, textarea, [contenteditable="true"]')
      ) {
        event.preventDefault();
        event.stopPropagation();
        onSelectAll();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [enabled, title, canSelectAll, canClear, onSelectAll, onClear]);
}
