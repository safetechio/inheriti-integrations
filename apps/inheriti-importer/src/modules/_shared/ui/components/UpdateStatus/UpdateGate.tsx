import { createContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Box, Text, theme } from '@modules/_shared/ui/components';
import Button from '@modules/_shared/ui/components/Base/Button';
import { ModalPortal } from '@modules/_shared/ui/components/Base/Portal';

type UpdateBridge = NonNullable<Window['inheriti']>['updates'];
type Update = { id: string; version: string };
export type UpdatePhase = 'checking' | 'required' | 'installing' | 'error' | 'finishing';

export const VersionContext = createContext('');

export function UpdateRequiredScreen({
  phase,
  version,
  message,
  onRetry,
  onInstall,
}: {
  phase: UpdatePhase;
  version?: string;
  message?: string;
  onRetry?: () => void;
  onInstall?: () => void;
}) {
  const title =
    phase === 'checking'
      ? 'Checking for updates'
      : phase === 'installing'
        ? 'Installing update'
        : phase === 'finishing'
          ? 'Finishing update'
          : 'Update required';
  const detail =
    phase === 'checking'
      ? 'Checking the latest Importer version before continuing.'
      : phase === 'required'
        ? `Importer ${version ? `v${version} ` : ''}must be installed before you can continue.`
        : phase === 'installing'
          ? 'Downloading and verifying the update. Keep Importer open.'
          : phase === 'finishing'
            ? 'Finish the installation and reopen Importer to continue.'
            : message || 'The update could not be completed. Retry to continue.';
  return (
    <ModalPortal visible>
      <Box
        accessibilityRole="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 10000,
          backgroundColor: theme.colors.gray10,
          alignItems: 'center',
          justifyContent: 'center',
          padding: theme.spacing.l,
        }}
      >
        <Box
          backgroundColor="white"
          padding="l"
          borderRadius="m"
          gap="m"
          style={{ width: '100%', maxWidth: 480, boxShadow: '0 16px 48px rgba(0,0,0,.16)' }}
        >
          <Text variant="heading2" color="gray120">
            {title}
          </Text>
          <Text variant="bodyRegular" color="gray">
            {detail}
          </Text>
          {phase === 'required' && onInstall ? (
            <Button title="Install and relaunch" onPress={onInstall} />
          ) : null}
          {phase === 'error' && onRetry ? <Button title="Retry update" onPress={onRetry} /> : null}
        </Box>
      </Box>
    </ModalPortal>
  );
}

export function UpdateGate({
  children,
  updates = window.inheriti?.updates,
}: {
  children: ReactNode;
  updates?: UpdateBridge;
}) {
  const [phase, setPhase] = useState<UpdatePhase>('checking');
  const [update, setUpdate] = useState<Update | null>(null);
  const [version, setVersion] = useState('');
  const [message, setMessage] = useState('');
  const [ready, setReady] = useState(false);
  const requestRevision = useRef(0);

  async function check() {
    const revision = ++requestRevision.current;
    setReady(false);
    if (!updates) {
      setPhase('error');
      setMessage('Update service unavailable. Restart Importer and retry.');
      return;
    }
    setPhase('checking');
    try {
      const result = await updates.check();
      if (revision !== requestRevision.current) return;
      setVersion(result.version);
      if (result.error) throw new Error(result.error);
      setUpdate(result.update);
      if (result.update) setPhase('required');
      else setReady(true);
    } catch {
      if (revision !== requestRevision.current) return;
      setPhase('error');
      setMessage('Could not check for updates. Check your connection and retry.');
    }
  }
  useEffect(() => {
    void check();
    return () => {
      requestRevision.current += 1;
    };
  }, [updates]);

  async function install() {
    if (!updates || !update) return;
    const revision = requestRevision.current;
    setPhase('installing');
    try {
      const result = await updates.install(update.id);
      if (revision !== requestRevision.current) return;
      if (!result.installed && !result.openedInstaller) throw new Error('Installation unavailable');
      setPhase('finishing');
    } catch {
      if (revision !== requestRevision.current) return;
      setMessage('Could not install or verify the update. Retry to continue.');
      setPhase('error');
    }
  }

  if (ready) return <VersionContext.Provider value={version}>{children}</VersionContext.Provider>;
  return (
    <UpdateRequiredScreen
      phase={phase}
      version={update?.version}
      message={message}
      onInstall={() => void install()}
      onRetry={() => (update ? void install() : void check())}
    />
  );
}
