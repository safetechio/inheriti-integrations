import { Box, Button, FormSelect, FormTextInput, Text } from '@main-components';
import { getAssetTypeDisplayName } from '@modules/_shared/domain/asset-type-display-name';
import type { SourceCoverageField } from '@modules/mapping/application/source-coverage';
import type { FieldOperationGroup } from '../../field-operations';
import type { ReviewAssetField } from '../../types';
import { SourceFieldPicker } from '../SourceFieldPicker';
import { ProtectedTextFieldPicker } from './components/ProtectedTextFieldPicker';

export function FieldOperationGroupEditor({
  group,
  fields,
  reservedSourceIds,
  onChange,
  onRemove,
  move,
  fixedType,
  assetTypes,
  schemaFields,
}: {
  group: FieldOperationGroup;
  fields: SourceCoverageField[];
  reservedSourceIds: ReadonlySet<string>;
  onChange: (group: FieldOperationGroup) => void;
  onRemove?: () => void;
  move: boolean;
  fixedType: boolean;
  assetTypes: string[];
  schemaFields: ReviewAssetField[];
}) {
  const setBinding = (key: string, binding: string | string[] | undefined) => {
    const fieldBindings = { ...group.fieldBindings };
    if (!binding || (Array.isArray(binding) && !binding.length)) delete fieldBindings[key];
    else fieldBindings[key] = binding;
    onChange({ ...group, fieldBindings, rationale: undefined });
  };
  const textBinding = group.fieldBindings['secret.text'];
  const selectedTextIds = Array.isArray(textBinding)
    ? textBinding
    : textBinding
      ? [textBinding]
      : [];
  const candidates = fields.map(({ id, name }) => ({ id, name, length: 1 }));
  const availableFor = (key: string) => {
    const used = new Set(reservedSourceIds);
    for (const [target, binding] of Object.entries(group.fieldBindings)) {
      if (target === key) continue;
      for (const id of [binding].flat()) used.add(id);
    }
    const current = new Set([group.fieldBindings[key]].flat());
    return candidates.filter(({ id }) => current.has(id) || !used.has(id));
  };

  return (
    <Box
      role="group"
      aria-label={group.name || 'Asset group'}
      gap="m"
      padding="m"
      borderWidth={1}
      borderRadius="s"
      borderColor="gray10"
    >
      {group.rationale ? (
        <Text variant="bodySmall" color="gray">
          {group.rationale}
        </Text>
      ) : null}
      {!move && (
        <Box gap="m">
          {!fixedType ? (
            <FormSelect
              label="Asset type"
              value={group.type}
              options={Array.from(new Set([group.type, ...assetTypes]), (value) => ({
                value,
                label: getAssetTypeDisplayName(value),
              }))}
              onChange={(type) => onChange({ ...group, type, fieldBindings: {}, rationale: undefined })}
            />
          ) : null}
          <FormTextInput
            label="Asset name"
            required
            value={group.name}
            onChangeText={(name) => onChange({ ...group, name, automaticName: false })}
          />
        </Box>
      )}
      {group.type === 'PLAIN-TEXT' ? (
        <ProtectedTextFieldPicker
          fields={fields}
          availableFields={availableFor('secret.text').filter(
            ({ id }) => !reservedSourceIds.has(id),
          )}
          selectedIds={selectedTextIds}
          onChange={(ids) => setBinding('secret.text', ids)}
        />
      ) : (
        schemaFields
          .filter(({ key }) => key.startsWith('secret.'))
          .map((field) => {
            const binding = group.fieldBindings[field.key];
            const sourceFieldId = typeof binding === 'string' ? binding : undefined;
            const existingTarget =
              move &&
              !sourceFieldId &&
              field.sourceFieldId &&
              !fields.some(({ id }) => id === field.sourceFieldId);
            return (
              <Box key={field.key} gap="xs">
                <Text variant="importerFieldLabel">
                  {field.label}
                  {field.required ? ' *' : ''}
                </Text>
                {existingTarget ? (
                  <Text variant="bodySmall" color="gray">
                    Already mapped in the target asset
                  </Text>
                ) : (
                  <SourceFieldPicker
                    field={{
                      ...field,
                      candidates: availableFor(field.key),
                      sourceFieldId,
                      sourceFieldName: fields.find(({ id }) => id === sourceFieldId)?.name,
                    }}
                    onChange={(id) => setBinding(field.key, id)}
                    compactWhenUnmapped
                  />
                )}
                {field.validationError ? (
                  <Text variant="bodySmall" color="danger120">
                    {field.validationError}
                  </Text>
                ) : null}
              </Box>
            );
          })
      )}
      {onRemove ? (
        <Button title="Remove asset group" size="sm" variant="plain" onPress={onRemove} />
      ) : null}
    </Box>
  );
}
