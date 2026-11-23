import { useId, useState } from 'react';
import { Badge, Box, Button, Icon, Pressable, Text } from '@main-components';
import { keyboardActivation } from '@modules/_shared/ui/keyboard-activation';
import {
  importDiagnosticCategory,
  type ImportDiagnosticGroup,
} from '@modules/import/domain/import-diagnostic';
import { diagnosticExplanation } from './explanations';

const labels = {
  unsupported: 'Unsupported',
  skipped: 'Skipped',
  transformed: 'Transformed',
  metadata: 'Source metadata',
};
const pageSize = 25;

export function ImportDiagnosticCard({
  code,
  kind,
  count,
  message,
  occurrences = [],
}: Pick<ImportDiagnosticGroup, 'kind' | 'count' | 'message'> &
  Partial<Pick<ImportDiagnosticGroup, 'code' | 'occurrences'>>) {
  const { reason, outcome } = diagnosticExplanation(code, kind);
  const category = importDiagnosticCategory({ code: code ?? '', kind });
  const detailsId = useId();
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const lastPage = Math.max(0, Math.ceil(occurrences.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const start = currentPage * pageSize;
  const toggleDetails = () => {
    setExpanded(!expanded);
    setPage(0);
  };

  return (
    <Box
      gap="xs"
      padding="s"
      borderWidth={1}
      borderColor="gray10"
      borderRadius="s"
      alignItems="flex-start"
    >
      <Badge
        tone={category === 'metadata' ? 'neutral' : kind === 'transformed' ? 'info' : 'warning'}
        size="sm"
      >
        {labels[category]} · {count}
      </Badge>
      <Text variant="bodySmall" color="gray">
        {message}
      </Text>
      {occurrences.length > 0 && (
        <Pressable
          accessibilityRole="button"
          aria-expanded={expanded}
          aria-controls={expanded ? detailsId : undefined}
          onPress={toggleDetails}
          {...keyboardActivation(toggleDetails)}
        >
          <Box flexDirection="row" alignItems="center" gap="xs" paddingVertical="xs">
            <Text variant="buttonSmall" color="primary120">
              {expanded ? 'Hide details' : `View details (${count})`}
            </Text>
            <Box aria-hidden={true}>
              <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={10} />
            </Box>
          </Box>
        </Pressable>
      )}
      {expanded && (
        <Box nativeID={detailsId} alignSelf="stretch" gap="xs">
          <Text variant="bodySmall" color="gray">
            {reason} {outcome}
          </Text>
          <Box accessibilityRole="list" gap="xs">
            {occurrences
              .slice(start, start + pageSize)
              .map(({ entryId, entryName, sourcePath, count }, index) => (
                <Box
                  key={start + index}
                  accessibilityRole="listitem"
                  flexDirection="row"
                  alignItems="center"
                  justifyContent="space-between"
                  gap="s"
                  padding="s"
                  borderWidth={1}
                  borderRadius="s"
                  borderColor="gray10"
                >
                  <Box flex={1} minWidth={0} gap="xxs">
                    {entryName && (
                      <Text variant="bodySmall" style={{ overflowWrap: 'anywhere' }}>
                        {entryName}
                      </Text>
                    )}
                    {(Boolean(sourcePath?.length) || !entryName) && (
                      <Text variant="bodySmall" color="gray" style={{ overflowWrap: 'anywhere' }}>
                        {sourcePath?.join(' › ') ||
                          (entryId ? 'Entry-level detail' : 'Source-level detail')}
                      </Text>
                    )}
                  </Box>
                  <Text variant="bodySmall" color="gray" style={{ flexShrink: 0 }}>
                    {count} {count === 1 ? 'occurrence' : 'occurrences'}
                  </Text>
                </Box>
              ))}
          </Box>
          {lastPage > 0 && (
            <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap="xs">
              <Button
                title="Previous"
                accessibilityLabel="Previous warning details"
                size="sm"
                variant="outlined"
                disabled={currentPage === 0}
                onPress={() => setPage(currentPage - 1)}
              />
              <Text variant="bodySmall" color="gray">
                Page {currentPage + 1} of {lastPage + 1}
              </Text>
              <Button
                title="Next"
                accessibilityLabel="Next warning details"
                size="sm"
                variant="outlined"
                disabled={currentPage === lastPage}
                onPress={() => setPage(currentPage + 1)}
              />
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
