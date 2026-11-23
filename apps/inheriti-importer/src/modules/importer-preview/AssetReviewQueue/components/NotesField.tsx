import { Box, Button, ChoiceGroup, Icon, Text } from '@main-components';
import { useState } from 'react';
import { SourceFieldPicker } from './SourceFieldPicker';
import { noteOptions } from './NotesDestination';
import type { ImportReviewControls } from '../import-review-controls';
import type { NoteDestination, ReviewAsset, ReviewAssetField } from '../types';
import type { SensitiveValue } from '@modules/import/domain/import-model';

export function NotesField({
  asset,
  assets = [],
  onInspect,
  field,
  onMapField,
  resolveSourceValue,
  onSetNoteDestination,
}: {
  asset: ReviewAsset;
  assets?: ReviewAsset[];
  onInspect?: (asset: ReviewAsset) => void;
  field?: ReviewAssetField;
  onMapField?: (asset: ReviewAsset, targetField: string, sourceFieldId?: string) => void;
  resolveSourceValue?: (sourceFieldId: string) => SensitiveValue | undefined;
  onSetNoteDestination?: ImportReviewControls['onSetAssetNoteDestination'];
}) {
  const [skipped, setSkipped] = useState(0);
  const note = asset.note;
  const selectDestination = (value: NoteDestination) => {
    if (onSetNoteDestination) setSkipped(onSetNoteDestination(asset, value).skippedIds.length);
  };
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
        dataSet={{ reviewField: 'meta.notes' }}
        tabIndex={-1}
      >
        <Text variant="importerFieldLabel">{field?.label ?? 'Notes'}</Text>
        {picker}
        {field?.validationError ? (
          <Text variant="bodySmall" color="danger120">
            {field.validationError}
          </Text>
        ) : null}
      </Box>
    );

  const visibleOutsideSecret =
    !note || (note.destination === 'asset-notes' && (note.explicit || note.inherited));
  const sourceFieldId = note?.sourceFieldId ?? field?.sourceFieldId;
  const holdsNote = (candidate: ReviewAsset) =>
    candidate.status !== 'excluded' &&
    (candidate.schemaFields?.some(
      (field) => field.key.startsWith('secret.') && field.sourceFieldId === note?.sourceFieldId,
    ) ||
      candidate.plainTextSources?.some(({ id }) => id === note?.sourceFieldId));
  const storedHere = Boolean(note && !visibleOutsideSecret && holdsNote(asset));
  const destination =
    note && !visibleOutsideSecret && !storedHere && asset.sourceId && asset.sourceNodeId
      ? assets.find(
          (candidate) =>
            candidate.sourceId === asset.sourceId &&
            candidate.sourceNodeId === asset.sourceNodeId &&
            holdsNote(candidate),
        )
      : undefined;
  const otherPublicSourceId =
    note && field?.sourceFieldId && field.sourceFieldId !== note.sourceFieldId
      ? field.sourceFieldId
      : undefined;
  return (
    <Box
      gap="s"
      className="asset-metadata-section importer-review-note-control"
      dataSet={{ reviewField: 'meta.notes' }}
      tabIndex={-1}
    >
      <Box gap="s" className="asset-schema-field-row">
        {note && onSetNoteDestination ? (
          <ChoiceGroup
            label="Notes destination for this asset"
            value={note.explicit ? note.destination : null}
            options={noteOptions.filter(({ value }) => note.publicAllowed || value === 'protected')}
            disabled={asset.status === 'excluded'}
            helperText={
              note.publicAllowed
                ? note.inherited
                  ? `Current destination: ${note.destination === 'asset-notes' ? 'Asset notes' : 'As secret'}. Choose an option to set it for this asset.`
                  : note.explicit
                    ? 'Per-asset choice'
                    : 'Protected while you decide.'
                : note.reason
            }
            onChange={selectDestination}
            onReselect={selectDestination}
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
        ) : destination && onInspect ? (
          <Box alignSelf="flex-start">
            <Button
              title={`Open ${destination.name}`}
              endIcon={<Icon name="arrow-right" size={11} label="" />}
              variant="plain"
              size="sm"
              paddingHorizontal={0}
              onPress={() => onInspect(destination)}
            />
          </Box>
        ) : (
          <Text variant="bodySmall" color="gray">
            {storedHere
              ? 'These notes are stored in this asset’s secret.'
              : 'Choose a destination for these protected notes.'}
          </Text>
        )}
        {!note ? (
          <Text variant="bodySmall" color="gray">
            Asset notes are visible in plan details.
          </Text>
        ) : null}
        {!note && picker ? <Box className="asset-metadata-source">{picker}</Box> : null}
        {otherPublicSourceId ? (
          <Box gap="xs">
            <Text variant="bodySmall" color="gray">
              Another source field is mapped to Asset notes.
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
