import { useState } from 'react';
import { SourceImportStatus, type ImportFile } from '@modules/importer-preview/SourceImportStatus';
import { FileRow } from '@modules/importer-preview/SourceImportStatus/components/FileRow';
import { SourceWarningsModal } from '@modules/importer-preview/SourceImportStatus/components/SourceWarningsModal';
import { sourceFiles } from './fixtures';

export const SourceReview = () => {
  const [warning, setWarning] = useState<ImportFile | null>(null);
  return (
    <>
      <SourceImportStatus
        files={sourceFiles}
        onViewWarnings={setWarning}
        onRetry={() => undefined}
        onUnlock={() => undefined}
        onAddFiles={() => undefined}
      />
      <SourceWarningsModal
        file={warning}
        onDismiss={() => setWarning(null)}
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
