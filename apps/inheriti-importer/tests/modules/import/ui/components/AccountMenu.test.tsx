import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('@modules/organization/infrastructure/importer-api', () => ({
  useGetIdentity: () => ({ identity: { fullName: 'Ada Lovelace', email: 'ada@example.com' } }),
}));
vi.mock('@modules/organization/infrastructure/organization-resources-api', () => ({
  useGetCurrentMember: () => ({ member: { role: { name: 'Tenant Admin' } } }),
}));
let mockAccounts: Array<{ key: string; subject: string; active: boolean }> = [];
vi.mock('@modules/import/ui/components/AccountMenu/hooks/use-account-menu', () => ({
  useAccountMenu: () => ({ accounts: mockAccounts, destinations: [], destinationsLoading: false, pendingAccount: null,
    setPendingAccount: vi.fn(), confirmSignOutAll: false, setConfirmSignOutAll: vi.fn(), accountError: null,
    authNotice: null, accountBusy: false, addingAccount: false }),
}));

import { AccountMenu } from '@modules/import/ui/components/AccountMenu';

afterEach(() => { cleanup(); mockAccounts = []; });

it('shows current account email between name and role', () => {
  const { container } = render(<AccountMenu menuRef={{ current: null }} open setOpen={vi.fn()} closeMenu={vi.fn()} closeOrganizationMenu={vi.fn()} />);
  const current = container.querySelector('.account-menu-current');
  expect(current?.textContent).toContain('Ada Lovelaceada@example.comOrganisation Admin');
  expect(screen.getByText('ada@example.com')).toBeTruthy();
});

it('offers a hover unlink action for the active account and confirms it', () => {
  mockAccounts = [{ key: 'active', subject: 'owner', active: true }];
  render(<AccountMenu menuRef={{ current: null }} open setOpen={vi.fn()} closeMenu={vi.fn()} closeOrganizationMenu={vi.fn()} />);
  const action = screen.getByRole('menuitem', { name: 'Unlink Ada Lovelace from this device' });
  expect(action.parentElement?.getAttribute('title')).toBe('Unlink Ada Lovelace from this device');
  fireEvent.click(action);
  expect(screen.getByText('Unlink account?')).toBeTruthy();
  expect(screen.getByText('Account:')).toBeTruthy();
  expect(screen.getByText('Unlink account')).toBeTruthy();
});
