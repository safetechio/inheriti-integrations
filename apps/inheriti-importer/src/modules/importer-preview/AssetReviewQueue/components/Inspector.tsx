import { Box, Card, Notice, Stack, Text } from '@main-components';
import { getAssetTypeDisplayName } from '@modules/_shared/domain/asset-type-display-name';
import { InspectorActions } from './InspectorActions';
import { InspectorFields } from './InspectorFields';
import { AssetReviewDetails } from './AssetReviewDetails';
import type { ReviewAsset } from '../types';
import type { SourceCoverage } from '@modules/mapping/application/source-coverage';
import type { ImportReviewControls } from '../import-review-controls';

type InspectorProps = {
  coverage?: SourceCoverage;
  onSetNoteDestination?: ImportReviewControls['onSetAssetNoteDestination'];
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
  coverage,
  onSetNoteDestination,
}: InspectorProps) {
  if (!asset)
    return (
      <Card>
        <Text variant="bodySmall" color="gray">
          Select an Asset to inspect its suggestion and source binding.
        </Text>
      </Card>
    );
  const sourceFields =
    coverage?.fields.filter((field) =>
      asset.sourceNodeId
        ? field.nodeId === asset.sourceNodeId && field.sourceId === asset.sourceId
        : (!asset.sourceId || field.sourceId === asset.sourceId) &&
          field.destinations.some(({ assetId }) => assetId === asset.id),
    ) ?? [];
  const elsewhere = asset.preservedInCompanion?.length ?? 0;
  const pending = sourceFields.filter(
    ({ status, id, name }) =>
      (status === 'pending' || status === 'invalid') &&
      (asset.unmappedSourceFieldIds?.includes(id) ?? asset.unmapped.includes(name)),
  ).length;
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
          <AssetReviewDetails
            key={asset.id}
            asset={asset}
            coverage={coverage}
            sourceFields={sourceFields}
          />
        </Box>
        {asset.type !== 'PLAIN-TEXT' && (elsewhere > 0 || pending > 0) && coverage ? (
          <Notice
            compact
            tone="info"
            icon="circle-info"
            title={[`${elsewhere} preserved in additional assets`, `${pending} pending`]
              .filter((_, index) => (index === 0 ? elsewhere > 0 : pending > 0))
              .join(' · ')}
            description="Open Details to review these fields."
          />
        ) : null}
        {!coverage && asset.type !== 'PLAIN-TEXT' && asset.unmapped.length > 0 ? (
          <Notice
            compact
            tone="info"
            icon="circle-info"
            title={`${asset.unmapped.length} unmapped ${asset.unmapped.length === 1 ? 'field' : 'fields'} omitted`}
            description="To include all data, change the asset type to Plain Text."
          />
        ) : null}
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
        <InspectorFields
          asset={asset}
          resolveSourceValue={resolveSourceValue}
          onMapField={onMapField}
          onEditPlainText={onEditPlainText}
          onSetNoteDestination={onSetNoteDestination}
        />
        <InspectorActions asset={asset} onAction={onAction} />
      </Stack>
    </Card>
  );
}
