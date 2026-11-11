import type { ReactNode } from 'react';
import { BrandLogo } from '@modules/import/ui/components/BrandLogo';
import { Box } from '@modules/_shared/ui/components';
import { AppHeader } from '../AppHeader';
import { UpdateStatus } from '@modules/_shared/ui/components/UpdateStatus';
import type { DiscardSummary } from '../DiscardAllControl';

type AppShellProps = {
  dirtyCount: number;
  children: ReactNode;
  accountActionsDisabled?: boolean;
  discardSummary?: DiscardSummary;
  onConfirmDiscardAll?: () => void;
};

export function AppVersionBar() {
  return (
    <Box
      backgroundColor="gray10"
      paddingHorizontal="m"
      alignItems="flex-end"
      justifyContent="center"
      style={{ minHeight: 28 }}
    >
      <UpdateStatus />
    </Box>
  );
}

export function AppShell({
  dirtyCount,
  children,
  accountActionsDisabled,
  discardSummary,
  onConfirmDiscardAll,
}: AppShellProps) {
  return (
    <Box
      className="app"
      style={{ display: 'grid', gridTemplateRows: 'auto auto minmax(0, 1fr)', minHeight: '100vh' }}
    >
      <AppVersionBar />
      <Box className="titlebar" accessibilityRole="header">
        <Box className="brand">
          <BrandLogo className="brand-logo" />
        </Box>
        <AppHeader
          dirtyCount={dirtyCount}
          accountActionsDisabled={accountActionsDisabled}
          discardSummary={discardSummary}
          onConfirmDiscardAll={onConfirmDiscardAll}
        />
      </Box>
      {children}
    </Box>
  );
}
