import type { ReactNode } from 'react';
import OrganizationGate from './components/OrganizationGate';
import SessionProofGate from './components/SessionProofGate';
import { SignInGate } from './components/SignInGate';
import useAuthGate from './hooks/use-auth-gate';

export function AuthGate({ children }: { children: ReactNode }) {
  const { status, message, loginInProgress, login, cancelLogin, logout } = useAuthGate();
  if (status !== 'signed-in') {
    return (
      <SignInGate
        status={status}
        message={message}
        loginInProgress={loginInProgress}
        onLogin={login}
        onCancel={cancelLogin}
      />
    );
  }
  return (
    <SessionProofGate onSignOut={logout}>
      <OrganizationGate onSignOut={logout}>{children}</OrganizationGate>
    </SessionProofGate>
  );
}
