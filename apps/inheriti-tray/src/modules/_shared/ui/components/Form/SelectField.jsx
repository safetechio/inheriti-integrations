import { FieldShell } from './FieldShell.jsx';

export function SelectField({ id, label, value, onChange, options, required = false, disabled = false, error }) {
  return <FieldShell id={id} label={label} required={required} error={error}>
    <select id={id} name={id} value={value ?? ''} onChange={(event) => onChange(event.target.value)} required={required} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}>
      {options.map(({ value: optionValue, label: optionLabel }) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
    </select>
  </FieldShell>;
}
