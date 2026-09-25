import { useEffect, useRef, useState } from 'react';
import { planAvatarSvg } from '@safetech/inheriti-elements-brand';
import { ChevronDownIcon } from '../../../_shared/ui/components/Icons.jsx';

function PlanAvatar({ id }) {
  if (!id) return <span className="edit-plan-placeholder-icon" aria-hidden="true" />;
  return <img className="edit-plan-avatar" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(planAvatarSvg(id))}`} alt="" />;
}

export function PlanPicker({ plans, value, onChange, disabled, label, placeholder }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const trigger = useRef(null);
  const selected = plans.find(({ id }) => id === value);

  useEffect(() => { if (disabled || !plans.length) setOpen(false); }, [disabled, plans.length]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  function select(id) {
    onChange(id);
    setOpen(false);
    trigger.current?.focus();
  }

  function onOptionKeyDown(event, index) {
    if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); return; }
    const next = event.key === 'ArrowDown' ? Math.min(index + 1, plans.length - 1)
      : event.key === 'ArrowUp' ? Math.max(index - 1, 0)
        : event.key === 'Home' ? 0 : event.key === 'End' ? plans.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    root.current?.querySelectorAll('[role="option"]')[next]?.focus();
  }

  return <div className="edit-plan-field" ref={root}>
    <span id="edit-plan-label">{label}</span>
    <button id="edit-plan" className="edit-plan-trigger" ref={trigger} type="button" aria-labelledby="edit-plan-label edit-plan-value" aria-haspopup="listbox" aria-expanded={open} disabled={disabled || !plans.length}
      onClick={() => setOpen((current) => !current)} onKeyDown={(event) => { if (event.key === 'ArrowDown' && !open) { event.preventDefault(); setOpen(true); requestAnimationFrame(() => root.current?.querySelector('[role="option"]')?.focus()); } }}>
      <PlanAvatar id={selected?.id} /><span id="edit-plan-value" title={selected?.name || placeholder}>{selected?.name || placeholder}</span><span className="edit-plan-chevron"><ChevronDownIcon /></span>
    </button>
    {open && <div className="edit-plan-options" role="listbox" aria-labelledby="edit-plan-label">
      {plans.map(({ id, name }, index) => <button key={id} className="edit-plan-option" type="button" role="option" aria-selected={id === value} data-plan-id={id} onClick={() => select(id)} onKeyDown={(event) => onOptionKeyDown(event, index)}>
        <PlanAvatar id={id} /><span title={name}>{name}</span>
      </button>)}
    </div>}
  </div>;
}
