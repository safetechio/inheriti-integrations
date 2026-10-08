import { FieldShell } from './FieldShell.jsx';

export function ExpiryDateField({ id, label, value, onChange, required = false, disabled = false, error }) {
  const format = (text) => {
    const digits = text.replace(/\D/g, '').slice(0, 4);
    return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
  };
  return <FieldShell id={id} label={label} required={required} error={error}>
    <input id={id} name={id} type="text" inputMode="numeric" autoComplete="cc-exp" placeholder="MM/YY" value={value ?? ''} onChange={(event) => onChange(format(event.target.value))} maxLength={5} pattern="(0[1-9]|1[0-2])/[0-9]{2}" required={required} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} />
  </FieldShell>;
}
