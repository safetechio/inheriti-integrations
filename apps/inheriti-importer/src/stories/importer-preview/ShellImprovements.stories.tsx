import { useEffect, useRef } from 'react';
import { BrandLogo } from '@modules/import/ui/components/BrandLogo';
import { SignInGate } from '@modules/auth/ui/components/SignInGate';
import { AppShell } from '@modules/import/ui/components/AppShell';
import { ImportPanel } from '@modules/import/ui/components/ImportPanel';
import { Box } from '@modules/_shared/ui/components';
import { ShellFixture } from './shell-fixtures';

const noop = async () => undefined;

export const ImporterBrand = () => (
  <Box padding="xl" alignItems="flex-start">
    <BrandLogo />
  </Box>
);
export const SignIn = () => (
  <SignInGate
    status="signed-out"
    message={null}
    loginInProgress={false}
    accounts={[]}
    onActivateAccount={noop}
    onLogin={noop}
    onCancel={noop}
  />
);
export const SavedAccount = () => (
  <SignInGate
    status="signed-out"
    message={null}
    loginInProgress={false}
    accounts={[{ key: 'demo-account', subject: 'demo-subject', active: false }]}
    onActivateAccount={noop}
    onLogin={noop}
    onCancel={noop}
  />
);
export const SignInChecking = () => (
  <SignInGate
    status="checking"
    message={null}
    loginInProgress={false}
    accounts={[]}
    onActivateAccount={noop}
    onLogin={noop}
    onCancel={noop}
  />
);
export const SignInSwitching = () => (
  <SignInGate
    status="switching"
    message={null}
    loginInProgress={false}
    accounts={[]}
    onActivateAccount={noop}
    onLogin={noop}
    onCancel={noop}
  />
);
export const SignInError = () => (
  <SignInGate
    status="error"
    message="Unable to sign in. Try again."
    loginInProgress={false}
    accounts={[]}
    onActivateAccount={noop}
    onLogin={noop}
    onCancel={noop}
  />
);

function LandingShell({ openMenu }: { openMenu?: 'account' | 'organization' }) {
  const frame = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!openMenu) return;
    const selector =
      openMenu === 'account'
        ? '[aria-label^="Open account menu"]'
        : '[aria-label^="Change organisation"]';
    const frameId = requestAnimationFrame(() =>
      frame.current?.querySelector<HTMLElement>(selector)?.click(),
    );
    return () => cancelAnimationFrame(frameId);
  }, [openMenu]);
  return (
    <ShellFixture>
      <Box ref={frame}>
        <AppShell dirtyCount={0}>
          <ImportPanel busy={false} error={null} onImport={noop} />
        </AppShell>
      </Box>
    </ShellFixture>
  );
}

export const Landing = () => <LandingShell />;
export const AccountMenuOpen = () => <LandingShell openMenu="account" />;
export const OrganizationMenuOpen = () => <LandingShell openMenu="organization" />;
