import { BaseModal, Button, Text } from '@main-components';
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
  const skippedFields =
    Boolean(file?.warningMessages?.length) &&
    file?.warningMessages?.every((warning) => /skipped|not imported/i.test(warning));
  return (
    <BaseModal
      visible={Boolean(file)}
      title={skippedFields ? 'Some fields weren’t imported' : 'Import warnings'}
      description={file?.name}
      onDismiss={onDismiss}
      footer={
        <Button
          title="Understood"
          color="gray"
          onPress={() => {
            if (file) onUnderstood(file);
          }}
        />
      }
    >
      <Text variant="bodyRegular" color="gray">
        {skippedFields
          ? 'The source was imported, but these details were skipped:'
          : 'The source was imported. Review these warnings before continuing.'}
      </Text>
      {file?.warningMessages?.map((warning, index) => (
        <Text key={index} variant="bodySmall" color="gray">
          {warning}
        </Text>
      ))}
    </BaseModal>
  );
}
