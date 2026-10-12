import { Button, Icon, NoItemsPlaceholder, PanelHeader, Stack, Text } from '@main-components';
import { FileRow } from './components/FileRow';
import type { SourceImportStatusProps } from './types';
import './styles.css';

export type { ImportFile, ImportFileStatus, SourceImportStatusProps } from './types';

export function SourceImportStatus({
  files,
  description,
  onRetry,
  onAddFiles,
  onUnlock,
  onViewWarnings,
  onRemove,
}: SourceImportStatusProps) {
  return (
    <Stack gap="m" style={{ gap: 12 }}>
      <PanelHeader
        title="Imported sources"
        actions={
          <Button
            title="Add files"
            startIcon={<Icon name="plus" size={12} />}
            variant="outlined"
            disabled={!onAddFiles}
            onPress={() => onAddFiles?.()}
          />
        }
      >
        {description ? (
          <Text variant="bodySmall" color="gray" style={{ fontSize: 13, opacity: 0.8 }}>
            {description}
          </Text>
        ) : null}
      </PanelHeader>
      <Stack gap="s" className="source-import-list">
        {!files.length ? (
          <NoItemsPlaceholder description="No sources selected. Add a supported file to begin." />
        ) : null}
        {files.map((file) => (
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
