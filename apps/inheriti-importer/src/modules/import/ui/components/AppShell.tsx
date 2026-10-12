import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuthProvider } from '@shared/infrastructure/importer-api';
import {
  useGetIdentity,
  useGetSelectedOrganization,
  useSwitchToOrganization,
} from '@modules/organization/infrastructure/importer-api';
import { BrandLogo } from '@modules/import/ui/components/BrandLogo';
import { BaseModal, Box, Icon, Pressable, Text } from '@modules/_shared/ui/components';
import Button from '@modules/_shared/ui/components/Base/Button';
import useOrganizationMemberships from '@modules/organization/application/use-organization-memberships';
import useOrganizationKeyPurge from '@modules/organization/application/use-organization-key-purge';
import type { ElectronAuthProvider } from '@modules/auth/infrastructure/electron-auth-provider';
import { UpdateStatus } from '@modules/_shared/ui/components/UpdateStatus';

type DiscardSummary = { fileCount: number; planCount: number };

type AppShellProps = {
  dirtyCount: number;
  children: ReactNode;
  discardSummary?: DiscardSummary;
  onConfirmDiscardAll?: () => void;
};

export function AppShell({
  dirtyCount,
  children,
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
          discardSummary={discardSummary}
          onConfirmDiscardAll={onConfirmDiscardAll}
        />
      </header>
      {children}
    </Box>
  );
}

/**
 * Owns its own open/close state so toggling the confirm dialog only re-renders
 * this small header slice — not the whole app tree (which App's state would,
 * since `children` gets recreated on every App re-render).
 */
function DiscardAllControl({
  summary,
  onConfirm,
}: {
  summary: DiscardSummary;
  onConfirm: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Box>
        <Button
          title="Discard all"
          variant="outlined"
          size="sm"
          color="danger"
          onPress={() => setConfirming(true)}
        />
      </Box>
      <BaseModal
        visible={confirming}
        title="Discard everything?"
        description="This clears every imported file, mapping, and Plan draft in this session. It cannot be undone."
        onDismiss={() => setConfirming(false)}
        footer={
          <>
            <Button title="Cancel" variant="plain" onPress={() => setConfirming(false)} />
            <Button
              title="Discard all"
              color="danger"
              onPress={() => {
                onConfirm();
                setConfirming(false);
              }}
            />
          </>
        }
      >
        <Text variant="bodySmall" color="gray">
          {summary.fileCount} imported file{summary.fileCount === 1 ? '' : 's'} ·{' '}
          {summary.planCount} Plan{summary.planCount === 1 ? '' : 's'} will be removed.
        </Text>
      </BaseModal>
    </>
  );
}

function AppHeader({
  dirtyCount,
  discardSummary,
  onConfirmDiscardAll,
}: {
  dirtyCount: number;
  discardSummary?: DiscardSummary;
  onConfirmDiscardAll?: () => void;
}) {
  const { identity } = useGetIdentity();
  const { data: organization } = useGetSelectedOrganization();
  const { memberships } = useOrganizationMemberships();
  const { switchToOrganization, loading: switching } = useSwitchToOrganization();
  const { purgeOrganization } = useOrganizationKeyPurge();
  const authProvider = useAuthProvider() as ElectronAuthProvider | null;
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

  const displayName =
    identity?.fullName && identity.fullName !== 'Unknown'
      ? identity.fullName
      : (identity?.email ?? 'Account');
  const selectedOrganizationName =
    organization?.name ??
    memberships.find((item) => item.id === organization?.id)?.name ??
    'Choose organisation';

  async function selectOrganization(id: string) {
    closeOrganizationMenu();
    if (id === organization?.id) return;
    // Purge the outgoing organisation's Organization Key BEFORE the new
    // context is exposed — see `useOrganizationKeyPurge`. A key that
    // survives into a different organisation's context could otherwise be
    // used to decrypt that organisation's data.
    await purgeOrganization(organization?.id);
    await switchToOrganization(id);
  }

  return (
    <Box className="app-header-actions" flexDirection="row" alignItems="center" gap="m">
      {dirtyCount > 0 ? <Text className="phase-pill">{dirtyCount} edited</Text> : null}
      {discardSummary && onConfirmDiscardAll ? (
        <DiscardAllControl summary={discardSummary} onConfirm={onConfirmDiscardAll} />
      ) : null}
      <Box ref={organizationMenuRef} position="relative">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Change organisation. Current organisation: ${selectedOrganizationName}`}
          {...{ 'aria-expanded': organizationMenuOpen }}
          disabled={switching}
          onPress={() => {
            setOrganizationMenuOpen((value) => !value);
            closeAccountMenu(false);
          }}
        >
          <Box
            className="organization-switcher"
            flexDirection="row"
            alignItems="center"
            gap="s"
            borderWidth={1}
            borderColor="primary30"
            borderRadius="pill"
            paddingHorizontal="m"
            height={40}
            style={{ cursor: switching ? 'wait' : 'pointer', opacity: switching ? 0.7 : 1 }}
          >
            <Icon name="building" size={18} color="primary" label="Organisation" />
            <Text variant="bodySmall" color="primary120" numberOfLines={1}>
              {selectedOrganizationName}
            </Text>
            <Icon name="chevron-down" size={16} color="primary" label="Change organisation" />
          </Box>
        </Pressable>
        {organizationMenuOpen ? (
          <Box
            className="organization-menu"
            accessibilityRole="menu"
            accessibilityLabel="Organisations"
            position="absolute"
            top="100%"
            right={0}
            width={260}
            padding="s"
            gap="xxs"
            backgroundColor="white"
            borderRadius="m"
            borderWidth={1}
            borderColor="gray10"
            style={{ zIndex: 1000, elevation: 20, boxShadow: '0 12px 28px rgba(16, 24, 40, 0.12)' }}
          >
            <Text variant="bodySmall" color="gray" style={{ padding: 8 }}>
              Organisation
            </Text>
            {memberships.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="menuitem"
                accessibilityLabel={`Switch to ${item.name}`}
                {...{ 'aria-selected': item.id === organization?.id }}
                onPress={() => void selectOrganization(item.id)}
              >
                <Box
                  flexDirection="row"
                  alignItems="center"
                  gap="s"
                  padding="s"
                  borderRadius="s"
                  backgroundColor={item.id === organization?.id ? 'primary5' : 'white'}
                  style={{ cursor: 'pointer' }}
                >
                  <Icon
                    name="building"
                    size={16}
                    color={item.id === organization?.id ? 'primary' : 'gray'}
                  />
                  <Text variant="bodySmall" color="gray120" numberOfLines={1}>
                    {item.name}
                  </Text>
                </Box>
              </Pressable>
            ))}
          </Box>
        ) : null}
      </Box>
      <Box ref={accountMenuRef} position="relative">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open account menu for ${displayName}`}
          {...{ 'aria-expanded': accountMenuOpen }}
          onPress={() => {
            setAccountMenuOpen((value) => !value);
            closeOrganizationMenu(false);
          }}
        >
          <Box
            className="account-summary"
            flexDirection="row"
            alignItems="center"
            gap="s"
            style={{ cursor: 'pointer' }}
          >
            <Box
              width={32}
              height={32}
              borderRadius="pill"
              backgroundColor="primary10"
              alignItems="center"
              justifyContent="center"
            >
              <Icon name="user" size={18} color="primary" label="User" />
            </Box>
            <Box style={{ maxWidth: 180 }}>
              <Text variant="bodySmall" color="gray120" numberOfLines={1}>
                {displayName}
              </Text>
            </Box>
          </Box>
        </Pressable>
        {accountMenuOpen ? (
          <Box
            className="account-menu"
            accessibilityRole="menu"
            accessibilityLabel="Account"
            position="absolute"
            top="100%"
            right={0}
            width={180}
            padding="s"
            gap="s"
            backgroundColor="white"
            borderRadius="m"
            borderWidth={1}
            borderColor="gray10"
            style={{ zIndex: 1000, elevation: 20, boxShadow: '0 12px 28px rgba(16, 24, 40, 0.12)' }}
          >
            <Text variant="bodySmall" color="gray120" style={{ padding: 8 }}>
              {displayName}
            </Text>
            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel="Sign out"
              onPress={() => {
                closeAccountMenu();
                void authProvider?.logout?.();
              }}
            >
              <Box
                flexDirection="row"
                alignItems="center"
                gap="s"
                padding="s"
                borderRadius="s"
                style={{ cursor: 'pointer' }}
              >
                <Icon name="logout" size={16} color="gray" label="Sign out" />
                <Text variant="bodySmall" color="gray120">
                  Sign out
                </Text>
              </Box>
            </Pressable>
            <UpdateStatus />
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
