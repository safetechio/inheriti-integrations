import { Badge, Box, Card, Notice, Stack, Text } from '@main-components';
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
          <Box gap="xxs">
            <Text variant="importerAssetTitle">{asset.name}</Text>
            <Text variant="importerSourceMeta" color="gray">
              {asset.source}
            </Text>
          </Box>
          {asset.status !== 'suggested' ? (
            <Badge tone={statusBadge[asset.status].tone} icon={statusBadge[asset.status].icon}>
              {statusLabel[asset.status]}
            </Badge>
          ) : null}
        </Box>
        <Notice
          compact
          tone={asset.status === 'needs-review' ? 'warning' : 'info'}
          icon={asset.status === 'needs-review' ? 'circle-exclamation' : 'circle-info'}
          title={
            asset.suggestionLabel ??
            (asset.type === 'PLAIN-TEXT' ? 'Plain Text fallback' : 'Suggested classification')
          }
          description={asset.rationale}
        />
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
