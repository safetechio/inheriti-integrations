import { useId, useState } from 'react';
import { Box, Text } from '@modules/_shared/ui/components/Primitives';
import { useTheme } from '@modules/_shared/ui/theme/AppTheme';

export interface FormSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  helperText?: string;
}

export function FormSelect({ label, value, onChange, options, disabled, helperText }: FormSelectProps) {
  const id = useId();
  const uiTheme = useTheme();
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const active = !disabled && (focused || hovered);

  return <Box gap="xs">
    <label htmlFor={id}><Text variant="bodySmall" semibold>{label}</Text></label>
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%',
        minHeight: uiTheme.importer.controls.defaultHeight,
        padding: uiTheme.importer.spacing.sectionGap,
        border: `1px solid ${active ? uiTheme.colors.primary : uiTheme.colors.gray30}`,
        borderRadius: uiTheme.importer.borders.controlRadius,
        backgroundColor: disabled ? uiTheme.colors.gray5 : active ? uiTheme.colors.primary5 : uiTheme.colors.white,
        opacity: disabled ? 0.65 : 1,
        color: uiTheme.colors.gray120,
        fontFamily: uiTheme.textVariants.bodyRegular.fontFamily,
        fontSize: uiTheme.textVariants.bodyRegular.fontSize,
        outline: 'none',
        boxShadow: focused ? `0 0 0 3px ${uiTheme.colors.primary10}` : undefined,
        transition: 'border-color 150ms, background-color 150ms, box-shadow 150ms',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
    {helperText ? <Text variant="bodySmall" color="gray">{helperText}</Text> : null}
  </Box>;
}
