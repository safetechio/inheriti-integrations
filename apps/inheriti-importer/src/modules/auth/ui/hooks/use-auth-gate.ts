import { useEffect, useState } from 'react';
import { useAuthProvider, useAuthState } from '@shared/infrastructure/importer-api';
import type { ElectronAuthProvider, SavedAccount } from '@modules/auth/infrastructure/electron-auth-provider';

export type GateStatus = 'checking' | 'signed-out' | 'signed-in' | 'error';

export default function useAuthGate() {
  const authState = useAuthState(
    (state) => state as { authInitialized?: boolean; isLoggedIn?: boolean; notice?: string | null; accountsRevision?: number } | undefined,
  );
  const authProvider = useAuthProvider() as ElectronAuthProvider | null;
  const [status, setStatus] = useState<GateStatus>('checking');
  const [message, setMessage] = useState<string | null>(null);
  const [loginInProgress, setLoginInProgress] = useState(false);
  const [accounts, setAccounts] = useState<SavedAccount[]>([]);

  useEffect(() => {
    void authProvider?.restoreSession?.().catch((caught) => {
      setStatus('error');
      setMessage(caught instanceof Error ? caught.message : 'Could not check the session.');
    });
  }, [authProvider]);

  useEffect(() => {
    if (!authState?.authInitialized) return;
    setStatus(authState.isLoggedIn ? 'signed-in' : 'signed-out');
  }, [authState?.authInitialized, authState?.isLoggedIn]);

  useEffect(() => {
    if (!authState?.authInitialized || authState.isLoggedIn) return;
    let current = true;
    void authProvider?.accounts?.().then((saved) => {
      if (current) setAccounts(saved.filter((account) => !account.active));
    }).catch(() => { if (current) setAccounts([]); });
    return () => { current = false; };
  }, [authProvider, authState?.authInitialized, authState?.isLoggedIn, authState?.accountsRevision]);

  useEffect(() => {
    if (authState?.notice) setMessage(authState.notice);
  }, [authState?.notice]);

  async function login() {
    setLoginInProgress(true);
    setStatus('checking');
    setMessage(null);
    try {
      await authProvider?.login?.();
      setStatus('signed-in');
    } catch (caught) {
      const errorMessage = caught instanceof Error ? caught.message : 'Could not sign in.';
      setStatus(errorMessage === 'AUTH_CANCELLED' ? 'signed-out' : 'error');
      setMessage(errorMessage === 'AUTH_CANCELLED' ? null : errorMessage);
    } finally {
      setLoginInProgress(false);
    }
  }

  async function cancelLogin() {
    await authProvider?.cancelLogin?.();
    setLoginInProgress(false);
    setMessage(null);
    setStatus('signed-out');
  }

  async function activateAccount(key: string) {
    setStatus('checking');
    setMessage(null);
    try {
      await authProvider?.activateAccount(key);
      setStatus('signed-in');
    } catch (caught) {
      setStatus('error');
      setMessage(caught instanceof Error ? caught.message : 'Could not switch accounts.');
    }
  }

  return {
    status,
    message,
    loginInProgress,
    accounts,
    activateAccount,
    login,
    cancelLogin,
    logout: () => {
      void authProvider?.logout?.();
    },
  };
}
