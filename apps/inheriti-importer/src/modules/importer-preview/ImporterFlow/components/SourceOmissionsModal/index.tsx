import { BaseModal, Box, Button, Icon, Text } from '@main-components';
import { groupImportDiagnostics } from '@modules/import/domain/import-diagnostic';
import type { ImportFile } from '../../../SourceImportStatus';
import { ImportDiagnosticCard } from '../../../components/ImportDiagnosticCard';

export function SourceOmissionsModal({
  sources,
  onDismiss,
  onConfirm,
}: {
  sources: Pick<ImportFile, 'id' | 'name' | 'diagnostics'>[];
  onDismiss: () => void;
  onConfirm: () => void;
}) {
  return (
    <BaseModal
      visible
      title="Some source content won’t be imported"
      titleIcon={<Icon name="circle-exclamation" size={20} label="" />}
      onDismiss={onDismiss}
      footer={
        <>
          <Button title="Cancel" color="gray" variant="outlined" onPress={onDismiss} />
          <Button title="Continue import" onPress={onConfirm} />
        </>
      }
    >
      <Text variant="bodyRegular" color="gray">
        Review what was omitted from these sources before continuing.
      </Text>
      {sources.map((source) => (
        <Box key={source.id ?? source.name} gap="s">
          <Text variant="importerSourceName" style={{ overflowWrap: 'anywhere' }}>
            {source.name}
          </Text>
          {groupImportDiagnostics(source.diagnostics).map(([key, diagnostic]) => (
            <ImportDiagnosticCard key={key} {...diagnostic} />
          ))}
        </Box>
      ))}
    </BaseModal>
  );
}
