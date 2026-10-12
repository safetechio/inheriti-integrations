import { useState } from 'react';
import { Alert, Box, Text, TextInput } from '@modules/_shared/ui/components';
import Button from '@modules/_shared/ui/components/Base/Button';

type UnlockDialogProps = {
  fileName: string;
  error: string;
  busy: boolean;
  onCancel: () => void;
  onUnlock: (password: string, keyFile?: ArrayBuffer) => Promise<void> | void;
};

export function UnlockDialog({ fileName, error, busy, onCancel, onUnlock }: UnlockDialogProps) {
  const [password, setPassword] = useState('');
  const [keyFile, setKeyFile] = useState<ArrayBuffer | undefined>();
  const [keyFileName, setKeyFileName] = useState('');

  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={(event) => {
          event.preventDefault();
          void onUnlock(password, keyFile);
        }}
      >
        <Text variant="heading3">Unlock KeePass database</Text>
        <Text variant="bodySmall" color="gray">
          {fileName}
        </Text>
        <Alert>{error}</Alert>
        <Box gap="s">
          <Text variant="bodySmall" bold>
            Master password
          </Text>
          <TextInput
            autoFocus
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            style={styles.input}
          />
        </Box>
        <Box gap="s">
          <Text variant="bodySmall" bold>
            Key file (optional)
          </Text>
          <input
            type="file"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) {
                setKeyFile(undefined);
                setKeyFileName('');
                return;
              }
              setKeyFileName(file.name);
              setKeyFile(await file.arrayBuffer());
            }}
          />
          {keyFileName ? (
            <Text variant="bodySmall" color="gray">
              {keyFileName}
            </Text>
          ) : null}
        </Box>
        <Box flexDirection="row" gap="s">
          <Button
            title={busy ? 'Unlocking…' : 'Unlock'}
            disabled={busy}
            onPress={() => {
              void onUnlock(password, keyFile);
            }}
          />
          <Button title="Cancel" variant="plain" onPress={onCancel} />
        </Box>
      </form>
    </div>
  );
}

const styles = {
  input: {
    borderColor: '#D0D5DD',
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 42,
    paddingHorizontal: 12,
  },
} as const;
