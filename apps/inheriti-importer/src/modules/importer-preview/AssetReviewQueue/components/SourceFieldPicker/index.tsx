import { useEffect, useState } from 'react';
import { Box, Button, FilterChip, Text } from '@main-components';
import type { ReviewAssetField, ReviewAssetSourceCandidate } from '../../types';

export function SourceFieldPicker({
  field,
  onChange,
  compactWhenUnmapped = false,
}: {
  field: ReviewAssetField;
  onChange: (sourceFieldId?: string) => void;
  compactWhenUnmapped?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const candidates = field.candidates ?? [];
  const displayName = (name: string) => name.replace(/^extra:/i, '');
  useEffect(() => setOpen(false), [field.key, field.sourceFieldId]);
  if (candidates.length === 0)
    return (
      <Box gap="xxs" className="asset-source-picker">
        <Text variant="bodySmall" color="gray" style={{ fontSize: 11 }}>
          Source
        </Text>
        <Text variant="bodySmall" semibold>
          —
        </Text>
      </Box>
    );

  return (
    <Box gap="xs" className="asset-source-picker">
      <Box
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        gap="s"
        style={{ flexWrap: 'wrap' }}
      >
        {field.sourceFieldId || !compactWhenUnmapped ? (
          <Box gap="xxs">
            <Text variant="bodySmall" color="gray" style={{ fontSize: 11 }}>
              Source
            </Text>
            <Text variant="bodySmall" semibold>
              {field.sourceFieldName ? displayName(field.sourceFieldName) : '—'}
            </Text>
          </Box>
        ) : null}
        <Box flexDirection="row" gap="xs">
          {field.sourceFieldId ? (
            <Button
              title="Exclude"
              variant="plain"
              color="danger"
              size="sm"
              onPress={() => onChange(undefined)}
              accessibilityLabel={`Exclude ${field.label} field from this Asset`}
            />
          ) : null}
          <Button
            title={open ? 'Close' : field.sourceFieldId ? 'Change source' : 'Choose source'}
            variant="outlined"
            color="gray"
            size="sm"
            onPress={() => setOpen((current) => !current)}
            accessibilityLabel={`${field.sourceFieldId ? 'Change' : 'Choose'} ${field.label} source field`}
          />
        </Box>
      </Box>
      {open ? (
        <Box flexDirection="row" flexWrap="wrap" gap="xs" className="asset-source-options">
          {candidates.map((candidate: ReviewAssetSourceCandidate) => (
            <FilterChip
              key={candidate.id}
              variant="pill"
              selected={candidate.id === field.sourceFieldId}
              onPress={() => {
                onChange(candidate.id);
                setOpen(false);
              }}
              accessibilityLabel={`Map ${field.label} to ${displayName(candidate.name)}`}
            >
              {displayName(candidate.name)}
            </FilterChip>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
