import { FieldShell } from './FieldShell.jsx';
import { TextareaField } from './TextareaField.jsx';

export function TextField({ id, label, value, onChange, required = false, disabled = false, maxLength, type = 'text', multiline = false, error }) {
  if (multiline) return <TextareaField id={id} label={label} value={value} onChange={onChange} required={required} disabled={disabled} maxLength={maxLength} error={error} />;
  return <FieldShell id={id} label={label} required={required} error={error}>
    <input id={id} name={id} type={type} value={value ?? ''} onChange={(event) => onChange(event.target.value)} maxLength={maxLength} autoComplete="off" required={required} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} />
  </FieldShell>;
}
