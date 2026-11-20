import { Box, Checkbox, Icon, Text } from '@main-components';
import { getAssetTypeDisplayName } from '@modules/_shared/domain/asset-type-display-name';
import type { GroupingAsset } from '../../../../types';

export function PlanAssetTreeRow({ asset, depth, selected, onSelect, onDragStart, onDragEnd, actions }: { asset: GroupingAsset; depth: number; selected?: boolean; onSelect?: (event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; toggle?: boolean }) => void; onDragStart?: (event: DragEvent) => void; onDragEnd?: () => void; actions?: React.ReactNode }) {
  return <Box dataSet={{ assignedAssetId: asset.id }} className={`folder-plan-asset-row ${selected ? 'is-selected' : ''}`} flexDirection="row" alignItems="center" gap="s" style={{ paddingLeft: depth * 28 + 48 }} draggable={Boolean(onDragStart)} onDragStart={(event: DragEvent) => { event.stopPropagation(); onDragStart?.(event); }} onDragEnd={() => onDragEnd?.()} onClick={(event: MouseEvent) => { if ((event.target as HTMLElement).closest('button, input, [role="button"]')) return; if (event.ctrlKey || event.metaKey || event.shiftKey) onSelect?.(event); }}>
    {onSelect ? <Checkbox aria-label={`Select ${asset.name}`} checked={Boolean(selected)} readOnly onClick={(event) => onSelect({ shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, toggle: true })} /> : null}
    <Box className="folder-plan-asset-icon" alignItems="center" justifyContent="center"><Icon name={asset.iconName ?? 'key'} size={18} color="gray" /></Box>
    <Box className="folder-plan-asset-details" flex={1} style={{ minWidth: 0 }}>
      <Text className="folder-plan-asset-name" variant="bodySmall" title={asset.name}>{asset.name}</Text>
      <Text className="folder-plan-asset-type" variant="xSmall" color="gray50">{getAssetTypeDisplayName(asset.type)}</Text>
    </Box>
    {actions}
  </Box>;
}
