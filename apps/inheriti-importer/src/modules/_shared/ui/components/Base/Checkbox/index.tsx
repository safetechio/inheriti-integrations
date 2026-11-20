import type { InputHTMLAttributes } from 'react';
import './styles.css';

export function Checkbox({
  mixed = false,
  onClick,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { mixed?: boolean }) {
  return (
    <input
      {...props}
      type="checkbox"
      className={`importer-checkbox ${props.className ?? ''}`}
      aria-checked={mixed ? 'mixed' : props['aria-checked']}
      ref={(element) => {
        if (element) element.indeterminate = mixed;
      }}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
    />
  );
}
