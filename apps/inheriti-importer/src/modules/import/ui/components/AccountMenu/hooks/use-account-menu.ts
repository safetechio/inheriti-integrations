import { useEffect, useRef, useState } from 'react';
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
  const accountsRevision = useAuthState((state) => (state as { accountsRevision?: number }).accountsRevision ?? 0);
  const isLoggedIn = useAuthState((state) => (state as { isLoggedIn?: boolean }).isLoggedIn ?? false);
  const isSwitching = useAuthState((state) => (state as { isSwitching?: boolean }).isSwitching ?? false);
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
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadedAccountsRevision, setLoadedAccountsRevision] = useState<number | null>(null);
  const inFlight = useRef<{ key: string | null; accountsRevision: number; promise: Promise<void> } | null>(null);
  const currentAccountsRevision = useRef(accountsRevision);
  currentAccountsRevision.current = accountsRevision;
  const currentKey = getActiveOrganizationAccount();

  useEffect(() => {
    if (isLoggedIn && !isSwitching && currentKey && authProvider) {
      void loadAccounts();
    } else {
      ++loadRevision.current;
      inFlight.current = null;
      setDestinationsLoading(false);
      if (!isLoggedIn) {
        setAccounts([]);
        setDestinations([]);
        setLoadedKey(null);
        setHasLoaded(false);
      }
    }
  }, [authProvider, isLoggedIn, isSwitching, currentKey, accountsRevision]);

  function loadAccounts(force = false): Promise<void> {
    const activeKey = getActiveOrganizationAccount();
    const requestedAccountsRevision = currentAccountsRevision.current;
    if (!force && inFlight.current?.key === activeKey && inFlight.current.accountsRevision === requestedAccountsRevision)
      return inFlight.current.promise;
    if (!force && activeKey === loadedKey && hasLoaded && loadedAccountsRevision === requestedAccountsRevision && !accountError)
      return Promise.resolve();
    const revision = ++loadRevision.current;
    if (activeKey !== loadedKey) {
      setAccounts([]);
      setDestinations([]);
      setHasLoaded(false);
      setLoadedKey(activeKey);
    }
    setDestinationsLoading(true);
    setAccountError(null);
    const promise = (async () => {
      try {
        const [saved, groups] = await Promise.all([
          authProvider?.accounts?.(),
          authProvider?.destinations?.(),
        ]);
        if (revision !== loadRevision.current || activeKey !== getActiveOrganizationAccount() || requestedAccountsRevision !== currentAccountsRevision.current) return;
        setAccounts(saved ?? []);
        setDestinations(groups ?? []);
        setHasLoaded(true);
        setLoadedAccountsRevision(requestedAccountsRevision);
        setAccountError(null);
      } catch (error) {
        if (revision === loadRevision.current && activeKey === getActiveOrganizationAccount() && requestedAccountsRevision === currentAccountsRevision.current)
          setAccountError(error instanceof Error ? error.message : 'Could not load accounts.');
      } finally {
        if (revision === loadRevision.current) setDestinationsLoading(false);
        if (revision === loadRevision.current) inFlight.current = null;
      }
    })();
    inFlight.current = { key: activeKey, accountsRevision: requestedAccountsRevision, promise };
    return promise;
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
        await loadAccounts(true);
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
        await loadAccounts(true);
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
    accounts: currentKey === loadedKey ? accounts : [],
    destinations: currentKey === loadedKey ? destinations : [],
    destinationsLoading: currentKey === loadedKey ? destinationsLoading : false,
    hasLoaded: currentKey === loadedKey && hasLoaded,
    pendingAccount,
    setPendingAccount,
    confirmSignOutAll,
    setConfirmSignOutAll,
    accountError: currentKey === loadedKey ? accountError : null,
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
