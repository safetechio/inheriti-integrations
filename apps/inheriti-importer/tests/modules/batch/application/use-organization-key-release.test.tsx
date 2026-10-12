// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const useMasterKeySession = vi.fn();
const useVerifyMasterKeyPassphrase = vi.fn();
const useGetMasterKeySeed = vi.fn();
const decryptRSAOAEP = vi.fn();
const computePassphraseVerifier = vi.fn();
const deriveMasterKey = vi.fn();
const encryptRSAOAEP = vi.fn();
const organizationEventListener = {
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
};

vi.mock('@shared/infrastructure/importer-api', () => ({
  useService: () => organizationEventListener,
}));

vi.mock('@modules/organization/infrastructure/importer-api', () => ({
  useMasterKeySession: (...args: unknown[]) => useMasterKeySession(...args),
  useVerifyMasterKeyPassphrase: (...args: unknown[]) => useVerifyMasterKeyPassphrase(...args),
  useGetMasterKeySeed: (...args: unknown[]) => useGetMasterKeySeed(...args),
}));

vi.mock('@safetech/inheriti-core-sdk/core', () => ({
  decryptRSAOAEP: (...args: unknown[]) => decryptRSAOAEP(...args),
  computePassphraseVerifier: (...args: unknown[]) => computePassphraseVerifier(...args),
  deriveMasterKey: (...args: unknown[]) => deriveMasterKey(...args),
  encryptRSAOAEP: (...args: unknown[]) => encryptRSAOAEP(...args),
}));

import { useOrganizationKeyRelease } from '@modules/batch/application/use-organization-key-release';

const identity = { organizationId: 'org-1', sessionFamilyId: 'family-1', userId: 'user-1' };

function makeVault() {
  const entries = new Map<string, string>();
  return {
    get: vi.fn(
      async (ctx: typeof identity) =>
        entries.get(`${ctx.organizationId}:${ctx.sessionFamilyId}:${ctx.userId}`) ?? null,
    ),
    set: vi.fn(async (ctx: typeof identity, key: string) => {
      entries.set(`${ctx.organizationId}:${ctx.sessionFamilyId}:${ctx.userId}`, key);
    }),
    clearOrganization: vi.fn(async () => undefined),
    clearSession: vi.fn(async () => undefined),
    clearAllSessions: vi.fn(async () => undefined),
  };
}

let latestOptions: { onDelivered?: (enc: string, key: unknown) => void | Promise<void> } = {};
let mockState: { step: string; error: string | null; availableMasterKey: string | null } = {
  step: 'preparing',
  error: null,
  availableMasterKey: null,
};

function resetMockMasterKeySession() {
  mockState = { step: 'preparing', error: null, availableMasterKey: null };
  useMasterKeySession.mockImplementation((options: typeof latestOptions) => {
    latestOptions = options;
    return mockState;
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

beforeEach(() => {
  useGetMasterKeySeed.mockReturnValue({ data: 'seed-hex' });
});

describe('useOrganizationKeyRelease', () => {
  it('acquires the key for a Plan via a Plan-bound relay session (passes planId through)', async () => {
    resetMockMasterKeySession();
    useVerifyMasterKeyPassphrase.mockReturnValue({ verify: vi.fn().mockResolvedValue(true) });
    decryptRSAOAEP.mockResolvedValue('decrypted-master-key');
    computePassphraseVerifier.mockResolvedValue('verifier');
    const vault = makeVault();

    const { result, rerender } = renderHook(() =>
      useOrganizationKeyRelease({ organizationId: 'org-1', identity, vault }),
    );

    let acquired: Promise<string>;
    act(() => {
      acquired = result.current.acquire('plan-a');
    });
    await waitFor(() => expect(result.current.state.activePlanId).toBe('plan-a'));

    expect(useMasterKeySession).toHaveBeenLastCalledWith(
      expect.objectContaining({ planId: 'plan-a', enabled: true, orgId: 'org-1' }),
    );

    await act(async () => {
      await latestOptions.onDelivered?.('encrypted', {});
    });

    await expect(acquired!).resolves.toBe('decrypted-master-key');
    expect(vault.set).toHaveBeenCalledWith(identity, 'decrypted-master-key');
  });

  it('delivers the Organization Key via the tenant-scoped MASTER_KEY_DELIVERED broadcast (the path the Business API actually uses, not the per-session room)', async () => {
    resetMockMasterKeySession();
    useVerifyMasterKeyPassphrase.mockReturnValue({ verify: vi.fn().mockResolvedValue(true) });
    decryptRSAOAEP.mockResolvedValue('decrypted-master-key');
    computePassphraseVerifier.mockResolvedValue('verifier');
    const vault = makeVault();
    const privateKey = { alg: 'private-key' };

    const { result, rerender } = renderHook(() =>
      useOrganizationKeyRelease({ organizationId: 'org-1', identity, vault }),
    );

    let acquired: Promise<string>;
    act(() => {
      acquired = result.current.acquire('plan-a');
    });
    await waitFor(() => expect(result.current.state.activePlanId).toBe('plan-a'));

    mockState = {
      step: 'ready',
      error: null,
      availableMasterKey: null,
      sessionId: 'session-1',
      privateKey,
    } as typeof mockState;
    rerender();

    await waitFor(() => expect(organizationEventListener.subscribe).toHaveBeenCalled());
    const subscribeCall = organizationEventListener.subscribe.mock.calls.at(-1)![0];
    expect(subscribeCall).toMatchObject({ organizationId: 'org-1', eventName: 'tenant_changed' });

    await act(async () => {
      await subscribeCall.handlers.onUpdated({
        type: 'MASTER_KEY_DELIVERED',
        payload: { sessionId: 'session-1', encryptedMasterKey: 'encrypted' },
      });
    });

    await expect(acquired!).resolves.toBe('decrypted-master-key');
    expect(decryptRSAOAEP).toHaveBeenCalledWith('encrypted', privateKey);
  });

  it('detects and reuses a local Organization Key without requiring another relay', async () => {
    resetMockMasterKeySession();
    useVerifyMasterKeyPassphrase.mockReturnValue({ verify: vi.fn().mockResolvedValue(true) });
    decryptRSAOAEP.mockResolvedValue('org-key');
    computePassphraseVerifier.mockResolvedValue('verifier');
    const vault = makeVault();
    await vault.set(identity, 'org-key');

    const { result, rerender } = renderHook(() =>
      useOrganizationKeyRelease({ organizationId: 'org-1', identity, vault }),
    );

    await waitFor(() => expect(result.current.state.localKeyAvailable).toBe(true));

    let acquired: Promise<string>;
    await act(async () => {
      acquired = result.current.acquire('plan-b');
      await acquired;
    });
    await expect(acquired!).resolves.toBe('org-key');
    expect(result.current.state.activePlanId).toBeNull();
  });

  it('reuses the vault value on a retry of the SAME Plan (no second SafeKey round-trip needed)', async () => {
    resetMockMasterKeySession();
    useVerifyMasterKeyPassphrase.mockReturnValue({ verify: vi.fn().mockResolvedValue(true) });
    decryptRSAOAEP.mockResolvedValue('org-key');
    computePassphraseVerifier.mockResolvedValue('verifier');
    const vault = makeVault();

    const { result, rerender } = renderHook(() =>
      useOrganizationKeyRelease({ organizationId: 'org-1', identity, vault }),
    );

    act(() => {
      void result.current.acquire('plan-a');
    });
    await waitFor(() => expect(result.current.state.activePlanId).toBe('plan-a'));
    await act(async () => {
      await latestOptions.onDelivered?.('encrypted', {});
    });

    // Second acquisition for the SAME plan id.
    let retry: Promise<string>;
    await act(async () => {
      retry = result.current.acquire('plan-a');
      await retry;
    });
    await expect(retry!).resolves.toBe('org-key');
    expect(result.current.state.activePlanId).toBeNull();
  });

  it('rejects when the key has not been claimed on a SafeKey device', async () => {
    resetMockMasterKeySession();
    useVerifyMasterKeyPassphrase.mockReturnValue({ verify: vi.fn() });
    const vault = makeVault();

    const { result, rerender } = renderHook(() =>
      useOrganizationKeyRelease({ organizationId: 'org-1', identity, vault }),
    );

    let acquired: Promise<string>;
    act(() => {
      acquired = result.current.acquire('plan-a');
      acquired.catch(() => undefined);
    });
    await waitFor(() => expect(result.current.state.activePlanId).toBe('plan-a'));

    mockState = { step: 'not-claimed', error: null, availableMasterKey: null };
    rerender();

    await expect(acquired!).rejects.toThrow(/not been claimed/i);
  });

  it('rejects and surfaces the error when verification fails', async () => {
    resetMockMasterKeySession();
    useVerifyMasterKeyPassphrase.mockReturnValue({ verify: vi.fn().mockResolvedValue(false) });
    decryptRSAOAEP.mockResolvedValue('org-key');
    computePassphraseVerifier.mockResolvedValue('verifier');
    const vault = makeVault();

    const { result, rerender } = renderHook(() =>
      useOrganizationKeyRelease({ organizationId: 'org-1', identity, vault }),
    );

    let acquired: Promise<string>;
    act(() => {
      acquired = result.current.acquire('plan-a');
      acquired.catch(() => undefined);
    });
    await waitFor(() => expect(result.current.state.activePlanId).toBe('plan-a'));

    await act(async () => {
      await latestOptions.onDelivered?.('encrypted', {});
    });

    await expect(acquired!).rejects.toThrow(/could not be verified/i);
    expect(vault.set).not.toHaveBeenCalled();
  });

  it('ignores a stale terminal state while starting a new release attempt', async () => {
    resetMockMasterKeySession();
    useVerifyMasterKeyPassphrase.mockReturnValue({ verify: vi.fn().mockResolvedValue(true) });
    decryptRSAOAEP.mockResolvedValue('org-key');
    computePassphraseVerifier.mockResolvedValue('verifier');
    const vault = makeVault();

    const { result, rerender } = renderHook(() =>
      useOrganizationKeyRelease({ organizationId: 'org-1', identity, vault }),
    );

    let first: Promise<string>;
    act(() => {
      first = result.current.acquire('plan-a');
      first.catch(() => undefined);
    });
    await waitFor(() => expect(result.current.state.activePlanId).toBe('plan-a'));
    mockState = { step: 'error', error: 'Relay failed', availableMasterKey: null };
    rerender();
    await expect(first!).rejects.toThrow('Relay failed');

    let retry: Promise<string>;
    act(() => {
      retry = result.current.acquire('plan-a');
      retry.catch(() => undefined);
    });
    await waitFor(() => expect(result.current.state.activePlanId).toBe('plan-a'));
    expect(result.current.state.activePlanId).toBe('plan-a');

    mockState = { step: 'preparing', error: null, availableMasterKey: null };
    rerender();
    await act(async () => {
      await latestOptions.onDelivered?.('encrypted', {});
    });

    await expect(retry!).resolves.toBe('org-key');
  });

  it('simulates SafeKey Mobile through the active encrypted relay session', async () => {
    resetMockMasterKeySession();
    const verify = vi.fn().mockResolvedValue(true);
    useVerifyMasterKeyPassphrase.mockReturnValue({ verify });
    deriveMasterKey.mockResolvedValue('derived-master-key');
    computePassphraseVerifier.mockResolvedValue('verifier');
    encryptRSAOAEP.mockResolvedValue('encrypted-master-key');
    const deliverMasterKey = vi.fn().mockResolvedValue({ status: 201, body: null });
    window.inheriti = {
      development: { deliverMasterKey },
    } as typeof window.inheriti;
    mockState = {
      step: 'ready',
      error: null,
      availableMasterKey: null,
      sessionId: 'session-1',
      relayToken: 'relay-token',
      clientPublicKey: 'client-public-key',
    } as typeof mockState;
    const vault = makeVault();

    const { result, rerender } = renderHook(() =>
      useOrganizationKeyRelease({ organizationId: 'org-1', identity, vault }),
    );
    let acquired: Promise<string>;
    act(() => {
      acquired = result.current.acquire();
    });
    await waitFor(() => expect(result.current.state.activePlanId).toBe('organization-key-request'));

    await act(async () => result.current.simulateLocalRelease('123456'));

    expect(deriveMasterKey).toHaveBeenCalledWith('123456', 'seed-hex');
    expect(verify).toHaveBeenCalledWith({ orgId: 'org-1', verifier: 'verifier' });
    expect(encryptRSAOAEP).toHaveBeenCalledWith('derived-master-key', 'client-public-key');
    expect(deliverMasterKey).toHaveBeenCalledWith({
      organizationId: 'org-1',
      sessionId: 'session-1',
      relayToken: 'relay-token',
      encryptedMasterKey: 'encrypted-master-key',
    });
    expect(JSON.stringify(deliverMasterKey.mock.calls)).not.toContain('123456');
    expect(JSON.stringify(deliverMasterKey.mock.calls)).not.toContain('derived-master-key');
    await expect(acquired!).resolves.toBe('derived-master-key');
    expect(vault.set).toHaveBeenCalledWith(identity, 'derived-master-key');
    expect(result.current.state.localKeyAvailable).toBe(true);
  });
});
