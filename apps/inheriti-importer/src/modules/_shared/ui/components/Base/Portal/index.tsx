import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Drop-in for react-native-web's `Modal` (`visible`/`onRequestClose`/children)
 * that portals straight into `document.body` via React's own `createPortal`.
 * `Modal`'s internal `ModalPortal` creates its target node as a render-phase
 * side effect but only removes it on effect cleanup, which React 18
 * StrictMode's dev-only mount/cleanup/remount dance breaks — the node gets
 * detached and never recreated, leaving the dialog invisible until an
 * unrelated re-render happens to fix it.
 */
export function ModalPortal({
  visible,
  onRequestClose,
  children,
}: {
  visible: boolean;
  onRequestClose?: () => void;
  children: ReactNode;
}) {
  const onRequestCloseRef = useRef(onRequestClose);
  onRequestCloseRef.current = onRequestClose;

  useEffect(() => {
    if (!visible) return;
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"]');
    const dialog = dialogs[dialogs.length - 1];
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    queueMicrotask(() => focusable()[0]?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onRequestCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const elements = focusable();
      if (!elements.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [visible]);

  if (!visible) return null;
  return createPortal(children, document.body);
}
