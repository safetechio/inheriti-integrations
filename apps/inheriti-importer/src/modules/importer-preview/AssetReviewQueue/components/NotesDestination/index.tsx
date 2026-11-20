import { Box, FormSelect, Text } from '@main-components';
import { useState } from 'react';
import type { NoteDestination, ReviewBatchResult } from '../../types';

export const noteOptions = [
  { value: 'asset-notes', label: 'Asset notes — visible without revealing the secret' },
  { value: 'protected', label: 'Protected content — requires reveal' },
];

export function NotesDestination({
  scope,
  count,
  destination,
  hasUnchosen,
  onChange,
}: {
  scope: string;
  count: number;
  destination: NoteDestination | null;
  hasUnchosen: boolean;
  onChange: (destination: NoteDestination) => ReviewBatchResult;
}) {
  const [result, setResult] = useState<ReviewBatchResult>();
  return (
    <Box gap="xs" className="importer-review-note-control">
      <FormSelect
        label={`Notes destination · ${scope} · ${count} ${count === 1 ? 'field' : 'fields'}`}
        value={destination ?? ''}
        options={[{ value: '', label: 'Choose where to put notes' }, ...noteOptions]}
        onChange={(value) => {
          if (value === 'asset-notes' || value === 'protected') setResult(onChange(value));
        }}
        helperText={
          hasUnchosen ? 'Unchosen notes stay protected.' : 'Per-asset choices take precedence.'
        }
      />
      {result?.skippedIds.length ? (
        <Text variant="bodySmall" color="gray" role="status">
          {result.skippedIds.length} {result.skippedIds.length === 1 ? 'note' : 'notes'} skipped.
          Protected-only notes stay protected.
        </Text>
      ) : null}
    </Box>
  );
}
