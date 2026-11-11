import { useEffect, useRef, useState, type ReactNode } from 'react';
import { filesFromList, openVaultFiles } from '@shared/infrastructure/files';
import { type OpenedVaultFile } from '@modules/import/domain/vault';
import { Alert, Box, Text } from '@modules/_shared/ui/components';
import Button from '@modules/_shared/ui/components/Base/Button';
import { useTheme } from '@modules/_shared/ui/theme/AppTheme';

type ImportPanelProps = {
  busy: boolean;
  error: string | null;
  onImport: (files: OpenedVaultFile[]) => Promise<void> | void;
  disabled?: boolean;
  notice?: string;
  onRetry?: () => void;
};

export function ImportPanel({
  busy,
  error,
  onImport,
  disabled = false,
  notice,
  onRetry,
}: ImportPanelProps) {
  const uiTheme = useTheme();
  const [over, setOver] = useState(false);
  const dropzoneRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = dropzoneRef.current;
    if (!element) return;

    const onDragOver = (event: globalThis.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (disabled) return;
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      setOver(true);
    };
    const onDragLeave = (event: globalThis.DragEvent) => {
      if (event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) return;
      setOver(false);
    };
    const onDrop = async (event: globalThis.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setOver(false);
      if (disabled) return;
      const files = event.dataTransfer?.files;
      if (files?.length) await onImport(await filesFromList(files));
    };

    element.addEventListener('dragover', onDragOver);
    element.addEventListener('dragenter', onDragOver);
    element.addEventListener('dragleave', onDragLeave);
    element.addEventListener('drop', onDrop);
    return () => {
      element.removeEventListener('dragover', onDragOver);
      element.removeEventListener('dragenter', onDragOver);
      element.removeEventListener('dragleave', onDragLeave);
      element.removeEventListener('drop', onDrop);
    };
  }, [disabled, onImport]);

  return (
    <Box
      className="empty-layout"
      style={{
        flex: 1,
        minHeight: 'calc(100vh - 64px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
      }}
    >
      <Box
        className={`dropzone ${over ? 'over' : ''}`}
        ref={dropzoneRef}
        style={{
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          alignItems: 'stretch',
          width: '100%',
          maxWidth: 880,
          gap: uiTheme.spacing.l,
          borderColor: over ? uiTheme.colors.primary : 'transparent',
          borderStyle: over ? 'dashed' : 'solid',
          borderWidth: 1,
          borderRadius: uiTheme.radii.l,
          padding: uiTheme.spacing.xl,
          backgroundColor: uiTheme.colors.white,
          boxShadow: '0 18px 50px rgba(15, 16, 72, 0.08)',
        }}
      >
        <Box
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: uiTheme.spacing.l,
            width: '100%',
            opacity: disabled ? 0.35 : 1,
          }}
        >
          <Box alignItems="center" style={{ width: '100%', gap: uiTheme.spacing.l }}>
            <Text variant="heading1" className="dropzone-heading" color="primary150" align="center">
              Import. Review. Protect.
            </Text>
            <Text
              variant="bodyRegular"
              color="primary150"
              className="muted"
              align="center"
              style={{ width: '100%' }}
            >
              Uploaded files are parsed locally, and their data is encrypted on your device before
              secure transmission to Inheriti® Business.
            </Text>
          </Box>
          <Box
            className="source-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: uiTheme.spacing.m,
              marginTop: 0,
              marginBottom: 0,
              width: '100%',
            }}
          >
            <SourceCard kind="keepass" title="KeePass" heading=".kdbx databases">
              Locked or unlocked. Master password and key files are prompted when needed.
            </SourceCard>
            <SourceCard kind="onepassword" title="1Password" heading=".1pux export">
              Import text fields from a 1Password export for review and editing.
            </SourceCard>
            <SourceCard kind="passbolt" title="Passbolt" heading="JSON or CSV export">
              Use Passbolt’s password export. Secrets in the file become editable entries.
            </SourceCard>
            <SourceCard kind="kubernetes" title="Kubernetes" heading="Secret YAML / JSON">
              kubectl get secret -o yaml (or json). Opaque, TLS, dockerconfig, and ConfigMaps.
            </SourceCard>
            <SourceCard kind="vault" title="Vault" heading="HashiCorp KV dump">
              vault kv get -format=json, including KV v1/v2 and multi-path dumps.
            </SourceCard>
            <SourceCard kind="dotenv" title="dotenv" heading=".env files">
              KEY=value environment files, including quoted values and export lines.
            </SourceCard>
            <SourceCard kind="cloud" title="Cloud" heading="AWS, Azure, GCP">
              Secrets Manager, Key Vault, and Secret Manager JSON from get-secret-value / secret
              show.
            </SourceCard>
          </Box>
          <Box className="choose-files-action" alignItems="center">
            <Button
              title={busy ? 'Opening…' : 'Choose files'}
              disabled={busy || disabled}
              onPress={async () => {
                if (busy || disabled) return;
                await onImport(await openVaultFiles());
              }}
            />
          </Box>
        </Box>
        {notice ? (
          <Box
            role="status"
            style={{
              position: 'absolute',
              top: '50%',
              left: 0,
              right: 0,
              transform: 'translateY(-50%)',
              alignItems: 'center',
              gap: uiTheme.spacing.s,
              padding: uiTheme.spacing.m,
              backgroundColor: uiTheme.colors.white,
              borderTopWidth: 1,
              borderBottomWidth: 1,
              borderColor: uiTheme.colors.gray10,
            }}
          >
            <Text variant="bodyRegular" color="primary150" align="center">
              {notice}
            </Text>
            {onRetry ? <Button title="Retry" onPress={onRetry} /> : null}
          </Box>
        ) : null}
        {error ? <Alert>{error}</Alert> : null}
      </Box>
    </Box>
  );
}

function SourceCard({
  kind,
  title,
  heading,
  children,
}: {
  kind: string;
  title: string;
  heading: string;
  children: ReactNode;
}) {
  const uiTheme = useTheme();
  return (
    <Box
      className="source-card"
      gap="xs"
      style={{
        minHeight: 150,
        padding: uiTheme.spacing.m,
        borderColor: uiTheme.colors.gray10,
        borderWidth: 1,
        borderRadius: uiTheme.radii.m,
        backgroundColor: uiTheme.colors.primary5,
      }}
    >
      <Text
        variant="smallUppercase"
        className={`kind ${kind}`}
        style={{ color: uiTheme.colors.primary150 }}
      >
        {title}
      </Text>
      <Text variant="heading3" color="primary150">
        {heading}
      </Text>
      <Text variant="bodySmall" color="primary150">
        {children}
      </Text>
    </Box>
  );
}
