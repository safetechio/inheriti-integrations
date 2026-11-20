import { Box, FileTypeIcon, Icon, Text } from '@main-components';
import { TREE_ICON_NAMES } from '@/assets/file-type-icons/catalog';

export const CoreIconCatalog = () => (
  <Box padding="l" gap="l">
    <Text variant="heading3">Shared Core SDK icon catalog</Text>
    <Box flexDirection="row" flexWrap="wrap" gap="m">
      {Object.entries(TREE_ICON_NAMES).map(([role, name]) => (
        <Box key={role} gap="s" alignItems="center" width={120}>
          <Icon name={name} size={24} color="gray" />
          <Text variant="bodySmall">
            {role}: {name}
          </Text>
        </Box>
      ))}
    </Box>
    <Box flexDirection="row" flexWrap="wrap" gap="m">
      {['pdf', 'json', 'csv', 'zip', 'png', 'unknown'].flatMap((extension) =>
        (['outline', 'light', 'solid'] as const).map((variant) => (
          <Box key={`${extension}-${variant}`} gap="s" alignItems="center" width={120}>
            <FileTypeIcon extension={extension} variant={variant} size={32} />
            <Text variant="bodySmall">
              {extension} / {variant}
            </Text>
          </Box>
        )),
      )}
    </Box>
  </Box>
);
