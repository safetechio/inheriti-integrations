import { useState } from 'react';
import { FieldShell } from './FieldShell.jsx';

export function PasswordTextareaField({ id, label, value, onChange, required = false, disabled = false, error, rows = 4 }) {
  const [visible, setVisible] = useState(false);
  return <FieldShell id={id} label={label} required={required} error={error}>
    <span className="field-with-action">
      <textarea id={id} name={id} value={value ?? ''} onChange={(event) => onChange(event.target.value)} rows={rows} autoComplete="off" required={required} disabled={disabled} className={visible ? undefined : 'masked-textarea'} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} />
      <button type="button" className="field-action" onClick={() => setVisible(!visible)} disabled={disabled} aria-label={visible ? `Hide ${label}` : `Show ${label}`} aria-pressed={visible}>{visible ? 'Hide' : 'Show'}</button>
    </span>
  </FieldShell>;
}
