import { useContext } from 'react';
import { Box, Text } from '@modules/_shared/ui/components';
import { VersionContext } from './UpdateGate';

export { UpdateGate, UpdateRequiredScreen } from './UpdateGate';

export function UpdateStatus({ className }: { className?: string } = {}) {
  const version = useContext(VersionContext);
  if (!version) return null;
  return (
    <Box className={className} alignItems="flex-end">
      {version ? (
        <Text variant="bodySmall" color="gray" style={{ fontSize: 12, opacity: 0.8 }}>
          Importer · v{version}
        </Text>
      ) : null}
    </Box>
  );
}
