import { Badge, Box, Icon, InteractiveSurface, Text, theme } from '@main-components';
import { getAssetTypeDisplayName } from '@modules/_shared/domain/asset-type-display-name';
import { statusBadge, statusLabel } from './status';
import type { ReviewAsset } from '../types';

type AssetRowProps = {
  asset: ReviewAsset;
  selected: boolean;
  onSelect?: (asset: ReviewAsset) => void;
};

export function AssetRow({ asset, selected, onSelect }: AssetRowProps) {
  return (
    <InteractiveSurface
      onPress={onSelect ? () => onSelect(asset) : undefined}
      disabled={!onSelect}
      accessibilityLabel={`Inspect ${asset.name}`}
      className={`asset-review-row ${selected ? 'is-selected' : ''}`}
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      gap="m"
      width="100%"
    >
      <Box alignItems="flex-start" gap="xxs" style={{ minWidth: 0 }}>
        <Text variant="importerAssetRowTitle">{asset.name}</Text>
        <Box flexDirection="row" alignItems="center" gap="s">
          <Badge tone="primary" variant="metadata">
            {getAssetTypeDisplayName(asset.type)}
          </Badge>
          {asset.status !== 'suggested' ? (
            <Badge
              size="sm"
              tone={statusBadge[asset.status].tone}
              icon={statusBadge[asset.status].icon}
            >
              {statusLabel[asset.status]}
            </Badge>
          ) : null}
        </Box>
      </Box>
      <Icon
        name={statusBadge[asset.status].icon}
        size={13}
        color={
          theme.colors[
            `${statusBadge[asset.status].tone === 'neutral' ? 'gray' : statusBadge[asset.status].tone}120` as keyof typeof theme.colors
          ]
        }
      />
    </InteractiveSurface>
  );
}
