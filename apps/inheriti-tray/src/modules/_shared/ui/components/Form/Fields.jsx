export function TextField({
  id, label, value, onChange, required = false, disabled = false,
  maxLength, type = 'text', multiline = false,
}) {
  const control = multiline
    ? <textarea
        id={id}
        name={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={4}
        autoComplete="off"
        required={required}
        disabled={disabled}
      />
    : <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={maxLength}
        autoComplete="off"
        required={required}
        disabled={disabled}
      />;

  return <div className="field">
    <label htmlFor={id}>{label}</label>
    {control}
  </div>;
}

export function SelectField({ id, label, value, onChange, options, required = false, disabled = false }) {
  return <div className="field">
    <label htmlFor={id}>{label}</label>
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      required={required}
      disabled={disabled}
    >
      {options.map(({ value: optionValue, label: optionLabel }) =>
        <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
    </select>
  </div>;
}
