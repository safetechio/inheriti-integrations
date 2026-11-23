import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PlanGroupingSurface } from '@modules/importer-preview/PlanGroupingSurface';
import { AssetSelectionToolbar } from '@modules/importer-preview/PlanGroupingSurface/components/AssetSelectionToolbar';
import { setItemDragImage } from '@modules/_shared/ui/drag/set-item-drag-image';

const asset = { id: 'a', name: 'Credential', type: 'USER-PSWD', source: 'vault.json', valid: true };
const plan = { id: 'p', name: 'Plan A', assets: 0, capacity: '0/10', valid: true };
afterEach(cleanup);

it('keeps plain clicks and native drags separate from selection, and supports modifier clicks', () => {
  render(<PlanGroupingSurface unassigned={[asset]} plans={[]} folders={{ scope: 'SHARED', folders: [] }} onAssignMany={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Tree', exact: true }));
  const checkbox = screen.getByRole('checkbox', { name: 'Select Credential' }) as HTMLInputElement;
  fireEvent.click(screen.getByText('Credential'));
  expect(checkbox.checked).toBe(false);
  fireEvent.click(screen.getAllByText('vault.json')[1]!);
  expect(checkbox.checked).toBe(false);
  fireEvent.dragStart(screen.getByText('Credential'));
  expect(checkbox.checked).toBe(false);
  fireEvent.dragStart(screen.getAllByText('vault.json')[1]!);
  expect(checkbox.checked).toBe(false);
  fireEvent.click(checkbox);
  expect(checkbox.checked).toBe(true);
  fireEvent.click(screen.getByText('Credential'), { ctrlKey: true });
  expect(checkbox.checked).toBe(false);
  fireEvent.click(screen.getByText('Credential'), { metaKey: true });
  expect(checkbox.checked).toBe(true);
  fireEvent.click(screen.getAllByText('vault.json')[1]!, { ctrlKey: true });
  expect(checkbox.checked).toBe(false);
});

it('searches plans and moves only the additions for an eligible target', () => {
  const onMove = vi.fn();
  render(<AssetSelectionToolbar assets={[asset]} plans={[plan, { ...plan, id: 'full', name: 'Full plan', assets: 10 }]} targetId="" onTarget={vi.fn()} onClear={vi.fn()} onMove={onMove} />);
  fireEvent.click(screen.getByRole('button', { name: 'Assign to plan' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Search plans' }), { target: { value: 'full' } });
  expect((screen.getByRole('button', { name: /Full plan/ }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole('textbox', { name: 'Search plans' }), { target: { value: 'Plan A' } });
  fireEvent.click(screen.getByRole('button', { name: /Plan A/ }));
  expect(onMove).toHaveBeenCalledWith([asset], plan);
});

it('removes the drag preview on the next frame without inserting markup as HTML', () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return 1; });
  const source = document.createElement('div');
  const transfer = { setDragImage: vi.fn(), effectAllowed: 'none' } as unknown as DataTransfer;
  setItemDragImage(transfer, source, '<secret>', 2, '2 assets');
  const preview = document.querySelector('[data-testid="item-drag-preview"]')!;
  expect(preview.textContent).toContain('<secret>');
  expect(preview.querySelector('secret')).toBeNull();
  expect(transfer.effectAllowed).toBe('move');
  frames[0]!(0);
  expect(document.querySelector('[data-testid="item-drag-preview"]')).toBeNull();
  vi.unstubAllGlobals();
});


it('explains an existing assignment without claiming the current plan is full', () => {
  render(<AssetSelectionToolbar assets={[asset]} plans={[{ ...plan, assets: 1, assignedAssets: [asset] }]} targetId="" onTarget={vi.fn()} onClear={vi.fn()} onMove={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Move to plan' }));
  expect(screen.getByText('Already assigned')).toBeTruthy();
  expect(screen.getByText('Choose another plan to move these assets.')).toBeTruthy();
  expect(screen.queryByText(/No destination has enough space/)).toBeNull();
});


it('labels the active asset view so assigned assets are not mistaken for unassigned ones', () => {
  render(<PlanGroupingSurface unassigned={[]} plans={[{ ...plan, assets: 1, assignedAssets: [asset] }]} folders={{ scope: 'SHARED', folders: [] }} onAssignMany={vi.fn()} />);
  expect(screen.getByText('Unassigned assets')).toBeTruthy();
  expect(screen.queryByText('Credential')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Assigned · 1' }));
  expect(screen.getByText('Assigned assets')).toBeTruthy();
  expect(screen.getByText('Credential')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'All · 1' }));
  expect(screen.getByText('All assets')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Unassigned · 0' }));
  expect(screen.getByText('Unassigned assets')).toBeTruthy();
  expect(screen.queryByText('Credential')).toBeNull();
});


it.each([false, true])('explains moving assigned assets into new plans (mixed selection = %s)', (mixed) => {
  const fresh = { ...asset, id: 'fresh', name: 'Fresh credential' };
  const selected = mixed ? [asset, fresh] : [asset];
  const onCreate = vi.fn();
  const onMove = vi.fn();
  const target = { ...plan, id: 'target', name: 'Target plan' };
  render(<AssetSelectionToolbar
    assets={selected}
    plans={[{ ...plan, assets: 1, assignedAssets: [asset] }, target]}
    onCreate={onCreate} onClear={vi.fn()} onMove={onMove}
  />);
  expect(screen.queryByRole('button', { name: 'New plan', exact: true })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Assign to plan', exact: true })).toBeNull();
  const create = screen.getByRole('button', { name: 'Move to new plan', exact: true });
  fireEvent.mouseEnter(create.parentElement!);
  expect(screen.getByRole('tooltip').textContent).toContain('1 assigned asset leaves its current plan');
  fireEvent.click(create);
  expect(onCreate).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Move to plan', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: /Target plan/ }));
  expect(onMove).toHaveBeenCalledWith(selected, target);
});
