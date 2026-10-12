import { useEffect, useState } from 'react';
import { BaseModal, Box, Button, FormTextInput, Text } from '@main-components';

export function LocalOrganizationKeyReleaseModal({
  visible,
  onDismiss,
  onRelease,
}: {
  visible: boolean;
  onDismiss: () => void;
  onRelease: (recoveryCode: string) => Promise<void>;
}) {
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible) return;
    setRecoveryCode('');
    setError(null);
    setLoading(false);
  }, [visible]);

  async function release() {
    if (!recoveryCode.trim()) {
      setError('Enter the Recovery code.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await onRelease(recoveryCode);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The simulated release failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <BaseModal
      visible={visible}
      title="Simulate SafeKey Mobile release"
      description="Development only. The Recovery code and derived Organization Key stay on this machine."
      onDismiss={onDismiss}
      footer={
        <Box flexDirection="row" gap="s">
          <Button title="Cancel" variant="outlined" onPress={onDismiss} disabled={loading} />
          <Button title="Release locally" onPress={() => void release()} loading={loading} />
        </Box>
      }
    >
      <FormTextInput
        label="Recovery code"
        value={recoveryCode}
        onChangeText={setRecoveryCode}
        secureTextEntry
        error={error ?? undefined}
      />
      <Text variant="bodySmall" color="gray">
        This encrypts the derived key for the active one-time relay session and sends it through the
        same API and socket flow used by SafeKey Mobile.
      </Text>
    </BaseModal>
  );
}
