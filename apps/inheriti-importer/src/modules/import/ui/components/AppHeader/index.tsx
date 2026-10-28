import { useEffect, useRef, useState } from 'react';
import { Box, Text } from '@modules/_shared/ui/components';
import { DiscardAllControl, type DiscardSummary } from '../DiscardAllControl';
import { OrganizationMenu } from '../OrganizationMenu';
import { AccountMenu } from '../AccountMenu';

export function AppHeader({
  dirtyCount,
  accountActionsDisabled,
  discardSummary,
  onConfirmDiscardAll,
}: {
  dirtyCount: number;
  accountActionsDisabled?: boolean;
  discardSummary?: DiscardSummary;
  onConfirmDiscardAll?: () => void;
}) {
  const [organizationMenuOpen, setOrganizationMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const organizationMenuRef = useRef<HTMLDivElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);

  function closeOrganizationMenu(returnFocus = true) {
    setOrganizationMenuOpen(false);
    if (returnFocus)
      organizationMenuRef.current?.querySelector<HTMLElement>('[role="button"]')?.focus();
  }

  function closeAccountMenu(returnFocus = true) {
    setAccountMenuOpen(false);
    if (returnFocus) accountMenuRef.current?.querySelector<HTMLElement>('[role="button"]')?.focus();
  }

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return;
      if (organizationMenuOpen && !organizationMenuRef.current?.contains(event.target)) {
        closeOrganizationMenu();
      }
      if (accountMenuOpen && !accountMenuRef.current?.contains(event.target)) closeAccountMenu();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (organizationMenuOpen) closeOrganizationMenu();
      if (accountMenuOpen) closeAccountMenu();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [organizationMenuOpen, accountMenuOpen]);

  return (
    <Box className="app-header-actions" flexDirection="row" alignItems="center" gap="m">
      {dirtyCount > 0 ? <Text className="phase-pill">{dirtyCount} edited</Text> : null}
      {discardSummary && onConfirmDiscardAll ? (
        <DiscardAllControl summary={discardSummary} onConfirm={onConfirmDiscardAll} />
      ) : null}
      <OrganizationMenu
        menuRef={organizationMenuRef}
        open={organizationMenuOpen}
        setOpen={setOrganizationMenuOpen}
        closeMenu={closeOrganizationMenu}
        closeAccountMenu={closeAccountMenu}
      />
      <AccountMenu
        menuRef={accountMenuRef}
        open={accountMenuOpen}
        setOpen={setAccountMenuOpen}
        closeMenu={closeAccountMenu}
        closeOrganizationMenu={closeOrganizationMenu}
        disabled={accountActionsDisabled}
      />
    </Box>
  );
}
