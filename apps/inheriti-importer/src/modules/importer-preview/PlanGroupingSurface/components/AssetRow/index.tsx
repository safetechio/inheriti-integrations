import { Box, Button, Icon, Text, theme } from '@main-components';
import { getAssetTypeDisplayName } from '@modules/_shared/domain/asset-type-display-name';
import type { GroupingAsset } from '../../types';

interface AssetRowProps {
  asset: GroupingAsset;
  dragged: boolean;
  assigned: boolean;
  onStart: () => void;
  onEnd: () => void;
  onAssign?: () => void;
  assignDisabled?: boolean;
}

export function AssetRow({
  asset,
  dragged,
  assigned,
  onStart,
  onEnd,
  onAssign,
  assignDisabled = false,
}: AssetRowProps) {
  return (
    <Box
      className={`plan-asset-row ${dragged ? 'is-dragged' : ''}`}
      draggable={Boolean(asset.valid)}
      onDragStart={onStart}
      onDragEnd={onEnd}
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      gap="s"
    >
      <Icon name="grip-dots-vertical" size={12} color={theme.colors.gray50} />
      <Box gap="xxs" flex={1}>
        <Text variant="bodySmall" semibold>
          {asset.name}
        </Text>
        <Text variant="bodySmall" color="gray">
          {getAssetTypeDisplayName(asset.type)}
        </Text>
        {asset.valid === false ? (
          <Text variant="bodySmall" color="danger120">
            Invalid Asset binding
          </Text>
        ) : null}
        {assigned ? (
          <Text variant="bodySmall" color="success120">
            Assigned to Plan draft
          </Text>
        ) : null}
      </Box>
      <Button
        title="Assign"
        size="sm"
        disabled={assignDisabled || !onAssign}
        onPress={() => onAssign?.()}
      />
    </Box>
  );
}
