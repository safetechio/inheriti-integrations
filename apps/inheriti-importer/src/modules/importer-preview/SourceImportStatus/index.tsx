import { useState } from 'react';
import { Box, Button, FilterChip, Icon, NoItemsPlaceholder, Stack } from '@main-components';
import { FileRow } from './components/FileRow';
import type { SourceImportStatusProps } from './types';
import './styles.css';

export type { ImportFile, ImportFileStatus, SourceImportStatusProps } from './types';

export function SourceImportStatus({
  files,
  onRetry,
  onAddFiles,
  onUnlock,
  onViewWarnings,
  onRemove,
}: SourceImportStatusProps) {
  const [filter, setFilter] = useState<'all' | 'warnings' | 'locked'>('all');
  const warnings = files.filter((file) => file.status === 'warning' && !file.warningsAcknowledged);
  const locked = files.filter(
    (file) => file.status === 'unlock-required' || file.status === 'unlocking',
  );
  const visible = filter === 'warnings' ? warnings : filter === 'locked' ? locked : files;
  const rank = (file: (typeof files)[number]) =>
    file.status === 'unlock-required' || file.status === 'unlocking'
      ? 0
      : file.status === 'warning' && !file.warningsAcknowledged
        ? 1
        : 2;
  return (
    <Stack gap="m" style={{ gap: 12 }}>
      <Box
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        gap="m"
        className="source-import-header"
      >
        <Box flexDirection="row" gap="s" flexWrap="wrap">
          {(
            [
              ['all', 'All', files.length],
              ['warnings', 'Warnings', warnings.length],
              ['locked', 'Locked', locked.length],
            ] as const
          ).map(([id, label, count]) => (
            <FilterChip
              key={id}
              variant="tab"
              count={count}
              selected={filter === id}
              onPress={() => setFilter(id)}
            >
              {label}
            </FilterChip>
          ))}
        </Box>
        <Button
          title="Add files"
          startIcon={<Icon name="plus" size={12} />}
          variant="outlined"
          disabled={!onAddFiles}
          onPress={() => onAddFiles?.()}
        />
      </Box>
      <Stack gap="s" className="source-import-list">
        {!visible.length ? (
          <NoItemsPlaceholder
            description={
              files.length
                ? 'No sources match this filter.'
                : 'No sources selected. Add a supported file to begin.'
            }
          />
        ) : null}
        {[...visible]
          .sort((a, b) => rank(a) - rank(b))
          .map((file) => (
            <FileRow
              key={file.id ?? file.name}
              file={file}
              onRetry={onRetry}
              onUnlock={onUnlock}
              onViewWarnings={onViewWarnings}
              onRemove={onRemove}
            />
          ))}
      </Stack>
    </Stack>
  );
}

export default SourceImportStatus;
