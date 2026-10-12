import { useRef, useState } from 'react';
import { Badge, BaseModal, Box, Button, Icon, Text, theme } from '@main-components';
import { BrandLogo } from '@modules/import/ui/components/BrandLogo';

export function FlowHeader({
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
      <Box
        className="importer-flow-header"
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
      >
        <Box flexDirection="row" alignItems="center" gap="m">
          <BrandLogo />
          <Text className="importer-flow-product" variant="importerProduct">
            Import
          </Text>
        </Box>
        <Box flexDirection="row" alignItems="center" gap="m">
          <Badge tone="primary" variant="outline" size="lg" uppercase>
            Local draft
          </Badge>
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
        </Box>
      </Box>
      <BaseModal
        visible={confirming}
        title="Cancel import?"
        description="This clears every imported file, mapping, review decision, Plan draft, and Organization Key operation in this session. It cannot be undone."
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
          {fileCount} imported file{fileCount === 1 ? '' : 's'} · {planCount} Plan
          {planCount === 1 ? '' : 's'} will be removed.
        </Text>
      </BaseModal>
    </>
  );
}

export default FlowHeader;
