import { useState } from 'react';
import { ImporterFlow } from '@modules/importer-preview/ImporterFlow';
import { SourceWarningsModal } from '@modules/importer-preview/SourceImportStatus/components/SourceWarningsModal';
import type { ImportFile } from '@modules/importer-preview/SourceImportStatus';

const initialFiles: ImportFile[] = [
  { id: 'locked', name: 'vault.kdbx', format: 'KeePass', status: 'unlock-required' },
  {
    id: 'warning',
    name: 'very-long-synthetic-production-vault-export-with-skipped-fields.1pux',
    format: '1Password',
    status: 'warning',
    entries: 12,
    warnings: 1,
    warningMessages: ['A synthetic unsupported field was skipped.'],
  },
  { id: 'imported', name: 'sample.env', format: 'dotenv', status: 'imported', entries: 3 },
  {
    id: 'failed',
    name: 'legacy.csv',
    format: 'CSV',
    status: 'failed',
    detail: 'Synthetic parse error.',
  },
];

export const SyntheticControlledSources = () => {
  const [files, setFiles] = useState(initialFiles);
  const [warning, setWarning] = useState<ImportFile | null>(null);
  const updateFile = (id: string | undefined, update: Partial<ImportFile>) =>
    setFiles((current) => current.map((file) => (file.id === id ? { ...file, ...update } : file)));

  return (
    <>
      <ImporterFlow
        initialStage="sources"
        autoAdvance={false}
        files={files}
        assets={[]}
        unassigned={[]}
        plans={[]}
        checklist={[]}
        callbacks={{
          onUnlockSource: (file, password, keyFile) => {
            updateFile(file.id, { status: 'unlocking', detail: undefined });
            window.setTimeout(
              () =>
                updateFile(
                  file.id,
                  password === 'synthetic-correct' || Boolean(keyFile?.byteLength)
                    ? { status: 'imported', entries: 24, detail: undefined }
                    : {
                        status: 'unlock-required',
                        detail: 'Synthetic password did not match. Try again.',
                      },
                ),
              500,
            );
          },
          onRetrySource: (file) =>
            updateFile(file.id, { status: 'imported', entries: 1, detail: undefined }),
          onViewWarnings: setWarning,
          onRemoveSource: (file) =>
            setFiles((current) => current.filter((item) => item.id !== file.id)),
          onCancel: () => setFiles([]),
        }}
      />
      <SourceWarningsModal
        file={warning}
        onDismiss={() => setWarning(null)}
        onUnderstood={(file) => {
          updateFile(file.id, { warningsAcknowledged: true });
          setWarning(null);
        }}
      />
    </>
  );
};
