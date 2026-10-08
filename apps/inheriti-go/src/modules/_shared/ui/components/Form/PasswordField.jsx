import { useState } from 'react';
import { FieldShell } from './FieldShell.jsx';

export function PasswordField({ id, label, value, onChange, required = false, disabled = false, maxLength, error }) {
  const [visible, setVisible] = useState(false);
  return <FieldShell id={id} label={label} required={required} error={error}>
    <span className="field-with-action">
      <input id={id} name={id} type={visible ? 'text' : 'password'} value={value ?? ''} onChange={(event) => onChange(event.target.value)} maxLength={maxLength} autoComplete="off" required={required} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} />
      <button type="button" className="field-action" onClick={() => setVisible(!visible)} disabled={disabled} aria-label={visible ? `Hide ${label}` : `Show ${label}`} aria-pressed={visible}>{visible ? 'Hide' : 'Show'}</button>
    </span>
  </FieldShell>;
}
