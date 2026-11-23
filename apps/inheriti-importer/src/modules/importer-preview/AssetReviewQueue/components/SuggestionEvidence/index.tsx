import { useId, useState } from 'react';
import { Box, Button, Text } from '@main-components';
import type { ReviewAsset } from '../../types';

const reasons: Record<string, string> = {
  'native-role': 'The source identifies the field role.',
  'specific-anchor': 'A specific field name identifies the asset.',
  'recognized-format': 'The value matches a supported format.',
  'matching-context': 'Related fields share a section or prefix.',
  'ambiguous-fields': 'Some field names are ambiguous and need review.',
  'competing-types': 'More than one supported type may fit.',
  'invalid-field': 'An invalid optional field was left unassigned.',
};

export function SuggestionEvidence({ asset }: { asset: ReviewAsset }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const evidence = [...new Set(asset.suggestionEvidence ?? [])].flatMap(
    (key) => reasons[key] ?? [],
  );
  if (!evidence.length) return null;
  return (
    <Box gap="xs">
      <Button
        title={open ? 'Hide suggestion reasons' : 'Why this suggestion?'}
        size="sm"
        variant="plain"
        onPress={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
      />
      {open ? (
        <Box
          nativeID={id}
          gap="xs"
          padding="s"
          borderWidth={1}
          borderColor="primary10"
          backgroundColor="primary4"
          borderRadius="s"
        >
          {evidence.map((reason) => (
            <Text key={reason} variant="bodySmall" color="gray">
              {reason}
            </Text>
          ))}
          <Text variant="bodySmall">
            {asset.mapped.length} mapped · {asset.unmapped.length} unassigned
          </Text>
          <Text variant="xSmall" color="gray">
            These signals explain the proposal; they are not an accuracy percentage.
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
