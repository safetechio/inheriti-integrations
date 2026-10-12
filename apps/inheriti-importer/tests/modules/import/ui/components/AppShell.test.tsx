import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const useAuthProvider = vi.fn();
const useGetIdentity = vi.fn();
const useGetSelectedOrganization = vi.fn();
const useSwitchToOrganization = vi.fn();
const useGetJoinedOrganizations = vi.fn();
const useGetMyOrganization = vi.fn();
const useAuthenticatedCookieSession = vi.fn();
const useService = vi.fn();

vi.mock('@shared/infrastructure/importer-api', () => ({
  useAuthProvider: (...args: unknown[]) => useAuthProvider(...args),
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

import { AppShell } from '@modules/import/ui/components/AppShell';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AppShell account-menu organization switcher', () => {
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
    const signOut = screen.getByRole('menuitem', { name: 'Sign out' });
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
