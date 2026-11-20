import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlanGroupingSurface, type GroupingAsset, type PlanDraft } from '@modules/importer-preview/PlanGroupingSurface';

const assets: GroupingAsset[] = [
  { id: 'a', name: 'First credential', type: 'USER-PSWD', valid: true },
  { id: 'b', name: 'Second credential', type: 'USER-PSWD', valid: true },
];
const target = (id: string): PlanDraft => ({ id, name: id, assets: 0, capacity: '0/10', valid: true });
const folders = { folders: [], scope: 'SHARED' as const };
afterEach(cleanup);

it('clears drag and selection after a successful move even when the source rows unmount', () => {
  const assigned = vi.fn();
  function Fixture() {
    const [remaining, setRemaining] = useState(assets);
    const [plans, setPlans] = useState([target('Destination'), target('Other')]);
    return <PlanGroupingSurface unassigned={remaining} plans={plans} folders={folders} onAssignMany={(moving, plan) => {
      assigned(moving, plan);
      setRemaining((current) => current.filter((asset) => !moving.some((item) => item.id === asset.id)));
      setPlans((current) => current.map((item) => item.id === plan.id ? { ...item, assets: moving.length, assignedAssets: moving } : item));
    }} />;
  }
  render(<Fixture />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select First credential' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second credential' }));
  fireEvent.dragStart(screen.getByText('First credential'));
  fireEvent.drop(screen.getByRole('treeitem', { name: /Destination/ }));
  expect(assigned).toHaveBeenCalledExactlyOnceWith(assets, expect.objectContaining({ id: 'Destination' }));
  expect(screen.queryByText('2 selected')).toBeNull();
  expect(document.querySelector('.plan-asset-row.is-dragged')).toBeNull();
  fireEvent.drop(screen.getByRole('treeitem', { name: /Other/ }));
  expect(assigned).toHaveBeenCalledTimes(1);
});

it('finishes a cancelled drag without losing the selection or leaving a stale payload', () => {
  const assigned = vi.fn();
  render(<PlanGroupingSurface unassigned={assets} plans={[target('Destination')]} folders={folders} onAssignMany={assigned} />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select First credential' }));
  fireEvent.dragStart(screen.getByText('First credential'));
  expect(document.querySelector('.plan-asset-row.is-dragged')).toBeTruthy();
  fireEvent(window, new Event('dragend'));
  expect(screen.getByText('1 selected')).toBeTruthy();
  expect(document.querySelector('.plan-asset-row.is-dragged')).toBeNull();
  fireEvent.drop(screen.getByRole('treeitem', { name: /Destination/ }));
  expect(assigned).not.toHaveBeenCalled();
});
