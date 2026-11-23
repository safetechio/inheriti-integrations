import { Box, Text } from '@main-components';
import { getAssetTypeDisplayName } from '@modules/_shared/domain/asset-type-display-name';
import { SourceFieldPicker } from './SourceFieldPicker';
import { ProtectedSourceValue } from './ProtectedSourceValue';
import type { ReviewAsset, ReviewAssetField } from '../types';
import type { SensitiveValue } from '@modules/import/domain/import-model';
import { PlainTextEditor } from './PlainTextEditor';
import { NotesField } from './NotesField';
import type { ImportReviewControls } from '../import-review-controls';

export function InspectorFields({
  asset,
  assets,
  onInspect,
  resolveSourceValue,
  onMapField,
  onEditPlainText,
  onSetNoteDestination,
}: {
  asset: ReviewAsset;
  assets?: ReviewAsset[];
  onInspect?: (asset: ReviewAsset) => void;
  onSetNoteDestination?: ImportReviewControls['onSetAssetNoteDestination'];
  resolveSourceValue?: (sourceFieldId: string) => SensitiveValue | undefined;
  onMapField?: (asset: ReviewAsset, targetField: string, sourceFieldId?: string) => void;
  onEditPlainText?: (asset: ReviewAsset, value: string) => void;
}) {
  const fields = asset.schemaFields ?? [];
  if (fields.length === 0 && asset.type !== 'PLAIN-TEXT' && !asset.note)
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
      dataSet={{ reviewField: field.key }}
      tabIndex={-1}
    >
      <Box gap="xs" className="asset-schema-secret-region">
        <Text variant="importerFieldLabel">
          {field.label}
          {field.required ? ' *' : ''}
        </Text>
        <ProtectedSourceValue
          fieldLabel={field.label}
          sourceFieldId={field.sourceFieldId}
          missing={
            field.candidates?.find((candidate) => candidate.id === field.sourceFieldId)?.length ===
            0
          }
          resolveSourceValue={resolveSourceValue}
        />
      </Box>
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
        </Box>
      )}
      {metadataField || asset.note ? (
        <NotesField
          key={asset.id}
          asset={asset}
          assets={assets}
          onInspect={onInspect}
          field={metadataField}
          onSetNoteDestination={onSetNoteDestination}
          onMapField={onMapField}
          resolveSourceValue={resolveSourceValue}
        />
      ) : null}
    </Box>
  );
}
