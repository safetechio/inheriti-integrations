import { useRef, useState } from 'react';

export function useComposerDrawer() {
  const drag = useRef(null);
  const [collapsed, setCollapsed] = useState(false);
  const [height, setHeight] = useState(null);
  const resize = next => setHeight(Math.min(Math.max(next, 150), Math.min(420, window.innerHeight * .55)));
  const startDrag = event => {
    if (event.target.closest('button')) return;
    drag.current = { y: event.clientY, height: height ?? event.currentTarget.nextElementSibling?.offsetHeight ?? 230 };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = event => {
    if (drag.current) resize(drag.current.height + drag.current.y - event.clientY);
  };
  const stopDrag = () => { drag.current = null; };
  const resizeWithKeys = event => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    resize((height ?? event.currentTarget.parentElement.nextElementSibling.offsetHeight) + (event.key === 'ArrowUp' ? 16 : -16));
  };
  return { collapsed, setCollapsed, height, startDrag, moveDrag, stopDrag, resizeWithKeys };
}
