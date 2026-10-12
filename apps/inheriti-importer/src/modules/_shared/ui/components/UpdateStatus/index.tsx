import { useEffect, useState } from 'react';
import { Box, Text, theme } from '@modules/_shared/ui/components';
import Button from '@modules/_shared/ui/components/Base/Button';

export function UpdateStatus({ className }: { className?: string } = {}) {
  const [version, setVersion] = useState('');
  const [update, setUpdate] = useState<{ id: string; version: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    window.inheriti?.updates
      .check()
      .then(({ version, update, error }) => {
        if (active) {
          setVersion(version);
          setUpdate(update);
          setMessage(error || '');
        }
      })
      .catch(() => {
        if (active) setMessage('Update check unavailable');
      });
    return () => {
      active = false;
    };
  }, []);

  async function install() {
    if (!update || !window.inheriti) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await window.inheriti.updates.install(update.id);
      setMessage(
        result.installed
          ? 'Update installed. Restart Importer to use the new version.'
          : result.openedInstaller
            ? 'Installer opened. Follow its instructions to finish updating.'
            : 'Verified AppImage downloaded. Replace your current AppImage with this file.',
      );
    } catch {
      setMessage('Could not download or verify the update. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!version && !message) return null;
  return (
    <Box
      className={className}
      gap="xs"
      style={{
        paddingTop: theme.spacing.s,
        borderTopWidth: 1,
        borderTopColor: theme.colors.gray30,
      }}
    >
      {version ? (
        <Text variant="bodySmall" color="gray" style={{ fontSize: 12, opacity: 0.8 }}>
          Importer · v{version}
        </Text>
      ) : null}
      {update ? (
        <Text variant="bodySmall" color="primary">
          v{update.version} available
        </Text>
      ) : null}
      {update ? (
        <Button
          title="Get update"
          variant="plain"
          size="sm"
          onPress={() => void install()}
          loading={busy}
        />
      ) : null}
      {message ? (
        <Text variant="bodySmall" color="gray120">
          {message}
        </Text>
      ) : null}
    </Box>
  );
}
