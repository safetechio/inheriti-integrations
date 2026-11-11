import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImporterApiProvider } from '@shared/infrastructure/importer-api/runtime';
import {
  ElectronHttpTransport,
  type HttpRequestLike,
  type HttpResponseLike,
} from '@shared/infrastructure/transport/electron-http-transport';
import type { ElectronAuthProvider } from '@modules/auth/infrastructure/electron-auth-provider';
import {
  setActiveOrganizationAccount,
  setSelectedOrganizationForActive,
} from '@modules/organization/infrastructure/selected-organization-api';
import { VersionContext } from '@modules/_shared/ui/components/UpdateStatus/UpdateGate';

const accountKey = 'storybook-importer-shell';
const organizationId = 'demo-organization';
const profile = {
  id: 'demo-user',
  firstName: 'Alex',
  lastName: 'Rivera',
  email: 'alex@example.test',
};
const organizations = [
  { id: organizationId, name: 'Acme Research', userId: profile.id },
  { id: 'demo-partner', name: 'Partner Studio', userId: 'other-user' },
];

class FixtureTransport extends ElectronHttpTransport {
  override async request<T = unknown>(request: HttpRequestLike): Promise<HttpResponseLike<T>> {
    const path = request.path;
    let result: unknown;
    if (path === '/integrations/v1/importer/profile') result = profile;
    else if (path === '/integrations/v1/importer/organizations') result = organizations;
    else if (path === `/integrations/v1/organizations/${organizationId}`) result = organizations[0];
    else if (path === '/integrations/v1/organizations/demo-partner') result = organizations[1];
    else if (path.endsWith('/members'))
      result = [{ id: 'demo-member', email: profile.email, role: { name: 'Administrator' } }];
    else throw new Error(`Unconfigured synthetic story request: ${path}`);
    return { status: 200, body: { result } as T };
  }
}

const transport = new FixtureTransport();
const vault = {
  get: async () => null,
  set: async () => undefined,
  clearOrganization: async () => undefined,
  clearSession: async () => undefined,
  clearAllSessions: async () => undefined,
};
const socket = {
  on: () => undefined,
  off: () => undefined,
  emit: () => undefined,
};
const authProvider: ElectronAuthProvider = {
  restoreSession: async () => undefined,
  login: async () => undefined,
  cancelLogin: async () => undefined,
  accounts: async () => [{ key: accountKey, subject: profile.id, active: true }],
  destinations: async () => [
    {
      accountKey,
      subject: profile.id,
      status: 'ready',
      displayName: 'Alex Rivera',
      email: profile.email,
      organizations: organizations.map(({ id, name }) => ({ id, name })),
    },
  ],
  addAccount: async () => undefined,
  activateAccount: async () => undefined,
  removeAccount: async () => ({ remoteRevocationFailed: false }),
  logoutAll: async () => undefined,
  logout: async () => undefined,
  blockTransitionsWhile: () => () => undefined,
};

export function ShellFixture({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } }),
  );
  useEffect(() => {
    const key = `selectedOrganizationId:${accountKey}`;
    const previous = localStorage.getItem(key);
    setActiveOrganizationAccount(accountKey);
    setSelectedOrganizationForActive(accountKey, organizationId);
    authProvider.dispatch?.({ type: 'SIGN_IN' });
    return () => {
      authProvider.dispatch?.({ type: 'SIGN_OUT' });
      setActiveOrganizationAccount(null);
      if (previous === null) localStorage.removeItem(key);
      else localStorage.setItem(key, previous);
      queryClient.clear();
    };
  }, [queryClient]);
  return (
    <QueryClientProvider client={queryClient}>
      <ImporterApiProvider
        transport={transport}
        vault={vault}
        authProvider={authProvider}
        socket={socket}
      >
        <VersionContext.Provider value="0.1.16-dev.0">{children}</VersionContext.Provider>
      </ImporterApiProvider>
    </QueryClientProvider>
  );
}
