import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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

function isFileDrag(event: DragEvent) {
  const transfer = event.dataTransfer;
  return transfer && (transfer.types?.includes('Files') || transfer.files?.length);
}

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
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState(false);
  const surfaceRef = useRef<HTMLElement | null>(null);
  const importAvailability = useRef<symbol | null>(null);
  const onImportRef = useRef(onImport);
  const openingRef = useRef(false);
  const loading = busy || opening;
  const highlighted = over && !loading && !disabled;

  useLayoutEffect(() => {
    onImportRef.current = onImport;
  }, [onImport]);

  useLayoutEffect(() => {
    importAvailability.current = busy || disabled ? null : Symbol();
    if (!importAvailability.current) setOver(false);
    return () => {
      importAvailability.current = null;
    };
  }, [busy, disabled]);

  const openAndImport = useCallback(async (readFiles: () => Promise<OpenedVaultFile[]>) => {
    const availability = importAvailability.current;
    if (!availability || openingRef.current) return;

    openingRef.current = true;
    setOpening(true);
    setOver(false);
    setOpenError(false);
    try {
      const files = await readFiles();
      // Discard reads that outlive the enabled panel.
      if (importAvailability.current === availability && files.length) {
        await onImportRef.current(files);
      }
    } catch {
      if (importAvailability.current === availability) {
        setOpenError(true);
      }
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  }, []);

  useLayoutEffect(() => {
    const element = surfaceRef.current;
    if (!element) return;

    const onDragOver = (event: globalThis.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const canDrop = !!importAvailability.current && !openingRef.current;
      if (event.dataTransfer) event.dataTransfer.dropEffect = canDrop ? 'copy' : 'none';
      setOver(canDrop);
    };
    const onDragLeave = (event: globalThis.DragEvent) => {
      if (event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) return;
      setOver(false);
    };
    const onDrop = (event: globalThis.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      setOver(false);
      const files = event.dataTransfer?.files;
      if (files?.length) void openAndImport(() => filesFromList(files));
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
  }, [openAndImport]);

  return (
    <Box
      className="empty-layout"
      ref={surfaceRef}
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
        className={`dropzone ${highlighted ? 'over' : ''}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          alignItems: 'stretch',
          width: '100%',
          maxWidth: 880,
          gap: uiTheme.spacing.l,
          borderColor: highlighted ? uiTheme.colors.primary : 'transparent',
          borderStyle: highlighted ? 'dashed' : 'solid',
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
              title={loading ? 'Opening…' : 'Choose files'}
              disabled={loading || disabled}
              onPress={async () => {
                const availability = importAvailability.current;
                if (!availability || openingRef.current) return;
                try {
                  const files = await openVaultFiles();
                  if (importAvailability.current === availability && files.length) {
                    await openAndImport(async () => files);
                  }
                } catch {
                  if (importAvailability.current === availability) {
                    setOpenError(true);
                  }
                }
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
        {openError ? (
          <Alert>Could not open the files. Drop them again or use Choose files.</Alert>
        ) : null}
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
