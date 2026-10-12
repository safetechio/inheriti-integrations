import { useState, type ComponentProps } from 'react';
import { Box, Text, TextInput as NativeTextInput } from '@modules/_shared/ui/components/Primitives';
import { useTheme } from '@modules/_shared/ui/theme/AppTheme';

export interface FormTextInputProps extends Omit<
  ComponentProps<typeof NativeTextInput>,
  'value' | 'onChangeText'
> {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  error?: string;
  counter?: string;
  required?: boolean;
}

export function FormTextInput({
  label,
  value,
  onChangeText,
  error,
  counter,
  required,
  style,
  ...props
}: FormTextInputProps) {
  const uiTheme = useTheme();
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const active = focused || hovered;
  const borderColor = error
    ? uiTheme.colors.danger
    : active
      ? uiTheme.colors.primary
      : uiTheme.colors.gray30;
  const backgroundColor = error
    ? uiTheme.colors.danger5
    : active
      ? uiTheme.colors.primary5
      : uiTheme.colors.white;

  return (
    <Box gap="xs">
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="s">
        <Text variant="bodySmall" semibold>
          {label}
          {required ? ' *' : ''}
        </Text>
        {counter ? (
          <Text variant="bodySmall" color="gray">
            {counter}
          </Text>
        ) : null}
      </Box>
      <NativeTextInput
        {...props}
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={props.accessibilityLabel ?? label}
        onFocus={(event) => {
          setFocused(true);
          props.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          props.onBlur?.(event);
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        placeholderTextColor={uiTheme.colors.gray50}
        style={[
          {
            width: '100%',
            minHeight: uiTheme.importer.controls.defaultHeight,
            padding: uiTheme.importer.spacing.sectionGap,
            borderWidth: 1,
            borderColor,
            borderRadius: uiTheme.importer.borders.controlRadius,
            backgroundColor,
            color: uiTheme.colors.gray120,
            fontFamily: uiTheme.textVariants.bodyRegular.fontFamily,
            fontSize: uiTheme.textVariants.bodyRegular.fontSize,
            outlineStyle: 'none',
            boxShadow: focused
              ? `0 0 0 3px ${error ? uiTheme.colors.danger30 : uiTheme.colors.primary10}`
              : undefined,
            transitionProperty: 'border-color, background-color, box-shadow',
            transitionDuration: '150ms',
          },
          style,
        ]}
      />
      {error ? (
        <Text variant="bodySmall" color="danger120" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </Box>
  );
}
