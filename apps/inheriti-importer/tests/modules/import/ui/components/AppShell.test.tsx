import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const useAuthProvider = vi.fn();
const useGetIdentity = vi.fn();
const useGetCurrentMember = vi.fn();
const useGetSelectedOrganization = vi.fn();
const useSwitchToOrganization = vi.fn();
const useGetJoinedOrganizations = vi.fn();
const useGetMyOrganization = vi.fn();
const useAuthenticatedCookieSession = vi.fn();
const useService = vi.fn();

vi.mock('@shared/infrastructure/importer-api', () => ({
  useAuthProvider: (...args: unknown[]) => useAuthProvider(...args),
  useAuthState: (selector: (state: unknown) => unknown) => selector({ notice: null }),
  useAuthenticatedCookieSession: (...args: unknown[]) => useAuthenticatedCookieSession(...args),
  useService: (...args: unknown[]) => useService(...args),
}));

vi.mock('@modules/organization/infrastructure/importer-api', () => ({
  useGetIdentity: (...args: unknown[]) => useGetIdentity(...args),
  useGetSelectedOrganization: (...args: unknown[]) => useGetSelectedOrganization(...args),
  useSwitchToOrganization: (...args: unknown[]) => useSwitchToOrganization(...args),
  useGetJoinedOrganizations: (...args: unknown[]) => useGetJoinedOrganizations(...args),
  useGetMyOrganization: (...args: unknown[]) => useGetMyOrganization(...args),
}));

vi.mock('@modules/organization/infrastructure/organization-resources-api', () => ({
  useGetCurrentMember: (...args: unknown[]) => useGetCurrentMember(...args),
}));

import { AppShell } from '@modules/import/ui/components/AppShell';
import { setActiveOrganizationAccount } from '@modules/organization/infrastructure/selected-organization-api';

beforeEach(() => {
  useGetCurrentMember.mockReturnValue({ member: { id: 'member-1' } });
});

afterEach(() => {
  setActiveOrganizationAccount(null);
  cleanup();
  vi.clearAllMocks();
});

describe('AppShell account-menu organization switcher', () => {
  it('disambiguates same-name organizations in the current account picker', async () => {
    useAuthProvider.mockReturnValue({ logout: vi.fn() });
    useGetIdentity.mockReturnValue({ identity: { fullName: 'Ada', email: 'ada@example.com' } });
    useGetSelectedOrganization.mockReturnValue({ data: { id: 'org-aaaa1111', name: 'Shared' } });
    useSwitchToOrganization.mockReturnValue({ switchToOrganization: vi.fn(), loading: false });
    useGetMyOrganization.mockReturnValue({
      data: { id: 'org-aaaa1111', name: 'Shared' },
      loading: false,
    });
    useGetJoinedOrganizations.mockReturnValue({
      data: [{ id: 'org-bbbb2222', name: 'Shared' }],
      loading: false,
    });
    useAuthenticatedCookieSession.mockReturnValue({ session: null });
    useService.mockReturnValue({ clearOrganization: vi.fn() });

    render(
      <AppShell dirtyCount={0}>
        <span>content</span>
      </AppShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Change organisation/ }));

    expect(screen.getByRole('menuitem', { name: 'Switch to Shared (aaaa1111)' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Switch to Shared (bbbb2222)' })).toBeTruthy();
  });
  it('discards a late destination list after the active account changes', async () => {
    let resolveDestinations: (
      value: Array<{
        accountKey: string;
        subject: string;
        status: 'ready';
        organizations: Array<{ id: string; name: string }>;
      }>,
    ) => void = () => {};
    useAuthProvider.mockReturnValue({
      accounts: vi.fn().mockResolvedValue([{ key: 'account-b', subject: 'B', active: false }]),
      destinations: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveDestinations = resolve;
          }),
      ),
    });
    useGetIdentity.mockReturnValue({ identity: { fullName: 'Ada', email: 'ada@example.com' } });
    useGetSelectedOrganization.mockReturnValue({ data: { id: 'org-a', name: 'Org A' } });
    useSwitchToOrganization.mockReturnValue({ switchToOrganization: vi.fn(), loading: false });
    useGetMyOrganization.mockReturnValue({ data: { id: 'org-a', name: 'Org A' }, loading: false });
    useGetJoinedOrganizations.mockReturnValue({ data: [], loading: false });
    useAuthenticatedCookieSession.mockReturnValue({ session: null });
    useService.mockReturnValue({ clearOrganization: vi.fn() });
    setActiveOrganizationAccount('account-a');

    render(
      <AppShell dirtyCount={0}>
        <span>content</span>
      </AppShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Open account menu/ }));
    setActiveOrganizationAccount('account-c');
    await act(async () => {
      resolveDestinations([
        {
          accountKey: 'account-b',
          subject: 'B',
          status: 'ready',
          organizations: [{ id: 'org-b', name: 'Shared' }],
        },
      ]);
    });
    expect(screen.queryByRole('menuitem', { name: 'Switch to B and open Shared' })).toBeNull();
  });
  it('confirms a saved account switch and then lets the organization gate select its workspace', async () => {
    const activateAccount = vi.fn().mockResolvedValue(undefined);
    useAuthProvider.mockReturnValue({
      accounts: vi.fn().mockResolvedValue([
        { key: 'account-a', subject: 'A', active: true },
        { key: 'account-b', subject: 'B', active: false },
        { key: 'account-c', subject: 'C', active: false },
      ]),
      destinations: vi.fn().mockResolvedValue([
        {
          accountKey: 'account-a',
          subject: 'A',
          status: 'ready',
          organizations: [{ id: 'org-a', name: 'Shared' }],
        },
        {
          accountKey: 'account-b',
          subject: 'B',
          displayName: 'B',
          status: 'ready',
          organizations: [
            { id: 'org-aaaa1111', name: 'Shared' },
            { id: 'org-bbbb2222', name: 'Shared' },
          ],
        },
        { accountKey: 'account-c', subject: 'C', status: 'sign_in_required', organizations: [] },
      ]),
      activateAccount,
    });
    useGetIdentity.mockReturnValue({ identity: { fullName: 'Ada', email: 'ada@example.com' } });
    useGetSelectedOrganization.mockReturnValue({ data: { id: 'org-a', name: 'Shared' } });
    useSwitchToOrganization.mockReturnValue({ switchToOrganization: vi.fn(), loading: false });
    useGetMyOrganization.mockReturnValue({ data: { id: 'org-a', name: 'Shared' }, loading: false });
    useGetJoinedOrganizations.mockReturnValue({ data: [], loading: false });
    useAuthenticatedCookieSession.mockReturnValue({ session: null });
    useService.mockReturnValue({ clearOrganization: vi.fn() });
    setActiveOrganizationAccount('account-a');

    render(
      <AppShell dirtyCount={0}>
        <span>content</span>
      </AppShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Open account menu/ }));
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Switch to account B' }),
    );
    expect(screen.getByText('Switch to B?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(activateAccount).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Open account menu/ }));
    fireEvent.click(
      await screen.findByRole('menuitem', { name: 'Switch to account B' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Switch account' }));
    await waitFor(() => expect(activateAccount).toHaveBeenCalledWith('account-b', undefined));
  });
  it('keeps the current account when Add Account returns the active identity', async () => {
    const activateAccount = vi.fn();
    useAuthProvider.mockReturnValue({
      accounts: vi.fn().mockResolvedValue([]),
      addAccount: vi.fn().mockRejectedValue(new Error('AUTH_ACCOUNT_ALREADY_ACTIVE')),
      activateAccount,
    });
    useGetIdentity.mockReturnValue({ identity: { fullName: 'Ada', email: 'ada@example.com' } });
    useGetSelectedOrganization.mockReturnValue({ data: { id: 'org-a', name: 'Org A' } });
    useSwitchToOrganization.mockReturnValue({ switchToOrganization: vi.fn(), loading: false });
    useGetMyOrganization.mockReturnValue({ data: { id: 'org-a', name: 'Org A' }, loading: false });
    useGetJoinedOrganizations.mockReturnValue({ data: [], loading: false });
    useAuthenticatedCookieSession.mockReturnValue({ session: null });
    useService.mockReturnValue({ clearOrganization: vi.fn() });

    render(
      <AppShell dirtyCount={0}>
        <span>content</span>
      </AppShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Open account menu/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add account' }));

    expect(await screen.findByText('This account is already active.')).toBeTruthy();
    expect(activateAccount).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Open account menu for Ada/ })).toBeTruthy();
  });
  it('ignores an old organization choice if the account changes during key purge', async () => {
    let releasePurge: () => void = () => {};
    const clearOrganization = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releasePurge = resolve;
        }),
    );
    const switchToOrganization = vi.fn().mockResolvedValue(undefined);
    useAuthProvider.mockReturnValue({ logout: vi.fn() });
    useGetIdentity.mockReturnValue({ identity: { fullName: 'Ada', email: 'ada@example.com' } });
    useGetSelectedOrganization.mockReturnValue({ data: { id: 'org-a', name: 'Org A' } });
    useSwitchToOrganization.mockReturnValue({ switchToOrganization, loading: false });
    useGetMyOrganization.mockReturnValue({ data: { id: 'org-a', name: 'Org A' }, loading: false });
    useGetJoinedOrganizations.mockReturnValue({
      data: [{ id: 'org-b', name: 'Org B' }],
      loading: false,
    });
    useAuthenticatedCookieSession.mockReturnValue({
      session: { sessionFamilyId: 'family-a', userId: 'A' },
    });
    useService.mockReturnValue({ clearOrganization });
    setActiveOrganizationAccount('account-a');

    render(
      <AppShell dirtyCount={0}>
        <span>content</span>
      </AppShell>,
    );
    fireEvent.click(screen.getByText('Org A'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Switch to Org B' }));
    await waitFor(() => expect(clearOrganization).toHaveBeenCalled());
    setActiveOrganizationAccount('account-b');
    await act(async () => {
      releasePurge();
    });
    expect(switchToOrganization).not.toHaveBeenCalled();
  });
  it('lets an in-progress Add Account browser flow be cancelled without switching', async () => {
    let rejectAdd: (error: Error) => void = () => {};
    const addAccount = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectAdd = reject;
        }),
    );
    const cancelLogin = vi.fn(async () => rejectAdd(new Error('AUTH_CANCELLED')));
    const activateAccount = vi.fn();
    useAuthProvider.mockReturnValue({
      accounts: vi.fn().mockResolvedValue([]),
      addAccount,
      cancelLogin,
      activateAccount,
    });
    useGetIdentity.mockReturnValue({ identity: { fullName: 'Ada', email: 'ada@example.com' } });
    useGetSelectedOrganization.mockReturnValue({ data: { id: 'org-a', name: 'Org A' } });
    useSwitchToOrganization.mockReturnValue({ switchToOrganization: vi.fn(), loading: false });
    useGetMyOrganization.mockReturnValue({ data: { id: 'org-a', name: 'Org A' }, loading: false });
    useGetJoinedOrganizations.mockReturnValue({ data: [], loading: false });
    useAuthenticatedCookieSession.mockReturnValue({ session: null });
    useService.mockReturnValue({ clearOrganization: vi.fn() });

    render(
      <AppShell dirtyCount={0}>
        <span>content</span>
      </AppShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Open account menu/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Add Account' }));

    await waitFor(() => expect(cancelLogin).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Cancel Add Account' })).toBeNull(),
    );
    expect(activateAccount).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Open account menu for Ada/ })).toBeTruthy();
  });
  it('confirms a saved-account switch and keeps account actions disabled during parsing', async () => {
    const activateAccount = vi.fn().mockResolvedValue(undefined);
    useAuthProvider.mockReturnValue({
      accounts: vi.fn().mockResolvedValue([
        { key: 'account-a', subject: 'A', active: true },
        { key: 'account-b', subject: 'B', active: false },
      ]),
      activateAccount,
    });
    useGetIdentity.mockReturnValue({ identity: { fullName: 'Ada', email: 'ada@example.com' } });
    useGetSelectedOrganization.mockReturnValue({ data: { id: 'org-a', name: 'Org A' } });
    useSwitchToOrganization.mockReturnValue({ switchToOrganization: vi.fn(), loading: false });
    useGetMyOrganization.mockReturnValue({ data: { id: 'org-a', name: 'Org A' }, loading: false });
    useGetJoinedOrganizations.mockReturnValue({ data: [], loading: false });
    useAuthenticatedCookieSession.mockReturnValue({ session: null });
    useService.mockReturnValue({ clearOrganization: vi.fn() });

    const view = render(
      <AppShell dirtyCount={0} accountActionsDisabled>
        <span>content</span>
      </AppShell>,
    );
    const opener = screen.getByRole('button', { name: /Open account menu/ });
    expect(opener.hasAttribute('disabled') || opener.getAttribute('aria-disabled') === 'true').toBe(
      true,
    );
    view.rerender(
      <AppShell dirtyCount={0}>
        <span>content</span>
      </AppShell>,
    );
    fireEvent.click(opener);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Switch to account Saved account' }));
    expect(activateAccount).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Switch account' }));
    await waitFor(() => expect(activateAccount).toHaveBeenCalledWith('account-b', undefined));
  });
  it('opens menus by keyboard, closes on Escape, and restores opener focus', () => {
    const logout = vi.fn();
    useAuthProvider.mockReturnValue({ logout });
    useGetIdentity.mockReturnValue({
      identity: { fullName: 'Ada Lovelace', email: 'ada@example.com' },
    });
    useGetSelectedOrganization.mockReturnValue({ data: { id: 'org-a', name: 'Org A' } });
    useSwitchToOrganization.mockReturnValue({ switchToOrganization: vi.fn(), loading: false });
    useGetMyOrganization.mockReturnValue({
      data: { id: 'org-a', name: 'Org A' },
      loading: false,
      isRefetching: false,
    });
    useGetJoinedOrganizations.mockReturnValue({ data: [], loading: false, isRefetching: false });
    useAuthenticatedCookieSession.mockReturnValue({ session: null });
    useService.mockReturnValue({ clearOrganization: vi.fn() });

    render(
      <AppShell dirtyCount={0}>
        <span>content</span>
      </AppShell>,
    );

    const opener = screen.getByRole('button', { name: /Change organisation/ });
    fireEvent.keyDown(opener, { key: 'Enter' });
    fireEvent.keyUp(opener, { key: 'Enter' });
    fireEvent.click(opener);
    expect(screen.getByRole('menu', { name: 'Organisations' })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Organisations' })).toBeNull();
    expect(document.activeElement).toBe(opener);

    const account = screen.getByRole('button', { name: /Open account menu/ });
    account.focus();
    fireEvent.keyDown(account, { key: ' ' });
    fireEvent.keyUp(account, { key: ' ' });
    fireEvent.click(account);
    expect(screen.getByRole('menu', { name: 'Account' })).toBeTruthy();
    const signOut = screen.getByRole('menuitem', { name: 'Log out' });
    fireEvent.keyDown(signOut, { key: 'Enter' });
    fireEvent.keyUp(signOut, { key: 'Enter' });
    fireEvent.click(signOut);
    expect(logout).toHaveBeenCalledOnce();
  });

  it('purges the outgoing organization key BEFORE switching to the picked organization', async () => {
    const order: string[] = [];
    const clearOrganization = vi.fn(async () => {
      order.push('clearOrganization');
    });
    const switchToOrganization = vi.fn(async () => {
      order.push('switchToOrganization');
    });

    useAuthProvider.mockReturnValue({ logout: vi.fn() });
    useGetIdentity.mockReturnValue({
      identity: { fullName: 'Ada Lovelace', email: 'ada@example.com' },
    });
    useGetSelectedOrganization.mockReturnValue({ data: { id: 'org-a', name: 'Org A' } });
    useSwitchToOrganization.mockReturnValue({ switchToOrganization, loading: false });
    useGetMyOrganization.mockReturnValue({
      data: { id: 'org-a', name: 'Org A' },
      loading: false,
      isRefetching: false,
    });
    useGetJoinedOrganizations.mockReturnValue({
      data: [{ id: 'org-b', name: 'Org B' }],
      loading: false,
      isRefetching: false,
    });
    useAuthenticatedCookieSession.mockReturnValue({
      session: { sessionFamilyId: 'family-1', userId: 'user-1' },
    });
    useService.mockReturnValue({ clearOrganization });

    render(
      <AppShell dirtyCount={0}>
        <span>content</span>
      </AppShell>,
    );

    fireEvent.click(screen.getByText('Org A'));
    const orgB = await screen.findByRole('menuitem', { name: 'Switch to Org B' });
    fireEvent.keyDown(orgB, { key: 'Enter' });
    fireEvent.keyUp(orgB, { key: 'Enter' });
    fireEvent.click(orgB);

    await waitFor(() => expect(switchToOrganization).toHaveBeenCalledWith('org-b'));
    expect(order).toEqual(['clearOrganization', 'switchToOrganization']);
    expect(clearOrganization).toHaveBeenCalledWith({
      organizationId: 'org-a',
      sessionFamilyId: 'family-1',
      userId: 'user-1',
    });
  });

  it('does not purge or switch when re-selecting the already-selected organization', async () => {
    const clearOrganization = vi.fn().mockResolvedValue(undefined);
    const switchToOrganization = vi.fn().mockResolvedValue(undefined);

    useAuthProvider.mockReturnValue({ logout: vi.fn() });
    useGetIdentity.mockReturnValue({
      identity: { fullName: 'Ada Lovelace', email: 'ada@example.com' },
    });
    useGetSelectedOrganization.mockReturnValue({ data: { id: 'org-a', name: 'Org A' } });
    useSwitchToOrganization.mockReturnValue({ switchToOrganization, loading: false });
    useGetMyOrganization.mockReturnValue({
      data: { id: 'org-a', name: 'Org A' },
      loading: false,
      isRefetching: false,
    });
    useGetJoinedOrganizations.mockReturnValue({ data: [], loading: false, isRefetching: false });
    useAuthenticatedCookieSession.mockReturnValue({
      session: { sessionFamilyId: 'family-1', userId: 'user-1' },
    });
    useService.mockReturnValue({ clearOrganization });

    render(
      <AppShell dirtyCount={0}>
        <span>content</span>
      </AppShell>,
    );

    fireEvent.click(screen.getByText('Org A'));
    const rows = await screen.findAllByText('Org A');
    // The dropdown row (second occurrence) is the currently-selected organization.
    fireEvent.click(rows[rows.length - 1]);

    expect(clearOrganization).not.toHaveBeenCalled();
    expect(switchToOrganization).not.toHaveBeenCalled();
  });
});
