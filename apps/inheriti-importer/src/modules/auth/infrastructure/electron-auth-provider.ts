import type { AuthProviderInstance } from '@shared/infrastructure/importer-api';
import {
  setActiveOrganizationAccount,
  setSelectedOrganizationForActive,
} from '@modules/organization/infrastructure/selected-organization-api';

export type SavedAccount = { key: string; subject: string; active: boolean };
export type AccountDestinations = {
  accountKey: string;
  subject: string;
  status: 'ready' | 'sign_in_required';
  displayName?: string;
  email?: string;
  organizations: Array<{ id: string; name: string }>;
};

export type ElectronAuthProvider = AuthProviderInstance & {
  restoreSession: () => Promise<void>;
  login: () => Promise<unknown>;
  cancelLogin: () => Promise<void>;
  loginWithSafeID: () => Promise<unknown>;
  accounts: () => Promise<SavedAccount[]>;
  destinations: () => Promise<AccountDestinations[]>;
  addAccount: () => Promise<void>;
  activateAccount: (key: string, organizationId?: string) => Promise<void>;
  removeAccount: (key: string) => Promise<{ remoteRevocationFailed: boolean }>;
  logoutAll: () => Promise<void>;
  logout: () => Promise<void>;
  blockTransitionsWhile: (blocked: () => boolean) => () => void;
};

/**
 * Electron owns the SafeID/cookie flow. The renderer only receives the
 * non-sensitive session result and dispatches the Importer auth state transition.
 */
export function createElectronAuthProvider(
  onLogout?: (strict?: boolean) => void | Promise<void>,
): ElectronAuthProvider {
  let transitionBlocked: (() => boolean) | null = null;
  let transitionTail: Promise<void> = Promise.resolve();
  let enrollmentCancellation = 0;
  function serialize<Args extends unknown[], Result>(
    operation: (...args: Args) => Promise<Result>,
  ): (...args: Args) => Promise<Result> {
    return (...args) => {
      const pending = transitionTail.then(() => operation(...args));
      transitionTail = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    };
  }
  function serializeEnrollment<Args extends unknown[], Result>(
    operation: (...args: Args) => Promise<Result>,
  ): (...args: Args) => Promise<Result> {
    return (...args) => {
      const requestedAt = enrollmentCancellation;
      return serialize(async () => {
        if (requestedAt !== enrollmentCancellation) throw new Error('AUTH_CANCELLED');
        return operation(...args);
      })();
    };
  }
  function requireIdle() {
    if (transitionBlocked?.())
      throw new Error('Finish or discard the current import before changing accounts.');
  }
  async function syncActiveAccount(migrateLegacy = false) {
    const accounts = await window.inheriti?.auth?.accounts?.();
    setActiveOrganizationAccount(
      accounts?.find((account) => account.active)?.key ?? null,
      migrateLegacy,
    );
  }

  const provider = {
    async restoreSession() {
      try {
        const session = await window.inheriti?.auth?.session();
        if (!session) await onLogout?.(true);
        await syncActiveAccount();
        provider.dispatch?.({ type: session ? 'SIGN_IN' : 'SIGN_OUT', userData: session ?? null });
      } finally {
        provider.dispatch?.({ type: 'AUTH_READY' });
      }
    },
    async login() {
      const auth = window.inheriti?.auth;
      if (!auth) throw new Error('ELECTRON_BRIDGE_UNAVAILABLE');
      const enrollmentStartedAt = enrollmentCancellation;
      const previous = (await provider.accounts()).find((account) => account.active);
      if (previous) {
        requireIdle();
        provider.dispatch?.({ type: 'SIGN_OUT' });
        setActiveOrganizationAccount(null);
        await onLogout?.(true);
      }
      try {
        if (enrollmentStartedAt !== enrollmentCancellation) throw new Error('AUTH_CANCELLED');
        const session = await auth.login();
        await syncActiveAccount(true);
        provider.dispatch?.({ type: 'SIGN_IN', userData: session ?? {} });
        return session;
      } catch (error) {
        if (previous) {
          const session = await auth.session().catch(() => null);
          await syncActiveAccount();
          if (session) provider.dispatch?.({ type: 'SIGN_IN', userData: session });
        }
        throw error;
      }
    },
    async loginWithSafeID() {
      return provider.login?.();
    },
    async cancelLogin() {
      enrollmentCancellation++;
      await window.inheriti?.auth?.cancel?.();
    },
    blockTransitionsWhile(blocked: () => boolean) {
      transitionBlocked = blocked;
      return () => {
        if (transitionBlocked === blocked) transitionBlocked = null;
      };
    },
    async accounts() {
      return (await window.inheriti?.auth?.accounts?.()) ?? [];
    },
    async destinations() {
      return (await window.inheriti?.auth?.destinations?.()) ?? [];
    },
    async addAccount() {
      if (!window.inheriti?.auth) throw new Error('ELECTRON_BRIDGE_UNAVAILABLE');
      await window.inheriti.auth.add();
      provider.dispatch?.({ type: 'ACCOUNTS_CHANGED' });
    },
    async activateAccount(key: string, organizationId?: string) {
      requireIdle();
      const auth = window.inheriti?.auth;
      if (!auth) throw new Error('ELECTRON_BRIDGE_UNAVAILABLE');
      const previous = (await provider.accounts()).find((account) => account.active);
      provider.dispatch?.({ type: 'SIGN_OUT' });
      setActiveOrganizationAccount(null);
      try {
        await onLogout?.(true);
      } catch (error) {
        provider.dispatch?.({
          type: 'NOTICE',
          userData: 'Could not clear the previous account workspace. Please retry.',
        });
        throw error;
      }
      try {
        const session = await auth.activate(key);
        await syncActiveAccount();
        if (organizationId) {
          const response = await window.inheriti?.api?.request({
            method: 'GET',
            path: '/organizations',
          });
          const result = (response?.body as { result?: { items?: Array<{ id?: string }> } })
            ?.result;
          if (
            response?.status !== 200 ||
            !result?.items?.some((organization) => organization.id === organizationId)
          ) {
            throw new Error('AUTH_ORGANIZATION_UNAVAILABLE');
          }
          setSelectedOrganizationForActive(key, organizationId);
        }
        provider.dispatch?.({ type: 'SIGN_IN', userData: session });
      } catch (error) {
        let session = null;
        if (previous && previous.key !== key) {
          session = await auth.activate(previous.key).catch(() => null);
          if (!session) {
            const active = (await provider.accounts()).find((account) => account.active);
            if (active?.key === previous.key) session = await auth.session().catch(() => null);
          }
        } else {
          session = await auth.session().catch(() => null);
        }
        if (session) {
          await syncActiveAccount();
          provider.dispatch?.({ type: 'SIGN_IN', userData: session });
        } else {
          setActiveOrganizationAccount(null);
          provider.dispatch?.({ type: 'SIGN_OUT' });
        }
        provider.dispatch?.({
          type: 'NOTICE',
          userData:
            error instanceof Error && error.message === 'AUTH_ORGANIZATION_UNAVAILABLE'
              ? 'That organisation is no longer available for this account.'
              : error instanceof Error
                ? error.message
                : 'Could not switch accounts.',
        });
        throw error;
      }
    },
    async removeAccount(key: string) {
      requireIdle();
      const auth = window.inheriti?.auth;
      if (!auth) throw new Error('ELECTRON_BRIDGE_UNAVAILABLE');
      const active = (await provider.accounts()).find((account) => account.active)?.key === key;
      if (active) {
        provider.dispatch?.({ type: 'SIGN_OUT' });
        setActiveOrganizationAccount(null);
        await onLogout?.();
      }
      const result = await auth.remove(key);
      provider.dispatch?.({ type: 'ACCOUNTS_CHANGED' });
      if (result.remoteRevocationFailed)
        provider.dispatch?.({
          type: 'NOTICE',
          userData: 'The saved login was removed here, but server sign-out could not be confirmed.',
        });
      return result;
    },
    async logoutAll() {
      requireIdle();
      provider.dispatch?.({ type: 'SIGN_OUT' });
      setActiveOrganizationAccount(null);
      await onLogout?.();
      const result = await window.inheriti?.auth?.logoutAll?.();
      provider.dispatch?.({ type: 'ACCOUNTS_CHANGED' });
      if (result?.remoteRevocationFailed)
        provider.dispatch?.({
          type: 'NOTICE',
          userData:
            'All saved logins were removed here, but server sign-out could not be confirmed.',
        });
    },
    async logout() {
      requireIdle();
      provider.dispatch?.({ type: 'SIGN_OUT' });
      setActiveOrganizationAccount(null);
      await onLogout?.();
      const result = await window.inheriti?.auth?.logout?.();
      provider.dispatch?.({ type: 'ACCOUNTS_CHANGED' });
      if (result?.remoteRevocationFailed)
        provider.dispatch?.({
          type: 'NOTICE',
          userData: 'This login was removed here, but server sign-out could not be confirmed.',
        });
    },
  } as ElectronAuthProvider;

  provider.restoreSession = serialize(provider.restoreSession);
  provider.login = serializeEnrollment(provider.login);
  provider.addAccount = serializeEnrollment(provider.addAccount);
  provider.activateAccount = serialize(provider.activateAccount);
  provider.removeAccount = serialize(provider.removeAccount);
  provider.logoutAll = serialize(provider.logoutAll);
  provider.logout = serialize(provider.logout);

  return provider;
}
