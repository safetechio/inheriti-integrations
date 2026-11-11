import { Badge, Box, Card, Notice, Stack, Text } from '@main-components';
import { getAssetTypeDisplayName } from '@modules/_shared/domain/asset-type-display-name';
import { InspectorActions } from './InspectorActions';
import { InspectorFields } from './InspectorFields';
import { statusBadge, statusLabel } from './status';
import type { ReviewAsset } from '../types';

type InspectorProps = {
  asset?: ReviewAsset;
  onAction?: (action: string, asset: ReviewAsset) => void;
  resolveSourceValue?: (
    sourceFieldId: string,
  ) => import('@modules/import/domain/import-model').SensitiveValue | undefined;
  onMapField?: (asset: ReviewAsset, targetField: string, sourceFieldId?: string) => void;
  onEditPlainText?: (asset: ReviewAsset, value: string) => void;
};
export function Inspector({
  asset,
  onAction,
  resolveSourceValue,
  onMapField,
  onEditPlainText,
}: InspectorProps) {
  if (!asset)
    return (
      <Card>
        <Text variant="bodySmall" color="gray">
          Select an Asset to inspect its suggestion and source binding.
        </Text>
      </Card>
    );
  return (
    <Card tone="default" className="asset-inspector-card">
      <Stack gap="m">
        <Box flexDirection="row" justifyContent="space-between" alignItems="flex-start">
          <Box gap="xxs" className="asset-inspector-heading">
            <Text variant="importerAssetTitle" className="asset-inspector-heading-text">
              {asset.name}
            </Text>
            <Text
              variant="importerSourceMeta"
              color="gray"
              className="asset-inspector-heading-text"
            >
              {asset.source}
            </Text>
          </Box>
          {asset.status !== 'suggested' ? (
            <Badge tone={statusBadge[asset.status].tone}>{statusLabel[asset.status]}</Badge>
          ) : null}
        </Box>
        <Box gap="xs">
          <Text variant="importerFieldLabel">Asset type</Text>
          <select
            className="asset-type-select"
            aria-label="Asset type"
            value={asset.type}
            disabled={!onAction || asset.alternatives.length === 0}
            onChange={(event) => onAction?.(`alternate:${event.target.value}`, asset)}
          >
            <option value={asset.type}>{getAssetTypeDisplayName(asset.type)}</option>
            {asset.alternatives.map((type) => (
              <option key={type} value={type}>
                {getAssetTypeDisplayName(type)}
              </option>
            ))}
          </select>
        </Box>
        {asset.type !== 'PLAIN-TEXT' && asset.unmapped.length > 0 ? (
          <Notice
            compact
            tone="warning"
            icon="circle-exclamation"
            title={`${asset.unmapped.length} unmapped ${asset.unmapped.length === 1 ? 'field' : 'fields'} omitted`}
            description="To include all data, change the asset type to Plain Text."
          />
        ) : null}
        <InspectorFields
          asset={asset}
          resolveSourceValue={resolveSourceValue}
          onMapField={onMapField}
          onEditPlainText={onEditPlainText}
        />
        <InspectorActions asset={asset} onAction={onAction} />
      </Stack>
    </Card>
  );
}
