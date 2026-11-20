import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FlowActions } from '@modules/importer-preview/ImporterFlow/components/FlowActions';
import {
  PlanGroupingSurface,
  type GroupingAsset,
} from '@modules/importer-preview/PlanGroupingSurface';

afterEach(cleanup);

it('only animates the arrow of an enabled Continue action', () => {
  const props = { canGoBack: true, onBack: vi.fn(), onNext: vi.fn(), showComplete: true };
  const { container, rerender } = render(<FlowActions {...props} canGoNext nextLabel="Continue" />);
  const continueButton = screen.getByRole('button', { name: 'Continue' });
  const arrow = within(continueButton).getByLabelText('chevron-right');
  expect(arrow.closest('.importer-continue-arrow')).toBeTruthy();
  fireEvent.click(continueButton);
  expect(props.onNext).toHaveBeenCalledTimes(1);

  rerender(<FlowActions {...props} canGoNext={false} nextLabel="Continue" />);
  expect(container.querySelector('.importer-continue-arrow')).toBeNull();
  expect(within(continueButton).getByLabelText('chevron-right')).toBeTruthy();

  rerender(<FlowActions {...props} canGoNext nextLabel="Encrypt and stage" />);
  expect(container.querySelector('.importer-continue-arrow')).toBeNull();
});

it('opens Create Plans with a flat asset list and lets the user switch to the source tree', () => {
  const asset: GroupingAsset = {
    id: 'a',
    name: 'Credential',
    type: 'USER-PSWD',
    source: 'vault.json',
    folderPath: ['Payments'],
    valid: true,
  };
  render(
    <PlanGroupingSurface
      unassigned={[asset]}
      plans={[]}
      folders={{ scope: 'SHARED', folders: [], onCreateFolder: vi.fn(), onRenameFolder: vi.fn() }}
    />,
  );
  const picker = within(screen.getByRole('group', { name: 'Asset view' }));
  const list = picker.getByRole('button', { name: 'List' });
  const tree = picker.getByRole('button', { name: 'Tree' });
  expect(list.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByLabelText('Unassigned assets list')).toBeTruthy();
  expect(screen.getByText('Credential')).toBeTruthy();
  expect(screen.queryByText('Payments')).toBeNull();

  fireEvent.click(tree);
  expect(tree.getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByLabelText('Unassigned assets tree')).toBeTruthy();
  expect(screen.getByText('Payments')).toBeTruthy();

  fireEvent.click(list);
  expect(screen.queryByText('Payments')).toBeNull();
});
