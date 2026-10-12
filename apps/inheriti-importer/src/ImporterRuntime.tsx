import { useEffect, useMemo, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  CoreProvider,
  HttpClientFactory,
  type CoreModuleConfig,
} from '@safetech/inheriti-core-sdk';
import { ElectronHttpTransport } from '@modules/_shared/infrastructure/transport/electron-http-transport';
import { secureCleanup } from '@modules/_shared/application/secure-cleanup-controller';
import { createCoreSessionBridge, ImporterApiProvider } from '@shared/infrastructure/importer-api';
import { createElectronAuthProvider } from '@modules/auth/infrastructure/electron-auth-provider';
import InMemoryOrganizationKeyVault from '@modules/organization/infrastructure/in-memory-organization-key-vault';
import { ElectronBusinessSocket } from '@shared/infrastructure/transport/electron-business-socket';

const queryClient = new QueryClient();

const coreTelemetry: CoreModuleConfig['telemetry'] = {
  run<T>(
    _operation: { name: string; attributes?: Readonly<Record<string, string | number | boolean>> },
    callback: () => T,
  ): T {
    return callback();
  },
  getErrorContext: () => undefined,
};

export function ImporterRuntime({ children }: { children: ReactNode }) {
  const transport = useMemo(() => new ElectronHttpTransport(), []);
  const coreHttpClient = useMemo(
    () =>
      HttpClientFactory.create({
        // Core repositories require an absolute base URL to build API URLs. This
        // is the same `INHERITI_API_ORIGIN` electron/main.cjs uses for the real
        // network call (baked in at build time via vite.config.ts's `define`) —
        // every actual request still goes through `transport` below and the
        // Electron bridge, but a Core SDK fallback (e.g. its Socket.IO URL
        // builder) must not silently target a hardcoded dev URL.
        apiUrl: __API_ORIGIN__ || 'http://localhost:3000',
        transport: async (input, init) => {
          const url = new URL(String(input));
          const method = (init?.method || 'GET').toUpperCase() as
            'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
          const response = await transport.request({
            method,
            path: `${url.pathname}${url.search}`,
            body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
            skipCsrf: url.pathname === '/csrf',
            signal: init?.signal ?? undefined,
          });
          return new Response(JSON.stringify(response.body ?? null), {
            status: response.status,
            headers: { 'content-type': 'application/json' },
          });
        },
      }),
    [transport],
  );
  const organizationKeyVault = useMemo(() => new InMemoryOrganizationKeyVault(), []);
  const authProvider = useMemo(() => createElectronAuthProvider(() => secureCleanup.runAll()), []);
  useEffect(
    () => secureCleanup.register(() => organizationKeyVault.clearAllSessions()),
    [organizationKeyVault],
  );
  const businessSocket = useMemo(() => new ElectronBusinessSocket(), []);
  const coreSession = useMemo(() => createCoreSessionBridge(), []);
  return (
    <CoreProvider
      modules={{}}
      moduleConfigs={{
        core: {
          httpClient: coreHttpClient,
          telemetry: coreTelemetry,
          safekey: { enableMergeAuthorityAuthCheck: false },
        } as CoreModuleConfig,
        'protection-plan': {
          authTokens: { mergingProcessKey: '' },
          getIdentityId: coreSession.getIdentityId,
          subscribeAuthState: coreSession.subscribeAuthState,
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <ImporterApiProvider
          transport={transport}
          vault={organizationKeyVault}
          authProvider={authProvider}
          socket={businessSocket}
          onSessionChange={coreSession.update}
        >
          {children}
        </ImporterApiProvider>
      </QueryClientProvider>
    </CoreProvider>
  );
}
