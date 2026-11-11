import { useRef, useState, type ReactNode } from 'react';
import { BaseModal, Box, Button, Icon, Text, theme } from '@main-components';
import { BrandLogo } from '@modules/import/ui/components/BrandLogo';
import { AppVersionBar } from '@modules/import/ui/components/AppShell';

export function CancelImportControl({
  fileCount,
  planCount,
  onCancel,
}: {
  fileCount: number;
  planCount: number;
  onCancel?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const cancelOpener = useRef<HTMLElement | null>(null);

  function dismissConfirmation() {
    setConfirming(false);
    queueMicrotask(() => cancelOpener.current?.focus());
  }

  return (
    <>
      <Button
        title="Cancel import"
        startIcon={<Icon name="xmark" size={12} color={theme.colors.danger120} />}
        variant="outlined"
        color="danger"
        size="sm"
        disabled={!onCancel}
        onPress={() => {
          cancelOpener.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setConfirming(true);
        }}
      />
      <BaseModal
        visible={confirming}
        title="Cancel import?"
        description="Your imported sources, reviewed assets and draft plans will be removed. This cannot be undone."
        onDismiss={dismissConfirmation}
        footer={
          <>
            <Button title="Keep importing" variant="plain" onPress={dismissConfirmation} />
            <Button
              title="Cancel import"
              color="danger"
              onPress={() => {
                onCancel?.();
                setConfirming(false);
              }}
            />
          </>
        }
      >
        <Text variant="bodySmall" color="gray">
          {fileCount} imported file{fileCount === 1 ? '' : 's'} · {planCount} plan
          {planCount === 1 ? '' : 's'} will be removed.
        </Text>
      </BaseModal>
    </>
  );
}

export function FlowHeader({ actions }: { actions?: ReactNode }) {
  return (
    <>
      <AppVersionBar />
      <Box
        className="importer-flow-header titlebar"
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
      >
        <BrandLogo />
        {actions}
      </Box>
    </>
  );
}

export default FlowHeader;
