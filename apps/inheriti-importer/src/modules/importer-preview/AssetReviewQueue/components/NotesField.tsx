import { Box, Button, FormSelect, Text } from '@main-components';
import { useState } from 'react';
import { SourceFieldPicker } from './SourceFieldPicker';
import { ProtectedSourceValue } from './ProtectedSourceValue';
import { noteOptions } from './NotesDestination';
import type { ImportReviewControls } from '../import-review-controls';
import type { ReviewAsset, ReviewAssetField } from '../types';
import type { SensitiveValue } from '@modules/import/domain/import-model';

export function NotesField({
  asset,
  field,
  onMapField,
  resolveSourceValue,
  onSetNoteDestination,
}: {
  asset: ReviewAsset;
  field?: ReviewAssetField;
  onMapField?: (asset: ReviewAsset, targetField: string, sourceFieldId?: string) => void;
  resolveSourceValue?: (sourceFieldId: string) => SensitiveValue | undefined;
  onSetNoteDestination?: ImportReviewControls['onSetAssetNoteDestination'];
}) {
  const [skipped, setSkipped] = useState(0);
  const note = asset.note;
  const picker = field ? (
    <SourceFieldPicker
      field={field}
      compactWhenUnmapped
      onChange={(sourceFieldId) => onMapField?.(asset, field.key, sourceFieldId)}
    />
  ) : null;
  if (!note && !field?.sourceFieldId)
    return (
      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        gap="s"
        className="asset-metadata-section"
      >
        <Text variant="importerFieldLabel">{field?.label ?? 'Notes'}</Text>
        {picker}
      </Box>
    );

  const visibleOutsideSecret =
    !note || (note.destination === 'asset-notes' && (note.explicit || note.inherited));
  const sourceFieldId = note?.sourceFieldId ?? field?.sourceFieldId;
  const otherPublicSourceId =
    note && field?.sourceFieldId && field.sourceFieldId !== note.sourceFieldId
      ? field.sourceFieldId
      : undefined;
  return (
    <Box gap="s" className="asset-metadata-section importer-review-note-control">
      <Box gap="s" className="asset-schema-field-row">
        {note && onSetNoteDestination ? (
          <FormSelect
            label="Notes destination for this asset"
            value={note.explicit && !note.inherited ? note.destination : ''}
            options={[
              ...(!note.explicit || note.inherited
                ? [
                    {
                      value: '',
                      label: note.inherited
                        ? `Source choice — ${note.destination === 'asset-notes' ? 'Asset notes' : 'Protected content'}`
                        : 'Choose where to put notes',
                    },
                  ]
                : []),
              ...noteOptions.filter(({ value }) => note.publicAllowed || value === 'protected'),
            ]}
            disabled={asset.status === 'excluded'}
            helperText={
              note.publicAllowed
                ? note.inherited
                  ? 'Choose a destination to override the source choice.'
                  : note.explicit
                    ? 'Per-asset choice'
                    : 'Protected while you decide.'
                : note.reason
            }
            onChange={(value) => {
              if (value === 'asset-notes' || value === 'protected')
                setSkipped(onSetNoteDestination(asset, value).skippedIds.length);
            }}
          />
        ) : (
          <Text variant="importerFieldLabel" semibold>
            {field?.label ?? 'Notes'}
          </Text>
        )}
        {skipped ? (
          <Text variant="bodySmall" color="gray" role="status">
            Notes destination could not be changed.
          </Text>
        ) : null}
        {sourceFieldId && visibleOutsideSecret ? (
          <Text variant="bodySmall" className="asset-metadata-preview">
            {resolveSourceValue?.(sourceFieldId)?.reveal() ?? 'Value unavailable'}
          </Text>
        ) : (
          <ProtectedSourceValue
            key={sourceFieldId}
            fieldLabel={field?.label ?? 'Notes'}
            sourceFieldId={sourceFieldId}
            resolveSourceValue={resolveSourceValue}
          />
        )}
        {!note || visibleOutsideSecret ? (
          <Text variant="bodySmall" color="gray">
            Asset notes are visible without revealing the secret.
          </Text>
        ) : null}
        {!note && picker ? <Box className="asset-metadata-source">{picker}</Box> : null}
        {otherPublicSourceId ? (
          <Box gap="xs">
            <Text variant="bodySmall" color="gray">
              Another source field is mapped to Asset notes and is visible without revealing the
              secret.
            </Text>
            <Text variant="bodySmall" className="asset-metadata-preview">
              {resolveSourceValue?.(otherPublicSourceId)?.reveal() ?? 'Value unavailable'}
            </Text>
            {onMapField && field ? (
              <Button
                title="Clear Asset notes mapping"
                variant="plain"
                size="sm"
                onPress={() => onMapField(asset, field.key, undefined)}
              />
            ) : null}
          </Box>
        ) : null}
        {field?.validationError ? (
          <Text variant="bodySmall" color="danger120">
            {field.validationError}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
}
