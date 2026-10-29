import { describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  commands: new Map<string, (...args: any[]) => Promise<unknown>>(),
  uriHandler: undefined as { handleUri(uri: { toString(include?: boolean): string }): void } | undefined,
  externalOpenCount: 0,
  information: vi.fn(async () => undefined),
  warning: vi.fn(async () => undefined),
  error: vi.fn(async () => undefined),
}));

vi.mock('vscode', () => ({
  ProgressLocation: { Notification: 1 },
  Uri: { parse: (value: string) => ({ value }) },
  env: { openExternal: vi.fn(async () => { fixture.externalOpenCount += 1; return true; }) },
  commands: {
    registerCommand: (name: string, handler: (...args: any[]) => Promise<unknown>) => {
      fixture.commands.set(name, handler);
      return { dispose() {} };
    },
  },
  window: {
    registerUriHandler: (handler: typeof fixture.uriHandler) => {
      fixture.uriHandler = handler ?? undefined;
      return { dispose() {} };
    },
    withProgress: async (_options: unknown, task: (progress: unknown, token: unknown) => Promise<unknown>) =>
      task({}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }),
    showInformationMessage: fixture.information,
    showWarningMessage: fixture.warning,
    showErrorMessage: fixture.error,
  },
}));

vi.mock('../src/commands/updates.js', () => ({ notifyUpdate: vi.fn() }));
vi.mock('../src/plan-loader.js', () => ({ codeOf: (error: unknown) => error instanceof Error ? error.message : 'unknown' }));
vi.mock('../src/plan-view-model.js', () => ({ messageFor: (code: string) => code }));

import { registerAuthCommands } from '../src/commands/auth.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('condition_not_reached');
}

describe('IDE authentication command transitions', () => {
  it('cancels pending sign-in before delayed sign-out, then keeps a later sign-in', async () => {
    fixture.commands.clear();
    fixture.uriHandler = undefined;
    fixture.externalOpenCount = 0;
    fixture.information.mockClear();
    fixture.warning.mockClear();
    fixture.error.mockClear();

    let revision = 0;
    let hasSession = false;
    let clearStarted = false;
    const clearGate = deferred<void>();
    const sessions = {
      clear: vi.fn(async () => { hasSession = false; }),
      save: vi.fn(async () => { hasSession = true; }),
    };
    const auth = {
      beginAuthorizationCode: vi.fn(async () => ({ authorizationUrl: 'https://issuer.example.test/auth' })),
      completeAuthorizationCode: vi.fn(async (_callback: string) => { await sessions.save(); }),
      clear: vi.fn(async () => {
        clearStarted = true;
        await clearGate.promise;
        await sessions.clear();
      }),
    };
    const deps = {
      context: {},
      sessions,
      activeReveals: { dispose() {} },
      configuration: () => ({}),
      core: () => ({ auth }),
      currentCore: async () => ({ auth }),
      changeOrganization: vi.fn(async () => { revision += 1; return revision; }),
      refresh: vi.fn(async () => undefined),
      render: vi.fn(),
      revision: () => revision,
      keyOwner: () => 'Organisation' as const,
      safeKeyPro: () => undefined,
      pickCustodianDevice: async () => undefined,
    } as never;

    registerAuthCommands(deps);
    const signIn = fixture.commands.get('inheriti.signIn')!;
    const signOut = fixture.commands.get('inheriti.signOut')!;

    const pendingSignIn = signIn();
    await until(() => fixture.externalOpenCount === 1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pendingSignOut = signOut();
    await pendingSignIn;
    await until(() => clearStarted);

    expect(auth.completeAuthorizationCode).not.toHaveBeenCalled();
    expect(hasSession).toBe(false);
    clearGate.resolve();
    await pendingSignOut;
    expect(sessions.clear).toHaveBeenCalled();

    const laterSignIn = signIn();
    await until(() => fixture.externalOpenCount === 2);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const uriHandler = fixture.uriHandler as unknown as { handleUri(uri: { toString(include?: boolean): string }): void };
    uriHandler.handleUri({ toString: () => 'vscode://safetech.inheriti-ide/oauth/callback?code=second' });
    await laterSignIn;

    expect(auth.completeAuthorizationCode).toHaveBeenCalledOnce();
    expect(hasSession).toBe(true);
  });
});
