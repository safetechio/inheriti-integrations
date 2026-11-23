import { Box, Checkbox, Icon, Text, theme } from '@main-components';
import { memo, type MouseEvent } from 'react';
import { keyboardActivation } from '@modules/_shared/ui/keyboard-activation';
import { statusBadge, statusLabel } from './status';
import type { ReviewAsset } from '../types';
import { getAssetTypeDisplayName } from '@modules/_shared/domain/asset-type-display-name';

type AssetRowProps = {
  asset: Pick<ReviewAsset, 'id' | 'name' | 'type' | 'status'>;
  depth: number;
  inspected: boolean;
  selected: boolean;
  onToggle?: (id: string, range: boolean) => void;
  onSelect: (id: string) => void;
};

export const AssetRow = memo(function AssetRow({
  asset,
  depth,
  inspected,
  selected,
  onToggle,
  onSelect,
}: AssetRowProps) {
  return (
    <Box style={{ paddingLeft: depth * 16 }}>
      <Box
        dataSet={{ reviewAssetId: asset.id }}
        className={`asset-review-row-frame ${selected ? 'is-batch-selected' : ''}`}
        flexDirection="row"
        alignItems="center"
        gap="s"
      >
        {onToggle ? (
          <Checkbox
            aria-label={`Select ${asset.name}`}
            checked={selected}
            readOnly
            onClick={(event) => onToggle(asset.id, event.shiftKey)}
          />
        ) : null}
        <Box
          role="button"
          dataSet={{ marqueeRowControl: '' }}
          aria-label={`Inspect ${asset.name}`}
          onClick={(event: MouseEvent) => {
            if (onToggle && (event.ctrlKey || event.metaKey || event.shiftKey)) {
              onToggle(asset.id, event.shiftKey);
            } else {
              onSelect(asset.id);
            }
          }}
          {...keyboardActivation(() => onSelect(asset.id))}
          className={`asset-review-row ${inspected ? 'is-selected' : ''}`}
          flexDirection="row"
          justifyContent="space-between"
          alignItems="center"
          gap="m"
          width="100%"
        >
          <Box
            alignItems="flex-start"
            style={{ minWidth: 0, flex: 1 }}
            ref={(element) => element?.setAttribute('title', asset.name)}
          >
            <Text variant="importerAssetRowTitle" className="asset-review-row-name">
              {asset.name}
            </Text>
            <Text variant="smallUppercase" color="gray">
              {getAssetTypeDisplayName(asset.type)}
            </Text>
          </Box>
          <Box
            className={`asset-review-status is-${statusBadge[asset.status].tone}`}
            title={statusLabel[asset.status]}
            accessibilityLabel={statusLabel[asset.status]}
          >
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
        </Box>
      </Box>
    </Box>
  );
}, (previous, next) =>
  previous.asset.id === next.asset.id &&
  previous.asset.name === next.asset.name &&
  previous.asset.type === next.asset.type &&
  previous.asset.status === next.asset.status &&
  previous.depth === next.depth &&
  previous.inspected === next.inspected &&
  previous.selected === next.selected &&
  previous.onToggle === next.onToggle &&
  previous.onSelect === next.onSelect,
);
