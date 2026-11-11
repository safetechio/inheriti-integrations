import { Box, Icon, InteractiveSurface, Text, theme } from '@main-components';
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
      <Box alignItems="flex-start" style={{ minWidth: 0, flex: 1 }}>
        <Text variant="importerAssetRowTitle" className="asset-review-row-name" title={asset.name}>
          {asset.name}
        </Text>
      </Box>
      <Box title={statusLabel[asset.status]} accessibilityLabel={statusLabel[asset.status]}>
        <Icon
          name={
            asset.status === 'accepted'
              ? 'check'
              : asset.status === 'excluded'
                ? 'xmark'
                : 'hourglass'
          }
          size={13}
          color={
            theme.colors[
              `${statusBadge[asset.status].tone === 'neutral' ? 'gray' : statusBadge[asset.status].tone}120` as keyof typeof theme.colors
            ]
          }
        />
      </Box>
    </InteractiveSurface>
  );
}
