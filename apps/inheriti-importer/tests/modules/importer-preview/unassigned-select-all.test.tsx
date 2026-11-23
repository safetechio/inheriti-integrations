// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  PlanGroupingSurface,
  type GroupingAsset,
} from '@modules/importer-preview/PlanGroupingSurface';

afterEach(cleanup);

function asset(id: string, name: string, sourceId = 'primary'): GroupingAsset {
  return {
    id,
    name,
    sourceId,
    source: `${sourceId}.csv`,
    type: 'USER-PSWD',
    valid: true,
  };
}

it('selects every matching asset across list pages and tree branches using the same scope as Ctrl+A', () => {
  const matching = Array.from({ length: 101 }, (_, index) =>
    asset(`billing-${index}`, `Billing ${index}`),
  );
  render(
    <PlanGroupingSurface
      unassigned={[
        ...matching,
        asset('same-source', 'Network'),
        asset('other-source', 'Billing other', 'secondary'),
      ]}
      plans={[
        {
          id: 'plan',
          name: 'Existing plan',
          assets: 1,
          capacity: '1 / 10 Assets',
          valid: true,
          assignedAssets: [asset('assigned', 'Billing assigned')],
        },
      ]}
      folders={{ folders: [], scope: 'SHARED' }}
      onAssignMany={vi.fn()}
      onUnassignMany={vi.fn()}
    />,
  );
  const selectAll = screen.getByRole('button', { name: 'Select all', exact: true });
  const search = screen.getByRole('textbox', { name: 'Search unassigned assets' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Filter unassigned assets by source' }), {
    target: { value: 'primary' },
  });
  fireEvent.change(search, { target: { value: 'Billing' } });

  expect(screen.getAllByRole('checkbox', { name: /^Select Billing/ })).toHaveLength(100);
  fireEvent.click(selectAll);
  expect(screen.getByText('101 selected')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Tree' }));
  fireEvent.click(selectAll);
  expect(screen.getByText('101 selected')).toBeTruthy();

  fireEvent.keyDown(selectAll, { key: 'Escape' });
  expect(screen.queryByText('101 selected')).toBeNull();
  fireEvent.keyDown(selectAll, { key: 'a', ctrlKey: true });
  expect(screen.getByText('101 selected')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Assigned · 1' }));
  fireEvent.click(selectAll);
  expect(screen.getByText('1 selected')).toBeTruthy();

  fireEvent.change(search, { target: { value: 'Nothing matches' } });
  expect(selectAll.getAttribute('aria-disabled')).toBe('true');
  expect(screen.queryByText('1 selected')).toBeNull();
});
