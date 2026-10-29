import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const originalLoad = Module._load;
const authPath = resolve(process.cwd(), 'electron/ipc/auth.cjs');

type Runtime = {
  accounts: string[];
  activeSubject?: string;
  environment: string;
  capture: () => { subject?: string; generation: number };
  isCurrent: (capture: { subject?: string; generation: number }) => boolean;
  sessionDescriptor: () => Promise<unknown>;
  getAccessToken: () => Promise<string | undefined>;
  getAccountAccessToken: (subject: string) => Promise<string | undefined>;
  login: (openBrowser: (url: string) => Promise<void>, signal: AbortSignal) => Promise<unknown>;
  activate: (subject: string) => void;
  remove: (subject: string) => Promise<{ remoteRevocationFailed: boolean }>;
  logoutAll: () => Promise<{ remoteRevocationFailed: boolean }>;
};

type Harness = {
  handlers: Map<string, (...args: unknown[]) => unknown>;
  runtime: Runtime;
  bearerApiFetch: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  openExternal: ReturnType<typeof vi.fn>;
};

function loadAuth(runtime: Runtime, responses: (request: Record<string, unknown>) => unknown): Harness {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const bearerApiFetch = vi.fn(async (request: Record<string, unknown>) => responses(request));
  const disconnect = vi.fn();
  const openExternal = vi.fn(async () => undefined);
  Module._load = function (id: string, parent: unknown, isMain: boolean) {
    if (id === 'electron') return { shell: { openExternal } };
    if (id === '../lib/ipc-guard.cjs' || id.endsWith('/electron/lib/ipc-guard.cjs'))
      return { handle: (channel: string, listener: (...args: unknown[]) => unknown) => handlers.set(channel, listener) };
    if (id === '../lib/api-transport.cjs' || id.endsWith('/electron/lib/api-transport.cjs')) return { bearerApiFetch };
    if (id === '../lib/business-socket.cjs' || id.endsWith('/electron/lib/business-socket.cjs')) return { disconnectBusinessSocket: disconnect };
    return originalLoad.call(this, id, parent, isMain);
  };
  delete require.cache[authPath];
  require(authPath).register(Promise.resolve(), runtime);
  return { handlers, runtime, bearerApiFetch, disconnect, openExternal };
}

function baseRuntime(): Runtime {
  let generation = 1;
  const runtime: Runtime = {
    accounts: ['alice', 'bob'],
    activeSubject: 'alice',
    environment: 'TEST',
    capture: () => ({ subject: runtime.activeSubject, generation }),
    isCurrent: (capture) => capture.generation === generation && capture.subject === runtime.activeSubject,
    sessionDescriptor: async () => ({
      sessionFamilyId: `family-${runtime.activeSubject}`, subject: runtime.activeSubject,
      expiresAt: '2099-01-01T00:00:00.000Z',
    }),
    getAccessToken: async () => `${runtime.activeSubject}-operator-secret`,
    getAccountAccessToken: async (subject) => `${subject}-operator-secret`,
    login: async () => undefined,
    activate: (subject) => { runtime.activeSubject = subject; generation += 1; },
    remove: async (subject) => {
      runtime.accounts = runtime.accounts.filter((candidate) => candidate !== subject);
      if (runtime.activeSubject === subject) runtime.activeSubject = runtime.accounts[0];
      generation += 1;
      return { remoteRevocationFailed: false };
    },
    logoutAll: async () => ({ remoteRevocationFailed: false }),
  };
  return runtime;
}

afterEach(() => {
  Module._load = originalLoad;
  delete require.cache[authPath];
});

describe('operator auth IPC', () => {
  it('returns a non-secret session descriptor and sends the operator bearer token only in main', async () => {
    const runtime = baseRuntime();
    const harness = loadAuth(runtime, (request) => {
      expect(request).toMatchObject({
        method: 'GET', path: '/integrations/v1/importer/profile', token: 'alice-operator-secret',
        environment: 'TEST',
      });
      return { status: 200, body: { result: { id: 'user-alice' } } };
    });

    const descriptor = await harness.handlers.get('auth:session')!();

    expect(descriptor).toEqual({
      sessionFamilyId: 'family-alice', userId: 'user-alice', expiresAt: '2099-01-01T00:00:00.000Z',
    });
    expect(JSON.stringify(descriptor)).not.toContain('operator-secret');
    expect(harness.bearerApiFetch).toHaveBeenCalledOnce();
  });

  it('loads destinations with per-account bearer sessions without exposing tokens', async () => {
    const runtime = baseRuntime();
    const harness = loadAuth(runtime, (request) => {
      const subject = String(request.token).replace('-operator-secret', '');
      if (String(request.path).endsWith('/organizations'))
        return { status: 200, body: { result: { items: [{ id: `org-${subject}`, name: `${subject} Org` }] } } };
      return {
        status: 200,
        body: { result: { firstName: subject, lastName: 'Operator', email: `${subject}@example.test` } },
      };
    });

    const destinations = await harness.handlers.get('auth:destinations')!();

    expect(destinations).toEqual([
      expect.objectContaining({ accountKey: 'alice', organizations: [{ id: 'org-alice', name: 'alice Org' }] }),
      expect.objectContaining({ accountKey: 'bob', organizations: [{ id: 'org-bob', name: 'bob Org' }] }),
    ]);
    expect(JSON.stringify(destinations)).not.toContain('operator-secret');
    expect(harness.bearerApiFetch).toHaveBeenCalledTimes(4);
  });

  it('keeps the current account active while adding another account', async () => {
    const runtime = baseRuntime();
    let openedUrl = '';
    runtime.login = async (openBrowser) => {
      await openBrowser('https://safeid.example/authorize');
      return undefined;
    };
    const harness = loadAuth(runtime, (request) => {
      expect(request.token).toBe('alice-operator-secret');
      return { status: 200, body: { result: { id: 'user-alice' } } };
    });
    harness.openExternal.mockImplementation(async (url: string) => { openedUrl = url; });

    await harness.handlers.get('auth:add')!();

    expect(openedUrl).toBe('https://safeid.example/authorize');
    expect(runtime.activeSubject).toBe('alice');
    expect(harness.disconnect).not.toHaveBeenCalled();
  });

  it('activates an existing account only after checking its profile and removes it through runtime', async () => {
    const runtime = baseRuntime();
    const harness = loadAuth(runtime, (request) => ({
      status: 200,
      body: { result: { id: String(request.token).startsWith('bob-') ? 'user-bob' : 'user-alice' } },
    }));

    const descriptor = await harness.handlers.get('auth:activate')!(undefined, 'bob');
    expect(runtime.activeSubject).toBe('bob');
    expect(descriptor).toEqual(expect.objectContaining({ userId: 'user-bob' }));
    expect(harness.disconnect).toHaveBeenCalledOnce();

    await harness.handlers.get('auth:remove')!(undefined, 'bob');
    expect(runtime.accounts).toEqual(['alice']);
  });

  it('aborts a pending authorization when cancellation is requested', async () => {
    const runtime = baseRuntime();
    let signal: AbortSignal | undefined;
    let release: (() => void) | undefined;
    runtime.login = async (_openBrowser, loginSignal) => {
      signal = loginSignal;
      await new Promise<void>((resolve) => { release = resolve; });
      throw new Error('operator_authorization_canceled');
    };
    const harness = loadAuth(runtime, () => ({ status: 200, body: { result: { id: 'user-alice' } } }));
    const pending = harness.handlers.get('auth:login')!();
    await Promise.resolve();
    const cancellation = harness.handlers.get('auth:cancel')!();
    expect(signal?.aborted).toBe(true);
    release?.();
    await cancellation;
    await expect(pending).rejects.toThrow('operator_authorization_canceled');
  });
});
