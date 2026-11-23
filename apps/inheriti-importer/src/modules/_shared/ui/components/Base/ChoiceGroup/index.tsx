import { useId } from 'react';
import { Box, Text } from '../../Primitives';
import './styles.css';

export function ChoiceGroup<Value extends string>({
  label,
  value,
  options,
  onChange,
  onReselect,
  disabled = false,
  helperText,
}: {
  label: string;
  value: Value | null;
  options: readonly { value: Value; label: string; description?: string; disabled?: boolean }[];
  onChange: (value: Value) => void;
  onReselect?: (value: Value) => void;
  disabled?: boolean;
  helperText?: string;
}) {
  const id = useId();
  const labelId = `${id}-label`;
  const helperId = helperText ? `${id}-helper` : undefined;

  return (
    <Box gap="s" role="radiogroup" aria-labelledby={labelId} aria-describedby={helperId}>
      <Text nativeID={labelId} variant="bodySmall" semibold>
        {label}
      </Text>
      <Box flexDirection="row" flexWrap="wrap" gap="s">
        {options.map((option, index) => {
          const descriptionId = option.description ? `${id}-description-${index}` : undefined;
          return (
            <label
              key={option.value}
              className={
                value === option.value ? 'choice-group-option is-selected' : 'choice-group-option'
              }
            >
              <input
                className="choice-group-radio"
                type="radio"
                name={id}
                value={option.value}
                checked={value === option.value}
                disabled={disabled || option.disabled}
                aria-label={option.label}
                aria-describedby={descriptionId}
                onChange={() => onChange(option.value)}
                onClick={
                  onReselect && value === option.value ? () => onReselect(option.value) : undefined
                }
              />
              <Text variant="bodySmall" semibold>
                {option.label}
              </Text>
              {option.description ? (
                <Text nativeID={descriptionId} variant="bodySmall" color="gray">
                  {option.description}
                </Text>
              ) : null}
            </label>
          );
        })}
      </Box>
      {helperText ? (
        <Text nativeID={helperId} variant="bodySmall" color="gray">
          {helperText}
        </Text>
      ) : null}
    </Box>
  );
}
