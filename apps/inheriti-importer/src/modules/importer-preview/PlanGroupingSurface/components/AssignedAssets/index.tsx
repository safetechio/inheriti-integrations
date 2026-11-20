import { Box, Button, Checkbox, Stack, Text } from '@main-components';
import type { GroupingAsset } from '../../types';
export function AssignedAssets({
  assets,
  onMove,
  onRemove,
  selectedIds,
  onSelect,
  onStart,
  onEnd,
  onFocusSelect,
}: {
  assets: GroupingAsset[];
  onMove?: (asset: GroupingAsset) => void;
  onRemove?: (asset: GroupingAsset) => void;
  selectedIds?: string[];
  onSelect?: (
    asset: GroupingAsset,
    event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; toggle?: boolean },
  ) => void;
  onStart?: (asset: GroupingAsset) => void;
  onEnd?: () => void;
  onFocusSelect?: () => void;
}) {
  return (
    <Stack gap="xs" paddingVertical="s">
      {assets.map((asset) => (
        <Box
          key={asset.id}
          flexDirection="row"
          justifyContent="space-between"
          alignItems="center"
          draggable={Boolean(onStart && asset.valid !== false)}
          onDragStart={() => onStart?.(asset)}
          onDragEnd={onEnd}
          onClick={(event: MouseEvent) => {
            if (
              onSelect &&
              !(event.target as HTMLElement).closest('input, button, [role="button"]')
            )
              onSelect(asset, event);
          }}
        >
          {onSelect ? (
            <Checkbox
              aria-label={`Select ${asset.name}`}
              checked={selectedIds?.includes(asset.id) ?? false}
              onFocus={onFocusSelect}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(asset, {
                  shiftKey: event.shiftKey,
                  ctrlKey: event.ctrlKey,
                  metaKey: event.metaKey,
                  toggle: true,
                });
              }}
              readOnly
            />
          ) : null}
          <Text variant="bodyRegular" semibold>
            {asset.name}
          </Text>
          {onRemove ? (
            <Button
              title="Remove"
              size="sm"
              variant="plain"
              color="danger"
              onPress={() => onRemove(asset)}
            />
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
