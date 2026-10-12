import { FormTextInput } from '@main-components';

export function PlanNameInput({
  value,
  onChangeText,
  error,
}: {
  value: string;
  onChangeText: (value: string) => void;
  error?: string;
}) {
  return (
    <FormTextInput
      label="Plan name"
      required
      value={value}
      onChangeText={onChangeText}
      error={error}
      counter={`${value.length} / 160`}
      maxLength={160}
      autoFocus
      placeholder="Plan name"
    />
  );
}
