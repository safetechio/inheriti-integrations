import { useRef, useState } from 'react';
import { useAuthProvider, useAuthState } from '@shared/infrastructure/importer-api';
import type {
  AccountDestinations,
  ElectronAuthProvider,
  SavedAccount,
} from '@modules/auth/infrastructure/electron-auth-provider';
import { getActiveOrganizationAccount } from '@modules/organization/infrastructure/selected-organization-api';
import useSelectCurrentOrganization from '@modules/organization/application/use-select-current-organization';

type PendingAccount = {
  key: string;
  organization?: { id: string; name: string };
};

export function useAccountMenu(closeMenu: (returnFocus?: boolean) => void) {
  const authProvider = useAuthProvider() as ElectronAuthProvider | null;
  const authNotice = useAuthState((state) => (state as { notice?: string | null }).notice ?? null);
  const { selectOrganization } = useSelectCurrentOrganization();
  const [accounts, setAccounts] = useState<SavedAccount[]>([]);
  const [destinations, setDestinations] = useState<AccountDestinations[]>([]);
  const [destinationsLoading, setDestinationsLoading] = useState(false);
  const [pendingAccount, setPendingAccount] = useState<PendingAccount | null>(null);
  const [confirmSignOutAll, setConfirmSignOutAll] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const [addingAccount, setAddingAccount] = useState(false);
  const loadRevision = useRef(0);

  async function loadAccounts() {
    const revision = ++loadRevision.current;
    const activeKey = getActiveOrganizationAccount();
    setDestinationsLoading(true);
    setAccounts([]);
    setDestinations([]);
    try {
      const [saved, groups] = await Promise.all([
        authProvider?.accounts?.(),
        authProvider?.destinations?.(),
      ]);
      if (revision !== loadRevision.current || activeKey !== getActiveOrganizationAccount()) return;
      setAccounts(saved ?? []);
      setDestinations(groups ?? []);
    } catch (error) {
      if (revision === loadRevision.current)
        setAccountError(error instanceof Error ? error.message : 'Could not load accounts.');
    } finally {
      if (revision === loadRevision.current) setDestinationsLoading(false);
    }
  }

  function cancelAddAccount() {
    void authProvider?.cancelLogin().catch((error: unknown) => {
      setAccountError(error instanceof Error ? error.message : 'Could not cancel sign-in.');
    });
  }

  function requestSwitch(account: SavedAccount, organization?: { id: string; name: string }) {
    closeMenu();
    setPendingAccount({ key: account.key, organization });
  }

  function removeAccount(account: SavedAccount) {
    closeMenu();
    setAccountBusy(true);
    void authProvider
      ?.removeAccount(account.key)
      .then(async (result) => {
        await loadAccounts();
        if (result.remoteRevocationFailed)
          setAccountError('The saved login was removed here, but server sign-out could not be confirmed.');
      })
      .catch((error: unknown) => {
        setAccountError(error instanceof Error ? error.message : 'Could not remove account.');
      })
      .finally(() => setAccountBusy(false));
  }

  function selectCurrentOrganization(organizationId: string) {
    closeMenu();
    void selectOrganization(organizationId);
  }

  function addAccount() {
    closeMenu();
    setAccountBusy(true);
    setAddingAccount(true);
    setAccountError(null);
    void authProvider
      ?.addAccount?.()
      .then(async () => {
        await loadAccounts();
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.message === 'AUTH_ACCOUNT_ALREADY_ACTIVE') {
          setAccountError('This account is already active.');
        } else if (error instanceof Error && !/(?:^|\W)AUTH_CANCELLED(?:$|\W)/u.test(error.message)) {
          setAccountError(error.message);
        }
      })
      .finally(() => {
        setAddingAccount(false);
        setAccountBusy(false);
      });
  }

  function activatePendingAccount() {
    const target = pendingAccount;
    setPendingAccount(null);
    if (!target) return;
    setAccountBusy(true);
    void authProvider
      ?.activateAccount(target.key, target.organization?.id)
      .catch((error: unknown) => {
        setAccountError(error instanceof Error ? error.message : 'Could not switch accounts.');
      })
      .finally(() => setAccountBusy(false));
  }

  function signOut() {
    closeMenu();
    void authProvider?.logout?.();
  }

  function requestSignOutAll() {
    closeMenu();
    setConfirmSignOutAll(true);
  }

  function signOutAll() {
    setConfirmSignOutAll(false);
    void authProvider?.logoutAll().catch((error: unknown) => {
      setAccountError(error instanceof Error ? error.message : 'Could not sign out.');
    });
  }

  return {
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
    loadAccounts,
    cancelAddAccount,
    requestSwitch,
    removeAccount,
    selectCurrentOrganization,
    addAccount,
    activatePendingAccount,
    signOut,
    requestSignOutAll,
    signOutAll,
  };
}
