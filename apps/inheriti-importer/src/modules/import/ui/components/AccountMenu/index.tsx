import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useGetIdentity } from '@modules/organization/infrastructure/importer-api';
import { BaseModal, Box, Icon, Pressable, Text } from '@modules/_shared/ui/components';
import Button from '@modules/_shared/ui/components/Base/Button';
import { UpdateStatus } from '@modules/_shared/ui/components/UpdateStatus';
import { AccountDestinations } from '../AccountDestinations';
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
  const menu = useAccountMenu(closeMenu);
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
        {open ? (
          <Box
            className="account-menu"
            accessibilityRole="menu"
            accessibilityLabel="Account"
            position="absolute"
            top="100%"
            right={0}
            width={320}
            padding="s"
            gap="s"
            backgroundColor="white"
            borderRadius="m"
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
            <Text variant="bodySmall" color="gray120" style={{ padding: 8 }}>
              {displayName}
            </Text>
            {destinationsLoading ? (
              <Text variant="bodySmall" color="gray">
                Loading accounts…
              </Text>
            ) : null}
            <AccountDestinations
              accounts={accounts}
              destinations={destinations}
              onSwitch={menu.requestSwitch}
              onRemove={menu.removeAccount}
              onSelectCurrentOrganization={menu.selectCurrentOrganization}
            />
            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel="Add account"
              onPress={menu.addAccount}
            >
              <Box padding="s">
                <Text variant="bodySmall" color="gray120">
                  Add account
                </Text>
              </Box>
            </Pressable>
            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel="Sign out"
              onPress={menu.signOut}
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
            <Pressable
              accessibilityRole="menuitem"
              accessibilityLabel="Sign out all accounts"
              onPress={menu.requestSignOutAll}
            >
              <Box padding="s">
                <Text variant="bodySmall" color="gray120">
                  Sign out all accounts
                </Text>
              </Box>
            </Pressable>
            <UpdateStatus />
          </Box>
        ) : null}
        <BaseModal
          visible={Boolean(pendingAccount)}
          title="Switch account?"
          description={
            pendingAccount?.organization
              ? `Switch to ${pendingAccount.subject} and open ${pendingAccount.organization.name}? Access will be checked before the workspace opens.`
              : `Open ${pendingAccount?.subject ?? ''}? Organisation access will be checked before the workspace opens.`
          }
          onDismiss={() => setPendingAccount(null)}
          footer={
            <>
              <Button title="Cancel" variant="plain" onPress={() => setPendingAccount(null)} />
              <Button
                title="Switch account"
                onPress={menu.activatePendingAccount}
              />
            </>
          }
        >
          <Box />
        </BaseModal>
        <BaseModal
          visible={confirmSignOutAll}
          title="Sign out all accounts?"
          description="Every saved login on this device will be removed."
          onDismiss={() => setConfirmSignOutAll(false)}
          footer={
            <>
              <Button title="Cancel" variant="plain" onPress={() => setConfirmSignOutAll(false)} />
              <Button
                title="Sign out all"
                color="danger"
                onPress={menu.signOutAll}
              />
            </>
          }
        >
          <Box />
        </BaseModal>
        {accountError || authNotice ? (
          <Text variant="bodySmall" color="danger">
            {accountError || authNotice}
          </Text>
        ) : null}
      </Box>
    </>
  );
}
