import { BaseModal, Box, Button, Text } from '@main-components';
import type { ImportFile } from '../../types';

export function SourceWarningsModal({
  file,
  onDismiss,
  onUnderstood,
}: {
  file: ImportFile | null;
  onDismiss: () => void;
  onUnderstood: (file: ImportFile) => void;
}) {
  const diagnostics = new Map<
    string,
    { code: string; kind: string; message: string; count: number }
  >();
  for (const { code, count, kind, message } of file?.diagnostics ?? []) {
    const key = JSON.stringify([code, kind, message]);
    const existing = diagnostics.get(key);
    if (existing) existing.count += count;
    else diagnostics.set(key, { code, count, kind, message });
  }
  const detailsOnly = file?.status === 'imported' && diagnostics.size > 0;
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
      description={file?.name}
      onDismiss={onDismiss}
      footer={
        <Button
          title={detailsOnly || file?.warningsAcknowledged ? 'Done' : 'Understood'}
          color="gray"
          onPress={() => {
            if (!file || detailsOnly || file.warningsAcknowledged) onDismiss();
            else onUnderstood(file);
          }}
        />
      }
    >
      <Text variant="bodyRegular" color="gray">
        {detailsOnly
          ? 'The parser transformed some source fields.'
          : skippedFields
            ? 'The source was imported, but these details were skipped:'
            : 'The source was imported. Review these warnings before continuing.'}
      </Text>
      {[...diagnostics.values()].map(({ code, count, kind, message }, index) => (
        <Box key={`${code}:${index}`} gap="xxs">
          <Text variant="bodySmall" semibold>
            {kind === 'unsupported'
              ? 'Unsupported'
              : kind === 'skipped'
                ? 'Skipped'
                : 'Transformed'}{' '}
            · {count}
          </Text>
          <Text variant="bodySmall" color="gray">
            {message}
          </Text>
        </Box>
      ))}
      {file?.warningMessages?.map((warning, index) => (
        <Text key={index} variant="bodySmall" color="gray">
          {warning}
        </Text>
      ))}
    </BaseModal>
  );
}
