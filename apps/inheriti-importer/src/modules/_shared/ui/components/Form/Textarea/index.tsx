import { FormTextInput, type FormTextInputProps } from '../TextInput';
import { useTheme } from '@modules/_shared/ui/theme/AppTheme';

export type FormTextareaProps = FormTextInputProps;

export function FormTextarea(props: FormTextInputProps) {
  const uiTheme = useTheme();
  return (
    <FormTextInput
      {...props}
      multiline
      style={[{ minHeight: uiTheme.spacing.xxl * 3, textAlignVertical: 'top' }, props.style]}
    />
  );
}
