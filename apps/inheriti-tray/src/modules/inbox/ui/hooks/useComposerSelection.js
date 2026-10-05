import { useEffect, useRef, useState } from 'react';

export function useComposerSelection({ mode, busy, marks, draft, onCreatePlanFromSecret }) {
  const input = useRef(null);
  const editor = useRef(null);
  const [menu, setMenu] = useState(null);
  useEffect(() => {
    if (!menu) return;
    const close = event => { if (!editor.current?.contains(event.target)) setMenu(null); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);
  const openMenu = event => {
    if (mode !== 'NORMAL' || busy) return;
    const start = input.current.selectionStart;
    const end = input.current.selectionEnd;
    const canUnmark = marks.some(([from, to]) => from < (end || start + 1) && to > start);
    if (start === end && !canUnmark) return;
    event.preventDefault();
    const bounds = editor.current.getBoundingClientRect();
    setMenu({ start, end, canUnmark, x: Math.max(4, Math.min(event.clientX - bounds.left || 12, bounds.width - 200)) });
  };
  const actOnSelection = action => {
    if (!menu) return;
    action(menu.start, menu.end);
    setMenu(null);
    input.current.focus();
  };
  const toPlan = () => {
    if (!menu) return;
    const text = draft.slice(menu.start, menu.end);
    onCreatePlanFromSecret({ title: 'Saved message', assetType: 'PLAIN-TEXT', assetName: 'Saved message', fields: { text } });
    setMenu(null);
  };
  return { input, editor, menu, setMenu, openMenu, actOnSelection, toPlan };
}
