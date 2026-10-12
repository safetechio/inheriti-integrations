import type { AuthProviderInstance } from '@shared/infrastructure/importer-api';

export type ElectronAuthProvider = AuthProviderInstance & {
  restoreSession: () => Promise<void>;
  login: () => Promise<unknown>;
  cancelLogin: () => Promise<void>;
  loginWithSafeID: () => Promise<unknown>;
  logout: () => Promise<void>;
};

/**
 * Electron owns the Keycloak/cookie flow. The renderer only receives the
 * non-sensitive session result and dispatches the Importer auth state transition.
 */
export function createElectronAuthProvider(
  onLogout?: () => void | Promise<void>,
): ElectronAuthProvider {
  const provider = {
    async restoreSession() {
      try {
        const session = await window.inheriti?.auth?.session();
        provider.dispatch?.({ type: session ? 'SIGN_IN' : 'SIGN_OUT', userData: session ?? null });
      } finally {
        provider.dispatch?.({ type: 'AUTH_READY' });
      }
    },
    async login() {
      const auth = window.inheriti?.auth;
      if (!auth) throw new Error('ELECTRON_BRIDGE_UNAVAILABLE');
      const session = await auth.login();
      provider.dispatch?.({ type: 'SIGN_IN', userData: session ?? {} });
      return session;
    },
    async loginWithSafeID() {
      return provider.login?.();
    },
    async cancelLogin() {
      await window.inheriti?.auth?.cancel?.();
    },
    async logout() {
      await onLogout?.();
      await window.inheriti?.auth?.logout?.();
      provider.dispatch?.({ type: 'SIGN_OUT' });
    },
  } as ElectronAuthProvider;

  return provider;
}
