import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElectronAuthProvider } from '@modules/auth/infrastructure/electron-auth-provider';
import { secureCleanup } from '@modules/_shared/application/secure-cleanup-controller';
import InMemoryOrganizationKeyVault from '@modules/organization/infrastructure/in-memory-organization-key-vault';

beforeEach(() => {
  // @ts-expect-error test-only bridge stub; no jsdom environment here
  globalThis.window = {};
});

afterEach(() => {
  vi.unstubAllGlobals();
  // @ts-expect-error test-only bridge stub
  delete globalThis.window;
});

describe('createElectronAuthProvider logout', () => {
  it('runs the supplied cleanup before the IPC logout call', async () => {
    const order: string[] = [];
    const ipcLogout = vi.fn(async () => {
      order.push('ipc-logout');
    });
    // @ts-expect-error test-only bridge stub
    globalThis.window.inheriti = { auth: { logout: ipcLogout } };
    const onLogout = vi.fn(async () => {
      order.push('cleanup');
    });

    const provider = createElectronAuthProvider(onLogout);
    provider.dispatch = vi.fn();
    await provider.logout();

    expect(order).toEqual(['cleanup', 'ipc-logout']);
    expect(provider.dispatch).toHaveBeenCalledWith({ type: 'SIGN_OUT' });
  });

  it('still logs out when no cleanup hook is supplied', async () => {
    const ipcLogout = vi.fn(async () => {});
    // @ts-expect-error test-only bridge stub
    globalThis.window.inheriti = { auth: { logout: ipcLogout } };

    const provider = createElectronAuthProvider();
    provider.dispatch = vi.fn();
    await provider.logout();

    expect(ipcLogout).toHaveBeenCalled();
  });

  it('clears registered Organization Keys before completing logout', async () => {
    const context = {
      organizationId: 'org-1',
      sessionFamilyId: 'family-1',
      userId: 'user-1',
    };
    const vault = new InMemoryOrganizationKeyVault();
    await vault.set(context, 'organization-key');
    const unregister = secureCleanup.register(() => vault.clearAllSessions());
    const ipcLogout = vi.fn().mockResolvedValue(undefined);
    // @ts-expect-error test-only bridge stub
    globalThis.window.inheriti = { auth: { logout: ipcLogout } };
    const provider = createElectronAuthProvider(() => secureCleanup.runAll());

    try {
      await provider.logout();
      expect(await vault.get(context)).toBeNull();
      expect(ipcLogout).toHaveBeenCalledTimes(1);
    } finally {
      unregister();
    }
  });
});

describe('createElectronAuthProvider account transitions', () => {
  it('rechecks target organization membership before saving a cross-account destination', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    });
    const auth = {
      activate: vi.fn(async () => ({ userId: 'B' })),
      session: vi.fn(async () => ({ userId: 'B' })),
      accounts: vi.fn(async () => [{ key: 'account-b', subject: 'B', active: true }]),
    };
    const api = {
      request: vi.fn(async () => ({ status: 200, body: { result: { items: [{ id: 'org-b' }] } } })),
    };
    // @ts-expect-error test-only bridge stub
    globalThis.window.inheriti = { auth, api };
    const provider = createElectronAuthProvider(async () => {});
    provider.dispatch = vi.fn();

    await provider.activateAccount('account-b', 'org-b');

    expect(api.request).toHaveBeenCalledWith({ method: 'GET', path: '/organizations' });
    expect(values.get('selectedOrganizationId:account-b')).toBe('org-b');
    expect(provider.dispatch).toHaveBeenLastCalledWith({
      type: 'SIGN_IN',
      userData: { userId: 'B' },
    });
  });

  it('does not save an inaccessible cross-account organization', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    });
    const auth = {
      activate: vi.fn(async () => ({ userId: 'B' })),
      session: vi.fn(async () => ({ userId: 'B' })),
      accounts: vi.fn(async () => [{ key: 'account-b', subject: 'B', active: true }]),
    };
    const api = { request: vi.fn(async () => ({ status: 200, body: { result: { items: [] } } })) };
    // @ts-expect-error test-only bridge stub
    globalThis.window.inheriti = { auth, api };
    const provider = createElectronAuthProvider(async () => {});
    provider.dispatch = vi.fn();

    await expect(provider.activateAccount('account-b', 'org-missing')).rejects.toThrow(
      'AUTH_ORGANIZATION_UNAVAILABLE',
    );
    expect(values.get('selectedOrganizationId:account-b')).toBeUndefined();
    expect(provider.dispatch).toHaveBeenLastCalledWith({
      type: 'NOTICE',
      userData: 'That organisation is no longer available for this account.',
    });
  });
  it('restores the previous account when a destination membership is removed', async () => {
    const values = new Map([['selectedOrganizationId:account-a', 'org-a']]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    let active = 'account-a';
    const auth = {
      accounts: vi.fn(async () => [
        { key: 'account-a', subject: 'A', active: active === 'account-a' },
        { key: 'account-b', subject: 'B', active: active === 'account-b' },
      ]),
      activate: vi.fn(async (key: string) => {
        active = key;
        return { userId: key === 'account-a' ? 'A' : 'B' };
      }),
      session: vi.fn(async () => ({ userId: active === 'account-a' ? 'A' : 'B' })),
    };
    const api = { request: vi.fn(async () => ({ status: 200, body: { result: { items: [] } } })) };
    // @ts-expect-error test-only bridge stub
    globalThis.window.inheriti = { auth, api };
    const provider = createElectronAuthProvider(async () => {});
    provider.dispatch = vi.fn();

    await expect(provider.activateAccount('account-b', 'org-removed')).rejects.toThrow(
      'AUTH_ORGANIZATION_UNAVAILABLE',
    );
    expect(auth.activate.mock.calls.map(([key]) => key)).toEqual(['account-b', 'account-a']);
    expect(active).toBe('account-a');
    expect(values.get('selectedOrganizationId:account-a')).toBe('org-a');
    expect(provider.dispatch).toHaveBeenCalledWith({ type: 'SIGN_IN', userData: { userId: 'A' } });
  });
  it('finishes a failed destination rollback before a newer account activation', async () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    let active = 'account-a';
    let releaseMembership: () => void = () => {};
    const membership = new Promise<void>((resolve) => {
      releaseMembership = resolve;
    });
    const auth = {
      accounts: vi.fn(async () =>
        ['account-a', 'account-b', 'account-c'].map((key) => ({
          key,
          subject: key,
          active: active === key,
        })),
      ),
      activate: vi.fn(async (key: string) => {
        active = key;
        return { userId: key };
      }),
      session: vi.fn(async () => ({ userId: active })),
    };
    const api = {
      request: vi.fn(async () => {
        await membership;
        return { status: 200, body: { result: { items: [] } } };
      }),
    };
    // @ts-expect-error test-only bridge stub
    globalThis.window.inheriti = { auth, api };
    const provider = createElectronAuthProvider(async () => {});
    provider.dispatch = vi.fn();

    const rejected = provider.activateAccount('account-b', 'org-removed');
    await vi.waitFor(() => expect(api.request).toHaveBeenCalledOnce());
    const newer = provider.activateAccount('account-c');
    expect(auth.activate.mock.calls.map(([key]) => key)).toEqual(['account-b']);
    releaseMembership();

    await expect(rejected).rejects.toThrow('AUTH_ORGANIZATION_UNAVAILABLE');
    await newer;
    expect(auth.activate.mock.calls.map(([key]) => key)).toEqual([
      'account-b',
      'account-a',
      'account-c',
    ]);
    expect(active).toBe('account-c');
    expect(provider.dispatch).toHaveBeenLastCalledWith({
      type: 'SIGN_IN',
      userData: { userId: 'account-c' },
    });
  });
  it('cancels login and add requests queued behind an account transition', async () => {
    let finishActivation: (session: { userId: string }) => void = () => {};
    const activation = new Promise<{ userId: string }>((resolve) => {
      finishActivation = resolve;
    });
    const auth = {
      accounts: vi.fn(async () => [{ key: 'account-a', subject: 'A', active: true }]),
      activate: vi.fn(() => activation),
      login: vi.fn(async () => ({ userId: 'C' })),
      add: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
    };
    // @ts-expect-error test-only bridge stub
    globalThis.window.inheriti = { auth };
    const provider = createElectronAuthProvider(async () => {});
    provider.dispatch = vi.fn();

    const switching = provider.activateAccount('account-b');
    await vi.waitFor(() => expect(auth.activate).toHaveBeenCalledOnce());
    const queuedLogin = provider.login().catch((error) => error);
    const queuedAdd = provider.addAccount().catch((error) => error);
    await provider.cancelLogin();
    finishActivation({ userId: 'B' });

    await switching;
    expect((await queuedLogin).message).toBe('AUTH_CANCELLED');
    expect((await queuedAdd).message).toBe('AUTH_CANCELLED');
    expect(auth.login).not.toHaveBeenCalled();
    expect(auth.add).not.toHaveBeenCalled();
    expect(auth.cancel).toHaveBeenCalledOnce();
  });
  it('does not open SafeID when login is cancelled during account lookup', async () => {
    let finishAccounts: (
      accounts: Array<{ key: string; subject: string; active: boolean }>,
    ) => void = () => {};
    const accounts = new Promise<Array<{ key: string; subject: string; active: boolean }>>(
      (resolve) => {
        finishAccounts = resolve;
      },
    );
    const auth = {
      accounts: vi.fn(() => accounts),
      login: vi.fn(async () => ({ userId: 'B' })),
      cancel: vi.fn(async () => {}),
      session: vi.fn(async () => null),
    };
    // @ts-expect-error test-only bridge stub
    globalThis.window.inheriti = { auth };
    const provider = createElectronAuthProvider();
    const pending = provider.login().catch((error) => error);
    await vi.waitFor(() => expect(auth.accounts).toHaveBeenCalledOnce());
    await provider.cancelLogin();
    finishAccounts([]);

    expect((await pending).message).toBe('AUTH_CANCELLED');
    expect(auth.login).not.toHaveBeenCalled();
  });
  it('does not open SafeID when login is cancelled during workspace cleanup', async () => {
    let finishCleanup: () => void = () => {};
    const cleanup = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    const auth = {
      accounts: vi.fn(async () => [{ key: 'account-a', subject: 'A', active: true }]),
      login: vi.fn(async () => ({ userId: 'B' })),
      cancel: vi.fn(async () => {}),
      session: vi.fn(async () => ({ userId: 'A' })),
    };
    // @ts-expect-error test-only bridge stub
    globalThis.window.inheriti = { auth };
    const onLogout = vi.fn(() => cleanup);
    const provider = createElectronAuthProvider(onLogout);
    provider.dispatch = vi.fn();
    const pending = provider.login().catch((error) => error);
    await vi.waitFor(() => expect(onLogout).toHaveBeenCalledOnce());
    await provider.cancelLogin();
    finishCleanup();

    expect((await pending).message).toBe('AUTH_CANCELLED');
    expect(auth.login).not.toHaveBeenCalled();
    expect(provider.dispatch).toHaveBeenCalledWith({ type: 'SIGN_IN', userData: { userId: 'A' } });
  });
  it('clears an expired restored context before exposing the signed-out gate', async () => {
    const order: string[] = [];
    const auth = {
      session: vi.fn(async () => {
        order.push('session');
        return null;
      }),
      accounts: vi.fn(async () => {
        order.push('accounts');
        return [{ key: 'account-a', subject: 'A', active: true }];
      }),
    };
    // @ts-expect-error test-only bridge stub
    globalThis.window.inheriti = { auth };
    const provider = createElectronAuthProvider(async (strict) => {
      expect(strict).toBe(true);
      order.push('cleanup');
    });
    provider.dispatch = vi.fn((action) => order.push(action.type));

    await provider.restoreSession();

    expect(order).toEqual(['session', 'cleanup', 'accounts', 'SIGN_OUT', 'AUTH_READY']);
  });

  it('clears an old active context before a fresh login activates another account', async () => {
    const order: string[] = [];
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    });
    const accounts = vi
      .fn()
      .mockImplementationOnce(async () => [{ key: 'account-a', subject: 'A', active: true }])
      .mockImplementationOnce(async () => [{ key: 'account-b', subject: 'B', active: true }]);
    const auth = {
      accounts,
      login: vi.fn(async () => {
        order.push('login');
        return { userId: 'B' };
      }),
      session: vi.fn(async () => null),
    };
    // @ts-expect-error test-only bridge stub
    globalThis.window.inheriti = { auth };
    const provider = createElectronAuthProvider(async (strict) => {
      expect(strict).toBe(true);
      order.push('cleanup');
    });
    provider.dispatch = vi.fn((action) => order.push(action.type));

    await provider.login();

    expect(order).toEqual(['SIGN_OUT', 'cleanup', 'login', 'SIGN_IN']);
    expect(auth.login).toHaveBeenCalledOnce();
  });

  it('recovers the old confirmed account when a replacement login is cancelled', async () => {
    const auth = {
      accounts: vi.fn(async () => [{ key: 'account-a', subject: 'A', active: true }]),
      login: vi.fn(async () => {
        throw new Error('AUTH_CANCELLED');
      }),
      session: vi.fn(async () => ({ userId: 'A' })),
    };
    // @ts-expect-error test-only bridge stub
    globalThis.window.inheriti = { auth };
    const provider = createElectronAuthProvider(async () => {});
    provider.dispatch = vi.fn();

    await expect(provider.login()).rejects.toThrow('AUTH_CANCELLED');
    expect(provider.dispatch).toHaveBeenNthCalledWith(1, { type: 'SIGN_OUT' });
    expect(provider.dispatch).toHaveBeenLastCalledWith({
      type: 'SIGN_IN',
      userData: { userId: 'A' },
    });
  });
  it('signals that the saved-account list changed after sign-out-all finishes', async () => {
    let finish: (value: { remoteRevocationFailed: boolean }) => void = () => {};
    const logoutAll = vi.fn(
      () =>
        new Promise<{ remoteRevocationFailed: boolean }>((resolve) => {
          finish = resolve;
        }),
    );
    // @ts-expect-error test-only bridge stub
    globalThis.window.inheriti = { auth: { logoutAll } };
    const provider = createElectronAuthProvider();
    provider.dispatch = vi.fn();

    const pending = provider.logoutAll();
    await Promise.resolve();
    expect(provider.dispatch).toHaveBeenCalledWith({ type: 'SIGN_OUT' });
    expect(provider.dispatch).not.toHaveBeenCalledWith({ type: 'ACCOUNTS_CHANGED' });
    await vi.waitFor(() => expect(logoutAll).toHaveBeenCalledOnce());
    finish({ remoteRevocationFailed: false });
    await pending;
    expect(provider.dispatch).toHaveBeenLastCalledWith({ type: 'ACCOUNTS_CHANGED' });
  });
  it('hides the old session and clears sensitive state before activating another account', async () => {
    const order: string[] = [];
    const auth = {
      accounts: vi.fn(async () => [{ key: 'account-b', subject: 'B', active: true }]),
      activate: vi.fn(async () => {
        order.push('activate');
        return { userId: 'B' };
      }),
      session: vi.fn(async () => null),
    };
    // @ts-expect-error test-only bridge stub
    globalThis.window.inheriti = { auth };
    const provider = createElectronAuthProvider(async (strict) => {
      expect(strict).toBe(true);
      order.push('cleanup');
    });
    provider.dispatch = vi.fn((action) => order.push(action.type));

    await provider.activateAccount('account-b');

    expect(order).toEqual(['SIGN_OUT', 'cleanup', 'activate', 'SIGN_IN']);
    expect(auth.activate).toHaveBeenCalledWith('account-b');
  });

  it('does not activate while an import is in progress or cleanup fails', async () => {
    const activate = vi.fn();
    // @ts-expect-error test-only bridge stub
    globalThis.window.inheriti = { auth: { activate } };
    const provider = createElectronAuthProvider(() => {
      throw new Error('wipe_failed');
    });
    const unblock = provider.blockTransitionsWhile(() => true);
    await expect(provider.activateAccount('account-b')).rejects.toThrow('Finish or discard');
    unblock();
    await expect(provider.activateAccount('account-b')).rejects.toThrow('wipe_failed');
    expect(activate).not.toHaveBeenCalled();
  });

  it('restores the confirmed old account after failed activation', async () => {
    const auth = {
      activate: vi.fn(async () => {
        throw new Error('TARGET_EXPIRED');
      }),
      session: vi.fn(async () => ({ userId: 'A' })),
      accounts: vi.fn(async () => [{ key: 'account-a', subject: 'A', active: true }]),
    };
    // @ts-expect-error test-only bridge stub
    globalThis.window.inheriti = { auth };
    const provider = createElectronAuthProvider();
    provider.dispatch = vi.fn();

    await expect(provider.activateAccount('account-b')).rejects.toThrow('TARGET_EXPIRED');
    expect(provider.dispatch).toHaveBeenNthCalledWith(1, { type: 'SIGN_OUT' });
    expect(provider.dispatch).toHaveBeenNthCalledWith(2, {
      type: 'SIGN_IN',
      userData: { userId: 'A' },
    });
    expect(provider.dispatch).toHaveBeenLastCalledWith({
      type: 'NOTICE',
      userData: 'TARGET_EXPIRED',
    });
  });

  it('migrates the old organization preference only after a fresh login', async () => {
    const values = new Map<string, string>([['selectedOrganizationId', 'org-old']]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    });
    const auth = {
      session: vi.fn(async () => null),
      login: vi.fn(async () => ({ userId: 'A' })),
      accounts: vi.fn(async () => [{ key: 'account-a', subject: 'A', active: true }]),
    };
    // @ts-expect-error test-only bridge stub
    globalThis.window.inheriti = { auth };
    const provider = createElectronAuthProvider();
    provider.dispatch = vi.fn();

    await provider.restoreSession();
    expect(values.get('selectedOrganizationId')).toBe('org-old');
    await provider.login();
    expect(values.get('selectedOrganizationId')).toBeUndefined();
    expect(values.get('selectedOrganizationId:account-a')).toBe('org-old');
  });
});
