import {
  FormProvider,
  useController,
  useForm,
  useFormContext,
  type UseFormReturn,
} from 'react-hook-form';
import type { ReactNode } from 'react';
import { Alert, Box, Text, TextInput } from '@modules/_shared/ui/components';
import Button from '@modules/_shared/ui/components/Base/Button';

export type AssetFormValues = {
  meta: Record<string, unknown> & { name?: string };
  secret: Record<string, unknown>;
};

export function useAssetForm(defaultValues?: Partial<AssetFormValues>) {
  return useForm<AssetFormValues>({
    defaultValues: {
      meta: { name: '', ...defaultValues?.meta },
      secret: { ...defaultValues?.secret },
    },
    mode: 'onBlur',
  });
}

export function AssetForm({
  methods,
  children,
  onSubmit,
  onCancel,
}: {
  methods: UseFormReturn<AssetFormValues>;
  children: ReactNode;
  onSubmit: (values: AssetFormValues) => void;
  onCancel: () => void;
}) {
  return (
    <FormProvider {...methods}>
      <Box gap="m">
        {children}
        <Box flexDirection="row" justifyContent="flex-end" gap="s">
          <Button title="Cancel" variant="outlined" color="danger" onPress={onCancel} />
          <Button title="Save" onPress={() => void methods.handleSubmit(onSubmit)()} />
        </Box>
      </Box>
    </FormProvider>
  );
}

export function AssetTextField({
  source,
  label,
  multiline = false,
  secure = false,
  maxLength,
  required = false,
}: {
  source: `meta.${string}` | `secret.${string}`;
  label: string;
  multiline?: boolean;
  secure?: boolean;
  maxLength?: number;
  required?: boolean;
}) {
  const { control } = useFormContext<AssetFormValues>();
  const { field, fieldState } = useController({
    control,
    name: source as never,
    rules: {
      required: required ? 'Please fill in this field' : undefined,
      maxLength: maxLength
        ? { value: maxLength, message: `Please enter a value of max ${maxLength} chars` }
        : undefined,
    },
  });

  return (
    <Box gap="s">
      <Text variant="bodySmall" bold>
        {label}
      </Text>
      <TextInput
        value={typeof field.value === 'string' ? field.value : ''}
        onChangeText={field.onChange}
        onBlur={field.onBlur}
        accessibilityLabel={label}
        multiline={multiline}
        secureTextEntry={secure}
        numberOfLines={multiline ? 4 : 1}
        maxLength={maxLength}
        style={styles.input}
      />
      {fieldState.error ? <Alert>{fieldState.error.message}</Alert> : null}
    </Box>
  );
}

const styles = {
  input: {
    borderColor: '#D0D5DD',
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 42,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
} as const;
