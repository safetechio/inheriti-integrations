import { FormTextarea } from '@main-components';

export function PlanDescriptionInput({
  value,
  onChangeText,
  error,
}: {
  value: string;
  onChangeText: (value: string) => void;
  error?: string;
}) {
  return (
    <FormTextarea
      label="Description"
      value={value}
      onChangeText={onChangeText}
      error={error}
      counter={`${value.length} / 2000`}
      maxLength={2000}
      placeholder="Describe what this plan is for"
      accessibilityLabel="Plan description"
    />
  );
}
