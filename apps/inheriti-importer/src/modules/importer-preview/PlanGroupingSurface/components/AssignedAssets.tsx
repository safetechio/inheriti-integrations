import { Box, Button, Stack, Text } from '@main-components';
import type { GroupingAsset } from '../types';
export function AssignedAssets({
  assets,
  onMove,
  onRemove,
}: {
  assets: GroupingAsset[];
  onMove?: (asset: GroupingAsset) => void;
  onRemove?: (asset: GroupingAsset) => void;
}) {
  return (
    <Stack gap="xs">
      <Text variant="bodySmall" color="gray">
        Assigned Assets
      </Text>
      {assets.map((asset) => (
        <Box key={asset.id} flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text variant="bodySmall">{asset.name}</Text>
          {onRemove ? (
            <Button title="Remove" size="sm" variant="plain" onPress={() => onRemove(asset)} />
          ) : onMove ? (
            <Button
              title={`Move ${asset.name} to selected Plan`}
              size="sm"
              variant="plain"
              onPress={() => onMove(asset)}
            />
          ) : null}
        </Box>
      ))}
    </Stack>
  );
}
