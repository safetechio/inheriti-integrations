import { Box, Icon, Text } from '@main-components';
import { getAssetTypeDisplayName } from '@modules/_shared/domain/asset-type-display-name';
import type { GroupingAsset } from '../../../../types';
import '../../../OrganizationFolderTree/components/PlanAssetTreeRow/styles.css';
import './styles.css';

export function ModalAssetRow({ asset, onRemove }: {
  asset: GroupingAsset;
  onRemove?: () => void;
}) {
  return (
    <Box className="folder-plan-asset-row" flexDirection="row" alignItems="center" gap="s" style={{ paddingLeft: 12 }}>
      <Box className="folder-plan-asset-icon" alignItems="center" justifyContent="center"><Icon name={asset.iconName ?? 'key'} size={18} color="gray" /></Box>
      <Box className="folder-plan-asset-details" flex={1} style={{ minWidth: 0 }}>
        <Text className="folder-plan-asset-name" variant="bodySmall" title={asset.name}>{asset.name}</Text>
        <Text className="folder-plan-asset-type" variant="xSmall" color="gray50">{getAssetTypeDisplayName(asset.type)}</Text>
      </Box>
      {onRemove ? <button type="button" className="plan-modal-remove" aria-label={`Remove ${asset.name} from this plan`} title="Remove from plan" onClick={onRemove}><Icon name="xmark" size={14} color="danger" /></button> : null}
    </Box>
  );
}
