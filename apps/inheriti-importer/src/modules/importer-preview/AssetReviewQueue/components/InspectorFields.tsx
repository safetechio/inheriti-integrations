import { Box, Text } from '@main-components';
import { getAssetTypeDisplayName } from '@modules/_shared/domain/asset-type-display-name';
import { SourceFieldPicker } from './SourceFieldPicker';
import { ProtectedSourceValue } from './ProtectedSourceValue';
import type { ReviewAsset, ReviewAssetField } from '../types';
import type { SensitiveValue } from '@modules/import/domain/import-model';
import { PlainTextEditor } from './PlainTextEditor';
import { NotesField } from './NotesField';

export function InspectorFields({
  asset,
  resolveSourceValue,
  onMapField,
  onEditPlainText,
}: {
  asset: ReviewAsset;
  resolveSourceValue?: (sourceFieldId: string) => SensitiveValue | undefined;
  onMapField?: (asset: ReviewAsset, targetField: string, sourceFieldId?: string) => void;
  onEditPlainText?: (asset: ReviewAsset, value: string) => void;
}) {
  const fields = asset.schemaFields ?? [];
  if (fields.length === 0 && asset.type !== 'PLAIN-TEXT')
    return (
      <Text variant="bodySmall" color="gray">
        No schema fields are available for this Asset type.
      </Text>
    );
  const metadataField = fields.find((field) => field.key === 'meta.notes');
  const secretFields = fields.filter((field) => field.key !== 'meta.notes');
  const renderField = (field: ReviewAssetField) => (
    <Box
      key={`${asset.id}:${field.key}:${field.sourceFieldId ?? 'unmapped'}`}
      gap="xs"
      className="asset-schema-field-row"
    >
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="s">
        <Text variant="importerFieldLabel">
          {field.label}
          {field.required ? ' *' : ''}
        </Text>
      </Box>
      <ProtectedSourceValue
        fieldLabel={field.label}
        sourceFieldId={field.sourceFieldId}
        resolveSourceValue={resolveSourceValue}
      />
      <SourceFieldPicker
        field={field}
        onChange={(sourceFieldId) => onMapField?.(asset, field.key, sourceFieldId)}
      />
      {field.validationError ? (
        <Text variant="bodySmall" color="danger120">
          {field.validationError}
        </Text>
      ) : null}
    </Box>
  );
  return (
    <Box gap="m" className="asset-schema-fields">
      {asset.type === 'PLAIN-TEXT' ? (
        <PlainTextEditor
          asset={asset}
          onEdit={onEditPlainText}
          onMapField={onMapField}
          resolveSourceValue={resolveSourceValue}
        />
      ) : (
        <Box gap="s">
          <Text className="asset-field-heading" variant="smallUppercase" color="gray">
            {getAssetTypeDisplayName(asset.type)} fields
          </Text>
          {secretFields.map((field) => renderField(field))}
          <Text variant="bodySmall" color="gray">
            Only mapped schema fields are included. Other imported fields stay out of this Asset.
          </Text>
        </Box>
      )}
      {metadataField ? (
        <NotesField
          asset={asset}
          field={metadataField}
          onMapField={onMapField}
          resolveSourceValue={resolveSourceValue}
        />
      ) : null}
    </Box>
  );
}
