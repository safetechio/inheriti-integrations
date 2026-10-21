import { useEffect, useState } from 'react';
import { Box, Button, Text } from '@main-components';
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
      <Text variant="bodySmall" color="gray">
        No matching source fields
      </Text>
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
            <Text variant="smallUppercase" color="gray">
              Imported source
            </Text>
            <Text variant="bodySmall" semibold>
              {field.sourceFieldName ? displayName(field.sourceFieldName) : 'Not included'}
            </Text>
          </Box>
        ) : null}
        <Box flexDirection="row" gap="xs">
          {field.sourceFieldId ? (
            <Button
              title="Remove"
              variant="plain"
              color="danger"
              size="sm"
              onPress={() => onChange(undefined)}
              accessibilityLabel={`Remove ${field.label} from this Asset`}
            />
          ) : null}
          <Button
            title={open ? 'Close' : field.sourceFieldId ? 'Change' : 'Choose source'}
            variant="outlined"
            size="sm"
            onPress={() => setOpen((current) => !current)}
            accessibilityLabel={`${field.sourceFieldId ? 'Change' : 'Choose'} ${field.label} source field`}
          />
        </Box>
      </Box>
      {open ? (
        <Box gap="xs" className="asset-source-options">
          {candidates.map((candidate: ReviewAssetSourceCandidate) => (
            <Button
              key={candidate.id}
              title={displayName(candidate.name)}
              variant={candidate.id === field.sourceFieldId ? 'contained' : 'outlined'}
              size="sm"
              block
              onPress={() => {
                onChange(candidate.id);
                setOpen(false);
              }}
              accessibilityLabel={`Map ${field.label} to ${displayName(candidate.name)}`}
            />
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
