/// <reference types="vite/client" />

interface OpenedNativeFile {
  name: string;
  path?: string;
  data: number[];
}

interface InheritiDesktop {
  openFiles: () => Promise<OpenedNativeFile[]>;
  updates: {
    check: () => Promise<{
      version: string;
      update: { id: string; version: string } | null;
      error?: string;
    }>;
    install: (id: string) => Promise<{ installed: boolean; openedInstaller?: boolean }>;
  };
  api: {
    request: (request: {
      method: string;
      path: string;
      query?: Record<string, unknown>;
      body?: unknown;
      organizationId?: string;
    }) => Promise<{ status: number; body: unknown }>;
  };
  development: {
    deliverMasterKey: (request: {
      organizationId: string;
      sessionId: string;
      relayToken: string;
      encryptedMasterKey: string;
    }) => Promise<{ status: number; body: unknown }>;
  };
  socket: {
    subscribe: (request: { event: string; payload: Record<string, string> }) => Promise<void>;
    unsubscribe: (request: { event: string; payload: Record<string, string> }) => Promise<void>;
    onEvent: (handler: (event: { event: string; data: unknown }) => void) => () => void;
    reconnect: () => Promise<void>;
  };
  auth: {
    login: () => Promise<unknown>;
    add: () => Promise<unknown>;
    accounts: () => Promise<Array<{ key: string; subject: string; active: boolean }>>;
    destinations: () => Promise<
      Array<{
        accountKey: string;
        subject: string;
        status: 'ready' | 'sign_in_required';
        displayName?: string;
        email?: string;
        organizations: Array<{ id: string; name: string }>;
      }>
    >;
    activate: (key: string) => Promise<unknown>;
    remove: (key: string) => Promise<{ remoteRevocationFailed: boolean }>;
    logoutAll: () => Promise<{ remoteRevocationFailed: boolean }>;
    cancel: () => Promise<unknown>;
    logout: () => Promise<{ remoteRevocationFailed: boolean }>;
    session: () => Promise<unknown>;
  };
}

declare global {
  interface Window {
    inheriti?: InheritiDesktop;
  }

  // Baked in by `vite.config.ts`'s `define` from the build-time
  // `INHERITI_API_ORIGIN` env var (the same one `electron/main.cjs` reads).
  // Empty string in a bare dev run with no `.env.local`.
  const __API_ORIGIN__: string;

  // Baked in from `WEB_APP_URL`, with the local Business app as the fallback.
  const __WEB_APP_URL__: string;
}

export {};
