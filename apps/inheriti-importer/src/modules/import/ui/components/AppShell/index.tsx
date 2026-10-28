import type { ReactNode } from 'react';
import { BrandLogo } from '@modules/import/ui/components/BrandLogo';
import { Box } from '@modules/_shared/ui/components';
import { AppHeader } from '../AppHeader';
import type { DiscardSummary } from '../DiscardAllControl';

type AppShellProps = {
  dirtyCount: number;
  children: ReactNode;
  accountActionsDisabled?: boolean;
  discardSummary?: DiscardSummary;
  onConfirmDiscardAll?: () => void;
};

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
      style={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)', minHeight: '100vh' }}
    >
      <header className="titlebar">
        <Box className="brand">
          <BrandLogo business className="brand-logo" />
        </Box>
        <AppHeader
          dirtyCount={dirtyCount}
          accountActionsDisabled={accountActionsDisabled}
          discardSummary={discardSummary}
          onConfirmDiscardAll={onConfirmDiscardAll}
        />
      </header>
      {children}
    </Box>
  );
}
