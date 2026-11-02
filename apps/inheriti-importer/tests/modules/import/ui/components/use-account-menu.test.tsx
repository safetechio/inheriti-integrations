import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const accounts = vi.fn();
const destinations = vi.fn();
const removeAccount = vi.fn();
const addAccount = vi.fn();
let accountsRevision = 0;
vi.mock('@shared/infrastructure/importer-api', () => ({
  useAuthProvider: () => ({ accounts, destinations, removeAccount, addAccount }),
  useAuthState: (selector: (state: object) => unknown) => selector({ accountsRevision }),
}));
vi.mock('@modules/organization/application/use-select-current-organization', () => ({
  default: () => ({ selectOrganization: vi.fn() }),
}));

import { useAccountMenu } from '@modules/import/ui/components/AccountMenu/hooks/use-account-menu';
import { setActiveOrganizationAccount } from '@modules/organization/infrastructure/selected-organization-api';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const saved = [{ key: 'other', subject: 'other', active: false }];
const groups = [{ accountKey: 'other', displayName: 'Other', email: 'other@example.com', status: 'ready' }];

afterEach(() => {
  setActiveOrganizationAccount(null);
  vi.resetAllMocks();
  accountsRevision = 0;
});

it('shows initial loading, deduplicates calls, and preserves rows during refresh', async () => {
  setActiveOrganizationAccount('first');
  const first = deferred<typeof saved>();
  accounts.mockReturnValueOnce(first.promise).mockResolvedValue(saved);
  destinations.mockResolvedValue(groups);
  const { result } = renderHook(() => useAccountMenu(vi.fn()));
  let loading!: Promise<void>;
  act(() => { loading = result.current.loadAccounts(); });
  expect(result.current.destinationsLoading).toBe(true);
  expect(result.current.hasLoaded).toBe(false);
  act(() => { expect(result.current.loadAccounts()).toBe(loading); });
  expect(accounts).toHaveBeenCalledTimes(1);
  await act(async () => { first.resolve(saved); await loading; });
  expect(result.current.accounts).toEqual(saved);
  expect(result.current.destinations).toEqual(groups);
  expect(result.current.hasLoaded).toBe(true);
  await act(async () => { await result.current.loadAccounts(); });
  expect(accounts).toHaveBeenCalledTimes(1);
  const refresh = deferred<typeof saved>();
  accounts.mockReturnValueOnce(refresh.promise);
  act(() => { void result.current.loadAccounts(true); });
  expect(result.current.destinationsLoading).toBe(true);
  expect(result.current.accounts).toEqual(saved);
  expect(result.current.hasLoaded).toBe(true);
  await act(async () => { refresh.resolve(saved); await refresh.promise; });
});

it('clears an error on retry and discards stale account responses', async () => {
  setActiveOrganizationAccount('first');
  const { result, rerender } = renderHook(() => useAccountMenu(vi.fn()));
  accounts.mockRejectedValueOnce(new Error('Offline'));
  destinations.mockResolvedValue(groups);
  await act(async () => { await result.current.loadAccounts(); });
  expect(result.current.accountError).toBe('Offline');
  expect(result.current.destinationsLoading).toBe(false);
  const stale = deferred<typeof saved>();
  accounts.mockReturnValueOnce(stale.promise).mockResolvedValueOnce([]);
  act(() => { void result.current.loadAccounts(true); });
  expect(result.current.accountError).toBeNull();
  setActiveOrganizationAccount('second');
  rerender();
  expect(result.current.accounts).toEqual([]);
  await act(async () => { await result.current.loadAccounts(); });
  expect(result.current.hasLoaded).toBe(true);
  await act(async () => { stale.resolve(saved); await stale.promise; });
  expect(result.current.accounts).toEqual([]);
  expect(result.current.destinationsLoading).toBe(false);
});

it('forces a new snapshot after removal while an older request is pending', async () => {
  setActiveOrganizationAccount('first');
  const stale = deferred<typeof saved>();
  accounts.mockReturnValueOnce(stale.promise).mockResolvedValueOnce([]);
  destinations.mockResolvedValue(groups);
  removeAccount.mockResolvedValue({ remoteRevocationFailed: false });
  const { result } = renderHook(() => useAccountMenu(vi.fn()));
  act(() => { void result.current.loadAccounts(); });
  act(() => { result.current.removeAccount(saved[0] as never); });
  await act(async () => { await vi.waitFor(() => expect(accounts).toHaveBeenCalledTimes(2)); });
  expect(result.current.accounts).toEqual([]);
  await act(async () => { stale.resolve(saved); await stale.promise; });
  expect(result.current.accounts).toEqual([]);
});

it('forces a new snapshot after adding an account while an older request is pending', async () => {
  setActiveOrganizationAccount('first');
  const stale = deferred<typeof saved>();
  accounts.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(saved);
  destinations.mockResolvedValue(groups);
  addAccount.mockResolvedValue(undefined);
  const { result } = renderHook(() => useAccountMenu(vi.fn()));
  act(() => { void result.current.loadAccounts(); });
  act(() => { result.current.addAccount(); });
  await act(async () => { await vi.waitFor(() => expect(accounts).toHaveBeenCalledTimes(2)); });
  expect(result.current.accounts).toEqual(saved);
  await act(async () => { stale.resolve([]); await stale.promise; });
  expect(result.current.accounts).toEqual(saved);
});

it('reloads on reopen when the auth account revision changes', async () => {
  setActiveOrganizationAccount('first');
  accounts.mockResolvedValue(saved);
  destinations.mockResolvedValue(groups);
  const { result, rerender } = renderHook(() => useAccountMenu(vi.fn()));
  await act(async () => { await result.current.loadAccounts(); });
  await act(async () => { await result.current.loadAccounts(); });
  expect(accounts).toHaveBeenCalledTimes(1);
  accountsRevision++;
  rerender();
  await act(async () => { await result.current.loadAccounts(); });
  expect(accounts).toHaveBeenCalledTimes(2);
});

it('commits the fresh snapshot when a mutation increments the auth revision before resolving', async () => {
  setActiveOrganizationAccount('first');
  const mutation = deferred<void>();
  accounts.mockResolvedValueOnce([]).mockResolvedValueOnce(saved);
  destinations.mockResolvedValue(groups);
  addAccount.mockReturnValue(mutation.promise);
  const { result, rerender } = renderHook(() => useAccountMenu(vi.fn()));
  await act(async () => { await result.current.loadAccounts(); });
  act(() => { result.current.addAccount(); });
  accountsRevision++;
  rerender();
  await act(async () => { mutation.resolve(); await mutation.promise; });
  await vi.waitFor(() => expect(result.current.accounts).toEqual(saved));
  expect(result.current.hasLoaded).toBe(true);
  await act(async () => { await result.current.loadAccounts(); });
  expect(accounts).toHaveBeenCalledTimes(2);
});
