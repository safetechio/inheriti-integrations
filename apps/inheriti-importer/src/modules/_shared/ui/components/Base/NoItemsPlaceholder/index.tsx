import { Box, Text } from '@modules/_shared/ui/components/Primitives';
import { Icon } from '@modules/_shared/ui/components/Base/Icon';
import { useTheme } from '@modules/_shared/ui/theme/AppTheme';

interface NoItemsPlaceholderProps {
  description: string;
  iconName?: string;
}

/** Empty-state placeholder shared by Importer screens. */
export function NoItemsPlaceholder({
  description,
  iconName = 'box-archive',
}: NoItemsPlaceholderProps) {
  const uiTheme = useTheme();

  return (
    <Box alignItems="center" gap="m" paddingVertical="l">
      <Box
        width={48}
        height={48}
        borderRadius="pill"
        borderWidth={1}
        borderColor="gray30"
        backgroundColor="gray5"
        alignItems="center"
        justifyContent="center"
      >
        <Icon name={iconName} size={20} color={uiTheme.colors.gray} label="No items" />
      </Box>
      <Text variant="bodySmall" color="gray" align="center" style={{ maxWidth: 360 }}>
        {description}
      </Text>
    </Box>
  );
}

export default NoItemsPlaceholder;
