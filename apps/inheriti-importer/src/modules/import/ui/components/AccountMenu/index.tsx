import { useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { SavedAccount } from '@modules/auth/infrastructure/electron-auth-provider';
import { useGetIdentity } from '@modules/organization/infrastructure/importer-api';
import { useGetCurrentMember } from '@modules/organization/infrastructure/organization-resources-api';
import { BaseModal, Box, Pressable, Text } from '@modules/_shared/ui/components';
import Button from '@modules/_shared/ui/components/Base/Button';
import { AccountDestinations } from '../AccountDestinations';
import { AccountUnlinkAction } from '../AccountUnlinkAction';
import { useAccountMenu } from './hooks/use-account-menu';

export function AccountMenu({
  menuRef,
  open,
  setOpen,
  closeMenu,
  closeOrganizationMenu,
  disabled,
}: {
  menuRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  setOpen: Dispatch<SetStateAction<boolean>>;
  closeMenu: (returnFocus?: boolean) => void;
  closeOrganizationMenu: (returnFocus?: boolean) => void;
  disabled?: boolean;
}) {
  const { identity } = useGetIdentity();
  const { member } = useGetCurrentMember();
  const menu = useAccountMenu(closeMenu);
  const [pendingRemoval, setPendingRemoval] = useState<SavedAccount | null>(null);
  const {
    accounts,
    destinations,
    destinationsLoading,
    pendingAccount,
    setPendingAccount,
    confirmSignOutAll,
    setConfirmSignOutAll,
    accountError,
    authNotice,
    accountBusy,
    addingAccount,
  } = menu;
  const displayName =
    identity?.fullName && identity.fullName !== 'Unknown'
      ? identity.fullName
      : (identity?.email ?? 'Account');

  const notice = accountError || (authNotice && !/(?:^|\W)AUTH_CANCELLED(?:$|\W)/u.test(authNotice) ? authNotice : null);
  const pendingDestination = destinations.find((destination) => destination.accountKey === pendingAccount?.key);
  const pendingName = pendingDestination?.displayName && pendingDestination.displayName !== pendingDestination.email
    ? pendingDestination.displayName : 'this saved account';
  const activeAccount = accounts.find((account) => account.active);
  const pendingRemovalDestination = destinations.find((destination) => destination.accountKey === pendingRemoval?.key);
  const pendingRemovalName = pendingRemoval?.active ? displayName
    : pendingRemovalDestination?.displayName && pendingRemovalDestination.displayName !== pendingRemovalDestination.email
      ? pendingRemovalDestination.displayName : 'this saved account';

  return (
    <>
      {addingAccount ? (
        <Button
          title="Cancel Add Account"
          variant="plain"
          size="sm"
          onPress={menu.cancelAddAccount}
        />
      ) : null}
      <Box ref={menuRef} position="relative">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open account menu for ${displayName}`}
          {...{ 'aria-expanded': open }}
          disabled={disabled || accountBusy}
          onPress={() => {
            setOpen((value) => !value);
            if (!open) void menu.loadAccounts();
            closeOrganizationMenu(false);
          }}
        >
          <Box className="account-summary account-menu-avatar" width={40} height={40} borderRadius="pill" alignItems="center" justifyContent="center">
            <Text color="white" style={{ fontWeight: 400, fontSize: 13 }}>
              {displayName.trim().split(/\s+/u).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'}
            </Text>
          </Box>
        </Pressable>
        {open ? (
          <Box
            className="account-menu"
            accessibilityRole="menu"
            accessibilityLabel="Account"
            position="absolute"
            top="100%"
            right={0}
            width={340}
            backgroundColor="white"
            borderRadius="s"
            borderWidth={1}
            borderColor="gray10"
            style={{
              zIndex: 1000,
              elevation: 20,
              boxShadow: '0 12px 28px rgba(16, 24, 40, 0.12)',
              maxHeight: '70vh',
              overflowY: 'auto',
            }}
          >
            <Box className="account-menu-current" flexDirection="row" alignItems="center" gap="m">
              <Box className="account-menu-avatar" width={56} height={56} borderRadius="pill" alignItems="center" justifyContent="center">
                <Text color="white" style={{ fontWeight: 400, fontSize: 19 }}>
                  {displayName.trim().split(/\s+/u).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'}
                </Text>
              </Box>
              <Box style={{ flex: 1, minWidth: 0 }}>
                <Text variant="bodySmall" color="primary200" numberOfLines={1} style={{ fontWeight: 700 }}>{displayName}</Text>
                {identity?.email ? <Text variant="bodySmall" color="gray50" numberOfLines={1}>{identity.email}</Text> : null}
                {member?.role?.name ? <Text variant="bodySmall" color="gray" numberOfLines={1}>{member.role.name.replace(/Tenant/g, 'Organisation')}</Text> : null}
              </Box>
              {activeAccount ? (
                <AccountUnlinkAction name={displayName} onPress={() => { closeMenu(); setPendingRemoval(activeAccount); }} />
              ) : null}
            </Box>
            {destinationsLoading ? (
              <Text variant="bodySmall" color="gray">
                Loading accounts…
              </Text>
            ) : null}
            <AccountDestinations
              accounts={accounts}
              destinations={destinations}
              onSwitch={menu.requestSwitch}
              onRemove={(account) => {
                closeMenu();
                setPendingRemoval(account);
              }}
            />
            <Pressable accessibilityRole="menuitem" accessibilityLabel="Add account" onPress={() => {
              closeMenu();
              menu.addAccount();
            }}>
              <Box className="account-menu-add" flexDirection="row" alignItems="center" gap="m">
                <Box width={34} height={34} alignItems="center" justifyContent="center">
                  <Text color="gray" style={{ fontSize: 20, lineHeight: 20 }}>＋</Text>
                </Box>
                <Text variant="bodySmall" color="gray">Add another account</Text>
              </Box>
            </Pressable>
            <Pressable accessibilityRole="menuitem" accessibilityLabel={accounts.length > 1 ? 'Log out of all accounts' : 'Log out'} onPress={accounts.length > 1 ? menu.requestSignOutAll : menu.signOut}>
              <Box className="account-menu-signout-all" alignItems="center" justifyContent="center">
                <Text variant="bodySmall" color="danger">{accounts.length > 1 ? 'Log out of all accounts' : 'Log out'}</Text>
              </Box>
            </Pressable>
          </Box>
        ) : null}
        <BaseModal
          visible={Boolean(pendingAccount)}
          title={`Switch to ${pendingName}?`}
          onDismiss={() => setPendingAccount(null)}
          footer={
            <>
              <Button title="Cancel" variant="plain" onPress={() => setPendingAccount(null)} />
              <Button title="Switch account" onPress={menu.activatePendingAccount} />
            </>
          }
        >
          <Text variant="bodySmall" color="gray">
            {pendingAccount?.organization
              ? `Your access to ${pendingAccount.organization.name} will be checked before the workspace opens.`
              : 'Your organisation access will be checked before the workspace opens.'}
          </Text>
        </BaseModal>
        <BaseModal
          visible={Boolean(pendingRemoval)}
          title="Unlink account?"
          onDismiss={() => setPendingRemoval(null)}
          footer={
            <>
              <Button title="Cancel" variant="outlined" onPress={() => setPendingRemoval(null)} />
              <Button title="Unlink account" color="danger" onPress={() => {
                if (pendingRemoval) menu.removeAccount(pendingRemoval);
                setPendingRemoval(null);
              }} />
            </>
          }
        >
          <>
            <Box className="account-unlink-card" flexDirection="row" alignItems="center" gap="m">
              <Box className="account-menu-avatar" width={48} height={48} borderRadius="pill" alignItems="center" justifyContent="center">
                <Text color="white">{pendingRemovalName.trim().split(/\s+/u).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'}</Text>
              </Box>
              <Box style={{ minWidth: 0 }}>
                <Text variant="bodySmall" color="gray">Account:</Text>
                <Text variant="bodySmall" color="primary200" style={{ fontWeight: 600 }}>{pendingRemovalName}</Text>
                {(pendingRemoval?.active ? identity?.email : pendingRemovalDestination?.email) ? (
                  <Text variant="bodySmall" color="gray50">{pendingRemoval?.active ? identity?.email : pendingRemovalDestination?.email}</Text>
                ) : null}
              </Box>
            </Box>
            <Text variant="bodySmall" color="gray">
              This removes this saved login from this device. Other saved accounts remain available.
            </Text>
          </>
        </BaseModal>
        <BaseModal
          visible={confirmSignOutAll}
          title="Sign out all accounts?"
          onDismiss={() => setConfirmSignOutAll(false)}
          footer={
            <>
              <Button title="Cancel" variant="plain" onPress={() => setConfirmSignOutAll(false)} />
              <Button title="Sign out all" color="danger" onPress={menu.signOutAll} />
            </>
          }
        >
          <Text variant="bodySmall" color="gray">
            Every saved login on this device will be removed.
          </Text>
        </BaseModal>
        {notice ? (
          <Box className="account-menu-notice" accessibilityRole="alert" position="absolute" right={0} top="100%" width={340} padding="s" backgroundColor="white" borderRadius="s" borderWidth={1} borderColor="gray10">
            <Text variant="bodySmall" color="danger">{notice}</Text>
          </Box>
        ) : null}
      </Box>
    </>
  );
}
