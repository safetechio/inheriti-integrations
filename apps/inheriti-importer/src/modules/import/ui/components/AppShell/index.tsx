import { useContext, type ReactNode } from 'react';
import { BrandLogo } from '@modules/import/ui/components/BrandLogo';
import { Box, Text } from '@modules/_shared/ui/components';
import { AppHeader } from '../AppHeader';
import { VersionContext } from '@modules/_shared/ui/components/UpdateStatus/UpdateGate';
import type { DiscardSummary } from '../DiscardAllControl';

type AppShellProps = {
  dirtyCount: number;
  children: ReactNode;
  accountActionsDisabled?: boolean;
  discardSummary?: DiscardSummary;
  onConfirmDiscardAll?: () => void;
};

export function AppVersionBar() {
  const version = useContext(VersionContext);
  return (
    <Box
      backgroundColor="#303437"
      paddingHorizontal="m"
      flexDirection="row"
      alignItems="center"
      justifyContent="flex-end"
      style={{ minHeight: 28 }}
    >
      {version ? (
        <Text variant="bodySmall" style={{ color: '#F5F5F5', fontSize: 12 }}>
          Version {version}
        </Text>
      ) : null}
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
      <Box
        className="titlebar"
        accessibilityRole="header"
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        flexWrap="wrap"
      >
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
