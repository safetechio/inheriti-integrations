import { memo } from 'react';
import { Box, Button, Checkbox, Icon, Text, theme } from '@main-components';
import type { GroupingAsset } from '../../types';
import { getAssetTypeDisplayName } from '@modules/_shared/domain/asset-type-display-name';

interface AssetRowProps {
  asset: GroupingAsset;
  dragged: boolean;
  onStart: (asset: GroupingAsset, event: DragEvent) => void;
  onEnd: () => void;
  onAssign?: (asset: GroupingAsset) => void;
  assignDisabled?: boolean;
  selected?: boolean;
  onSelect?: (assetId: string, rows: GroupingAsset[] | undefined, event: {
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    toggle?: boolean;
  }) => void;
  selectionRows?: GroupingAsset[];
  onFocusSelect?: () => void;
  showTypeIcon?: boolean;
  showAssign?: boolean;
}

export const AssetRow = memo(function AssetRow({
  asset,
  dragged,
  onStart,
  onEnd,
  onAssign,
  assignDisabled = false,
  selected = false,
  onSelect,
  selectionRows,
  onFocusSelect,
  showTypeIcon = false,
  showAssign = true,
}: AssetRowProps) {
  return (
    <Box
      dataSet={{ marqueeAssetId: asset.id }}
      className={`plan-asset-row ${dragged ? 'is-dragged' : ''} ${selected ? 'is-selected' : ''}`}
      draggable={Boolean(asset.valid)}
      onDragStart={(event: DragEvent) => onStart(asset, event)}
      onDragEnd={onEnd}
      onClick={(event: MouseEvent) => {
        if (!(event.ctrlKey || event.metaKey || event.shiftKey)) return;
        if ((event.target as HTMLElement).closest('button, input, [role="button"], [role="checkbox"]')) return;
        event.stopPropagation();
        onSelect?.(asset.id, selectionRows, { ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey });
      }}
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      gap="m"
    >
      {onSelect ? (
        <Box flexDirection="row" alignItems="center" gap="xs" style={{ flexShrink: 0 }}>
          <Icon name="grip-dots-vertical" size={12} color={theme.colors.gray50} />
          <Checkbox
            aria-label={`Select ${asset.name}`}
            checked={selected}
            onFocus={onFocusSelect}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(asset.id, selectionRows, {
                shiftKey: event.shiftKey,
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                toggle: true,
              });
            }}
            readOnly
          />
        </Box>
      ) : (
        <Icon name="grip-dots-vertical" size={12} color={theme.colors.gray50} />
      )}
      {showTypeIcon ? <Box dataSet={{ dragIcon: '' }}><Icon name={asset.iconName ?? 'key'} size={16} color="gray" /></Box> : null}
      <Box
        gap="xxs"
        flex={1}
        style={{ minWidth: 0 }}
        ref={(element) => element?.setAttribute('title', asset.name)}
      >
        <Text
          selectable={false}
          variant="importerAssetRowTitle"
          className="plan-asset-row-name"
          title={asset.name}
        >
          {asset.name}
        </Text>
        <Text className="plan-asset-row-type" selectable={false} variant="smallUppercase" color="gray">
          {getAssetTypeDisplayName(asset.type)}
        </Text>
        {asset.valid === false ? (
          <Text selectable={false} variant="bodySmall" color="danger120">
            Invalid Asset binding
          </Text>
        ) : null}
      </Box>
      {showAssign ? (
        <Button
          title="Assign"
          size="sm"
          disabled={assignDisabled || !onAssign}
          onPress={() => onAssign?.(asset)}
        />
      ) : null}
    </Box>
  );
});
