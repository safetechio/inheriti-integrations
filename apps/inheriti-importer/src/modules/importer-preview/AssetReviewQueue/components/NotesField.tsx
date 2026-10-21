import { Box, Text } from '@main-components';
import { SourceFieldPicker } from './SourceFieldPicker';
import type { ReviewAsset, ReviewAssetField } from '../types';
import type { SensitiveValue } from '@modules/import/domain/import-model';

export function NotesField({
  asset,
  field,
  onMapField,
  resolveSourceValue,
}: {
  asset: ReviewAsset;
  field: ReviewAssetField;
  onMapField?: (asset: ReviewAsset, targetField: string, sourceFieldId?: string) => void;
  resolveSourceValue?: (sourceFieldId: string) => SensitiveValue | undefined;
}) {
  const picker = (
    <SourceFieldPicker
      field={field}
      compactWhenUnmapped
      onChange={(sourceFieldId) => onMapField?.(asset, field.key, sourceFieldId)}
    />
  );
  if (!field.sourceFieldId)
    return (
      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        gap="s"
        className="asset-metadata-section"
      >
        <Text variant="importerFieldLabel">{field.label}</Text>
        {picker}
      </Box>
    );
  return (
    <Box gap="s" className="asset-metadata-section">
      <Box gap="s" className="asset-schema-field-row">
        <Box gap="xs">
          <Text variant="importerFieldLabel" semibold>
            {field.label}
          </Text>
          <Text variant="bodySmall" className="asset-metadata-preview">
            {resolveSourceValue?.(field.sourceFieldId)?.reveal() ?? 'Value unavailable'}
          </Text>
        </Box>
        <Text variant="bodySmall" color="gray">
          Visible outside this asset's protected secret.
        </Text>
        <Box className="asset-metadata-source">{picker}</Box>
        {field.validationError ? (
          <Text variant="bodySmall" color="danger120">
            {field.validationError}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}
