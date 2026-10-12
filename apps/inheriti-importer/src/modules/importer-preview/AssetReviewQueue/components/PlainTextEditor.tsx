import { useEffect, useRef, useState } from 'react';
import { Box, Button, FormTextarea, Text } from '@main-components';
import type { ReviewAsset } from '../types';
import type { AssetReviewQueueProps } from '../types';

export function PlainTextEditor({
  asset,
  onEdit,
  onMapField,
  resolveSourceValue,
}: {
  asset: ReviewAsset;
  onEdit?: (asset: ReviewAsset, value: string) => void;
  onMapField?: AssetReviewQueueProps['onMapField'];
  resolveSourceValue?: AssetReviewQueueProps['resolveSourceValue'];
}) {
  const [revealed, setRevealed] = useState(false);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [value, setValue] = useState('');
  const previousAssetId = useRef(asset.id);
  const textField = asset.schemaFields?.find((field) => field.key === 'secret.text');
  const selectedSource = textField?.candidates?.find(
    (candidate) => candidate.id === textField.sourceFieldId,
  );
  const hasEditedValue = Boolean(asset.plainTextValue);
  const combinedLength = asset.plainTextSources?.every((source) => source.length !== undefined)
    ? asset.plainTextSources.reduce(
        (total, source, index) =>
          total + source.name.length + 2 + source.length! + Number(index > 0),
        0,
      )
    : undefined;
  const hiddenLength =
    asset.plainTextValue?.length ?? selectedSource?.length ?? combinedLength ?? 0;

  useEffect(() => {
    if (previousAssetId.current === asset.id) return;
    previousAssetId.current = asset.id;
    setRevealed(false);
    setSourcePickerOpen(false);
    setValue('');
  }, [asset.id]);

  useEffect(() => {
    const clearOnHidden = () => {
      if (document.visibilityState !== 'hidden') return;
      setRevealed(false);
      setValue('');
    };
    document.addEventListener('visibilitychange', clearOnHidden);
    return () => document.removeEventListener('visibilitychange', clearOnHidden);
  }, []);

  const toggle = () => {
    if (revealed) {
      setRevealed(false);
      setValue('');
      return;
    }
    setValue(
      asset.plainTextValue?.reveal() ??
        (selectedSource
          ? resolveSourceValue?.(selectedSource.id)?.reveal()
          : asset.plainTextSources
              ?.flatMap((source) => {
                const sourceValue = resolveSourceValue?.(source.id);
                return !sourceValue || sourceValue.isEmpty
                  ? []
                  : [`${source.name}: ${sourceValue.reveal()}`];
              })
              .join('\n')) ??
        '',
    );
    setRevealed(true);
  };

  return (
    <Box gap="s">
      <FormTextarea
        label="Plain text secret"
        accessibilityLabel="Plain text value"
        value={
          revealed
            ? value
            : hiddenLength || asset.plainTextSources?.length || selectedSource
              ? '•'.repeat(hiddenLength || 8)
              : ''
        }
        editable={revealed && Boolean(onEdit)}
        error={asset.schemaFields?.find((field) => field.key === 'secret.text')?.validationError}
        onChangeText={(next) => {
          setValue(next);
          onEdit?.(asset, next);
        }}
      />
      <Button
        title={revealed ? 'Hide plain text' : 'Reveal plain text'}
        variant="outlined"
        size="sm"
        onPress={toggle}
      />
      {textField?.candidates && textField.candidates.length > 1 ? (
        <Box gap="xs" className="asset-source-picker">
          <Text variant="smallUppercase" color="gray">
            Value source
          </Text>
          <Text variant="bodySmall" semibold>
            {selectedSource?.name ?? (hasEditedValue ? 'Edited text' : 'All imported fields')}
          </Text>
          <Text variant="bodySmall" color="gray">
            {selectedSource
              ? 'Only this imported value will be stored.'
              : hasEditedValue
                ? 'Your edited value will be stored.'
                : 'Field names and values are combined into the Plain Text secret.'}
          </Text>
          <Button
            title={
              selectedSource || hasEditedValue
                ? 'Use all imported fields'
                : 'Use one imported field'
            }
            variant="outlined"
            size="sm"
            onPress={() => {
              if (selectedSource || hasEditedValue) {
                setRevealed(false);
                setValue('');
                onMapField?.(asset, 'secret.text', undefined);
                return;
              }
              setSourcePickerOpen((current) => !current);
            }}
          />
          {sourcePickerOpen ? (
            <label className="asset-source-select-wrap">
              <span className="asset-source-select-label">Choose imported field</span>
              <select
                className="asset-source-select"
                aria-label="Choose imported field"
                defaultValue=""
                onChange={(event) => {
                  if (!event.target.value) return;
                  setRevealed(false);
                  setSourcePickerOpen(false);
                  setValue('');
                  onMapField?.(asset, 'secret.text', event.target.value);
                }}
              >
                <option value="" disabled>
                  Select a field
                </option>
                {textField.candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name.replace(/^extra:/i, '')}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
