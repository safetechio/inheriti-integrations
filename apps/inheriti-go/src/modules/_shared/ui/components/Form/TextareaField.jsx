import { FieldShell } from './FieldShell.jsx';

export function TextareaField({ id, label, value, onChange, required = false, disabled = false, maxLength, rows = 4, error }) {
  return <FieldShell id={id} label={label} required={required} error={error}>
    <textarea id={id} name={id} value={value ?? ''} onChange={(event) => onChange(event.target.value)} rows={rows} maxLength={maxLength} autoComplete="off" required={required} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} />
  </FieldShell>;
}
