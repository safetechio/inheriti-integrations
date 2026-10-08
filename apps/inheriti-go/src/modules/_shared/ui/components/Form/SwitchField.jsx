import { FieldShell } from './FieldShell.jsx';

export function SwitchField({ id, label, checked, value, onChange, disabled = false, error }) {
  return <FieldShell id={id} label={label} error={error}>
    <input id={id} name={id} className="switch-input" type="checkbox" role="switch" checked={Boolean(checked ?? value)} onChange={(event) => onChange(event.target.checked)} disabled={disabled} aria-invalid={Boolean(error)} />
  </FieldShell>;
}
