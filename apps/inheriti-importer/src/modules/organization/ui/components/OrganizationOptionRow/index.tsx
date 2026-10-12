import { Box, Icon, Text } from '@modules/_shared/ui/components';
import Button from '@modules/_shared/ui/components/Base/Button';
import { useTheme } from '@modules/_shared/ui/theme/AppTheme';

interface OrganizationOptionRowProps {
  name: string;
  isOwned: boolean;
  loading?: boolean;
  disabled?: boolean;
  /** Why this specific organisation can't be selected right now (e.g. trial/subscription lapsed). */
  blockedMessage?: string | null;
  messageTone?: 'danger' | 'neutral';
  onSelect: () => void;
}

/** Business UI invitation-card row adapted for organisation selection. */
export default function OrganizationOptionRow({
  name,
  isOwned,
  loading = false,
  disabled = false,
  blockedMessage,
  messageTone = 'danger',
  onSelect,
}: OrganizationOptionRowProps) {
  const uiTheme = useTheme();

  return (
    <Box
      padding="l"
      gap="l"
      borderRadius="l"
      borderWidth={1}
      borderColor="primary10"
      backgroundColor="white"
    >
      <Box flexDirection="row" alignItems="center" gap="m">
        <Box
          width={64}
          height={64}
          borderRadius="pill"
          backgroundColor="primary10"
          alignItems="center"
          justifyContent="center"
        >
          <Icon name="building" size={32} color={uiTheme.colors.primary} label="Organisation" />
        </Box>
        <Box flex={1} gap="xs">
          <Text variant="smallUppercase" color="gray">
            Organisation
          </Text>
          <Text variant="bodyRegular" color="gray120" bold>
            {name}
          </Text>
          <Text variant="bodySmall" color="gray">
            {isOwned ? 'Owner' : 'Member'}
          </Text>
        </Box>
        <Button title="Select" loading={loading} disabled={disabled} size="md" onPress={onSelect} />
      </Box>
      {blockedMessage ? (
        <Text variant="bodySmall" color={messageTone === 'neutral' ? 'gray120' : 'danger120'}>
          {blockedMessage}
        </Text>
      ) : null}
    </Box>
  );
}
