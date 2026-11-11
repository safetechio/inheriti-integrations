import { useState } from 'react';
import { SourceImportStatus, type ImportFile } from '@modules/importer-preview/SourceImportStatus';
import { FileRow } from '@modules/importer-preview/SourceImportStatus/components/FileRow';
import { SourceWarningsModal } from '@modules/importer-preview/SourceImportStatus/components/SourceWarningsModal';
import { sourceFiles } from './fixtures';

export const SourceReview = () => {
  const [warning, setWarning] = useState<ImportFile | null>(null);
  const [acknowledged, setAcknowledged] = useState<string[]>([]);
  return (
    <>
      <SourceImportStatus
        files={sourceFiles.map((file) => ({
          ...file,
          warningsAcknowledged: acknowledged.includes(file.name),
        }))}
        onViewWarnings={setWarning}
        onRetry={() => undefined}
        onUnlock={() => undefined}
        onAddFiles={() => undefined}
      />
      <SourceWarningsModal
        file={warning}
        onDismiss={() => setWarning(null)}
        onUnderstood={(file) => {
          setAcknowledged((current) => [...current, file.name]);
          setWarning(null);
        }}
      />
    </>
  );
};
export const SourceWarnings = () => (
  <SourceWarningsModal
    file={{
      id: 'synthetic-warning',
      name: 'sample-export.1pux',
      format: '1Password',
      status: 'warning',
      warnings: 2,
      warningMessages: [
        'Credit Card: “valid from” was not imported.',
        'Identity: “birth date” was not imported.',
      ],
    }}
    onDismiss={() => undefined}
    onUnderstood={() => undefined}
  />
);
export const SourceUnlock = () => (
  <FileRow
    file={{
      id: 'synthetic-locked',
      name: 'production-database-with-a-long-name.kdbx',
      format: 'KeePass',
      status: 'unlock-required',
    }}
    initiallyShowUnlock
    onUnlock={() => undefined}
  />
);
