import { BaseModal, Box, Button, Icon, Text } from '@main-components';
import { groupImportDiagnostics } from '@modules/import/domain/import-diagnostic';
import { ImportDiagnosticCard } from '../../../components/ImportDiagnosticCard';
import type { ImportFile } from '../../types';

export function SourceWarningsModal({
  file,
  onDismiss,
}: {
  file: ImportFile | null;
  onDismiss: () => void;
}) {
  const diagnostics = groupImportDiagnostics(file?.diagnostics);
  const detailsOnly = file?.status === 'imported' && diagnostics.length > 0;
  const skippedFields =
    Boolean(file?.warningMessages?.length) &&
    file?.warningMessages?.every((warning) => /skipped|not imported/i.test(warning));
  return (
    <BaseModal
      visible={Boolean(file)}
      title={
        detailsOnly
          ? 'Source details'
          : skippedFields
            ? 'Some fields weren’t imported'
            : 'Import warnings'
      }
      titleIcon={
        <Icon name={detailsOnly ? 'circle-info' : 'circle-exclamation'} size={20} label="" />
      }
      description={file?.name}
      onDismiss={onDismiss}
      footer={<Button title="Done" color="gray" variant="outlined" onPress={onDismiss} />}
    >
      <Text variant="bodyRegular" color="gray">
        {detailsOnly
          ? 'Review what was skipped or converted, and why.'
          : skippedFields
            ? 'The source was imported. Review what was skipped or converted.'
            : 'The source was imported with warnings.'}
      </Text>
      {diagnostics.map(([key, diagnostic]) => (
        <ImportDiagnosticCard key={JSON.stringify([file?.id ?? file?.name, key])} {...diagnostic} />
      ))}
      {file?.warningMessages?.map((warning, index) => (
        <Box key={index} padding="m" borderWidth={1} borderColor="gray10" borderRadius="s">
          <Text variant="bodySmall" color="gray">
            {warning}
          </Text>
        </Box>
      ))}
    </BaseModal>
  );
}
