import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AccountDestinations } from '@modules/import/ui/components/AccountDestinations';

afterEach(cleanup);

it('keeps account switching and removal as separate actions for inactive accounts', () => {
  const onSwitch = vi.fn();
  const onRemove = vi.fn();
  const active = { key: 'active', subject: 'owner', active: true };
  const inactive = { key: 'inactive', subject: 'manager', active: false };

  render(
    <AccountDestinations
      accounts={[active, inactive]}
      destinations={[{ accountKey: 'inactive', subject: 'manager', status: 'ready', displayName: 'Manager', organizations: [] }]}
      onSwitch={onSwitch}
      onRemove={onRemove}
    />,
  );

  expect(screen.queryByRole('menuitem', { name: 'Remove saved account owner' })).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Remove saved account manager' }));
  expect(onRemove).toHaveBeenCalledWith(inactive);
  expect(onSwitch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Switch to account Manager' }));
  expect(onSwitch).toHaveBeenCalledWith(inactive);
});
