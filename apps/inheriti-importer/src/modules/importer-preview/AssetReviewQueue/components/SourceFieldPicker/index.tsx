import { useEffect, useRef, useState } from 'react';
import { Box, Button, ScrollableTabs, Text } from '@main-components';
import type { ReviewAssetField } from '../../types';
import { sourceFieldDisplayName } from '../../source-field-coverage';

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
  const toggleRef = useRef<HTMLElement>(null);
  const candidates = field.candidates ?? [];
  useEffect(() => setOpen(false), [field.key, field.sourceFieldId]);
  if (candidates.length === 0)
    return (
      <Box gap="xxs" className="asset-source-picker">
        <Text variant="bodySmall" color="gray" style={{ fontSize: 11 }}>
          source
        </Text>
        <Text variant="bodySmall" semibold>
          —
        </Text>
      </Box>
    );

  return (
    <Box
      gap="xs"
      className="asset-source-picker"
      onKeyDownCapture={(event: KeyboardEvent) => {
        if (!open || event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        toggleRef.current?.querySelector<HTMLElement>('[role="button"]')?.focus();
      }}
    >
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
              source
            </Text>
            <Text variant="bodySmall" semibold className="asset-source-field-label">
              {field.sourceFieldName ? sourceFieldDisplayName(field.sourceFieldName) : '—'}
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
          <Box ref={toggleRef} dataSet={{ reviewSourceToggle: '' }}>
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
      </Box>
      {open ? (
        <Box className="asset-source-options">
          <ScrollableTabs
            label={`${field.label} source fields`}
            variant="pill"
            scrollLabel="source fields"
            value={field.sourceFieldId ?? ''}
            tabs={candidates.map((candidate) => {
              const label = sourceFieldDisplayName(candidate.name);
              return {
                value: candidate.id,
                label,
                accessibilityLabel: `Map ${field.label} to ${label}`,
              };
            })}
            onChange={(sourceFieldId) => {
              onChange(sourceFieldId);
              setOpen(false);
            }}
          />
        </Box>
      ) : null}
    </Box>
  );
}
