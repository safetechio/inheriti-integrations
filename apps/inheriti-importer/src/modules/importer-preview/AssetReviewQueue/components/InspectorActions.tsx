import { Box, Button, Icon, Text, theme } from '@main-components';
import { getAssetTypeDisplayName } from '@modules/_shared/domain/asset-type-display-name';
import { hasIncludedSchemaField, type ReviewAsset } from '../types';
export function InspectorActions({
  asset,
  onAction,
}: {
  asset: ReviewAsset;
  onAction?: (action: string, asset: ReviewAsset) => void;
}) {
  const canAccept =
    Boolean(onAction) && asset.status !== 'accepted' && hasIncludedSchemaField(asset);
  return (
    <Box gap="s" className="asset-inspector-actions">
      {!hasIncludedSchemaField(asset) && onAction ? (
        <Text variant="bodySmall" color="warning120">
          {asset.type === 'PLAIN-TEXT'
            ? 'Enter a Plain Text secret before accepting this Asset.'
            : 'Include at least one schema field before accepting this Asset.'}
        </Text>
      ) : null}
      <Box
        className="asset-inspector-decision-actions"
        flexDirection="row"
        alignItems="center"
        gap="s"
      >
        <Button
          title="Exclude"
          startIcon={<Icon name="ban" size={12} color={theme.colors.danger120} />}
          variant="outlined"
          color="danger"
          disabled={!onAction || asset.status === 'excluded'}
          onPress={() => onAction?.('exclude', asset)}
        />
        <Button
          title="Accept"
          startIcon={<Icon name="check" size={12} color={theme.colors.white} />}
          disabled={!canAccept}
          onPress={() => onAction?.('accept', asset)}
        />
      </Box>
      {asset.convertedFromType ? (
        <Button
          title={`Back to suggested ${getAssetTypeDisplayName(asset.convertedFromType)}`}
          variant="outlined"
          size="sm"
          disabled={!onAction}
          onPress={() => onAction?.('restore-suggestion', asset)}
        />
      ) : null}
    </Box>
  );
}
