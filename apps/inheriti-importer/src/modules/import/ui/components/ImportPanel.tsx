import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BrandLogo } from '@modules/import/ui/components/BrandLogo';
import { filesFromList, openVaultFiles } from '@shared/infrastructure/files';
import { type OpenedVaultFile } from '@modules/import/domain/vault';
import { Alert, Box, Text } from '@modules/_shared/ui/components';
import Button from '@modules/_shared/ui/components/Base/Button';
import { useTheme } from '@modules/_shared/ui/theme/AppTheme';

type ImportPanelProps = {
  busy: boolean;
  error: string | null;
  onImport: (files: OpenedVaultFile[]) => Promise<void> | void;
};

export function ImportPanel({ busy, error, onImport }: ImportPanelProps) {
  const uiTheme = useTheme();
  const [over, setOver] = useState(false);
  const dropzoneRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = dropzoneRef.current;
    if (!element) return;

    const onDragOver = (event: globalThis.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
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
  }, [onImport]);

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
        <Box alignItems="center" style={{ width: '100%', gap: uiTheme.spacing.l }}>
          <BrandLogo mark className="hero-mark" style={{ margin: 0 }} />
          <Text
            variant="heading1"
            className="dropzone-heading"
            color="primary200"
            align="center"
            style={{ width: '100%', maxWidth: 760, margin: 0, fontSize: 32, lineHeight: 1.15 }}
          >
            Import your secrets, then{' '}
            <Text
              variant="heading1"
              color="primary"
              style={{ fontStyle: 'italic', fontSize: 32, lineHeight: 1.15 }}
            >
              review them
            </Text>
            .
          </Text>
          <Text
            variant="bodyRegular"
            color="gray"
            className="muted"
            align="center"
            style={{ width: '100%' }}
          >
            Files are parsed locally. Nothing leaves this computer until you choose Encrypt and
            stage. At that point, fields are encrypted locally before transmission to Inheriti®
            Business.
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
            Secrets Manager, Key Vault, and Secret Manager JSON from get-secret-value / secret show.
          </SourceCard>
        </Box>
        <Box className="choose-files-action" alignItems="center">
          <Button
            title={busy ? 'Opening…' : 'Choose files'}
            disabled={busy}
            onPress={async () => onImport(await openVaultFiles())}
          />
        </Box>
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
  const kindColors: Record<string, string> = {
    keepass: uiTheme.colors.primary120,
    onepassword: uiTheme.colors.primary,
    passbolt: uiTheme.colors.primary150,
    kubernetes: '#326CE5',
    vault: '#8A6D00',
    dotenv: uiTheme.colors.success120,
    cloud: uiTheme.colors.primary,
  };
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
      <Text variant="smallUppercase" className={`kind ${kind}`} style={{ color: kindColors[kind] }}>
        {title}
      </Text>
      <Text variant="heading3" color="gray120">
        {heading}
      </Text>
      <Text variant="bodySmall" color="gray">
        {children}
      </Text>
    </Box>
  );
}
