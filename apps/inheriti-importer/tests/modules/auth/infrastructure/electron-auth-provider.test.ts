import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElectronAuthProvider } from '@modules/auth/infrastructure/electron-auth-provider';
import { secureCleanup } from '@modules/_shared/application/secure-cleanup-controller';
import InMemoryOrganizationKeyVault from '@modules/organization/infrastructure/in-memory-organization-key-vault';

beforeEach(() => {
  // @ts-expect-error test-only bridge stub; no jsdom environment here
  globalThis.window = {};
});

afterEach(() => {
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
