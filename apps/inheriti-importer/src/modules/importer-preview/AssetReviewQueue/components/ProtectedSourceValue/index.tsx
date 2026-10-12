import { useEffect, useState } from 'react';
import { Box, IconAction, Text } from '@main-components';
import type { SensitiveValue } from '@modules/import/domain/import-model';

export function ProtectedSourceValue({
  fieldLabel,
  sourceFieldId,
  resolveSourceValue,
}: {
  fieldLabel: string;
  sourceFieldId?: string;
  resolveSourceValue?: (sourceFieldId: string) => SensitiveValue | undefined;
}) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const clearOnHidden = () => {
      if (document.visibilityState === 'hidden') setRevealed(false);
    };
    document.addEventListener('visibilitychange', clearOnHidden);
    return () => document.removeEventListener('visibilitychange', clearOnHidden);
  }, []);

  if (!sourceFieldId)
    return (
      <Text variant="importerFieldMono" color="gray">
        Not included
      </Text>
    );

  const value = revealed ? resolveSourceValue?.(sourceFieldId) : undefined;
  const displayValue = revealed ? (value?.reveal() ?? 'Value unavailable') : '••••••••';

  return (
    <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap="s">
      <Text variant="importerFieldMono">{displayValue}</Text>
      {resolveSourceValue ? (
        <IconAction
          name={revealed ? 'eye-slash' : 'eye'}
          label={revealed ? `Hide ${fieldLabel} value` : `Reveal ${fieldLabel} value`}
          onPress={() => setRevealed((current) => !current)}
        />
      ) : null}
    </Box>
  );
}
