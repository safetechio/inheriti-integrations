import { useEffect, useState } from 'react';
import { useAuthProvider, useAuthState } from '@shared/infrastructure/importer-api';
import type { ElectronAuthProvider, SavedAccount } from '@modules/auth/infrastructure/electron-auth-provider';

function signInError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('AUTH_SESSION_EXPIRED')) return 'Your saved session expired. Sign in with SafeID to continue.';
  return message && !message.includes('Error invoking remote method') && !/\bAUTH_[A-Z_]+\b/u.test(message)
    ? message : fallback;
}

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
      setMessage(signInError(caught, 'Could not check the session.'));
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
    if (authState?.notice && !/(?:^|\W)AUTH_CANCELLED(?:$|\W)/u.test(authState.notice))
      setMessage(signInError(new Error(authState.notice), 'Could not check the session.'));
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
      const cancelled = /(?:^|\W)AUTH_CANCELLED(?:$|\W)/u.test(errorMessage);
      setStatus(cancelled ? 'signed-out' : 'error');
      setMessage(cancelled ? null : signInError(caught, 'Could not sign in.'));
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
      setMessage(signInError(caught, 'Could not switch accounts.'));
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
