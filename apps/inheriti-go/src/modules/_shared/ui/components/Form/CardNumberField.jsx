import { FieldShell } from './FieldShell.jsx';
import { validCard } from '../../../../quick-plan/ui/asset-form-rules.js';

export function CardNumberField({ id, label, value, onChange, required = false, disabled = false, error }) {
  const format = (text) => text.replace(/\D/g, '').slice(0, 34).replace(/(.{4})/g, '$1 ').trim();
  return <FieldShell id={id} label={label} required={required} error={error}>
    <input id={id} name={id} type="text" inputMode="numeric" autoComplete="cc-number" value={value ?? ''} onChange={(event) => { event.target.setCustomValidity(''); onChange(format(event.target.value)); }} onInvalid={(event) => { if (value && !validCard(value)) event.target.setCustomValidity('Enter a valid card number.'); }} maxLength={42} pattern="[0-9 ]+" required={required} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} />
  </FieldShell>;
}
