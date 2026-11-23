import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

const otherAsset = { ...asset, id: 'b', name: 'Backup' };
const freshAsset = { ...asset, id: 'c', name: 'New credential' };
const targetPlan = { ...plan, id: 'target', name: 'Target plan' };

function renderFolderGrouping(onAssignMany = vi.fn()) {
  render(<PlanGroupingSurface
    unassigned={[freshAsset]}
    plans={[{ ...plan, assets: 2, assignedAssets: [asset, otherAsset] }, targetPlan]}
    folders={{
      scope: 'SHARED',
      folders: [{ id: 'folder', name: 'Folder A', parentId: null, scope: 'SHARED', revision: 1 }],
      onDeleteFolders: vi.fn(),
    }}
    onAssignMany={onAssignMany}
    onDeletePlans={vi.fn()}
  />);
  fireEvent.click(screen.getByRole('button', { name: 'Expand Plan A' }));
  const tree = screen.getByRole('tree', { name: 'Organisation folders' });
  return { tree, source: screen.getByText('Unassigned assets').closest<HTMLElement>('.plan-grouping-unassigned')! };
}

it.each(['List', 'Tree'])('drags only the filtered source asset in %s view when the organisation has a different selection', (view) => {
  const onAssignMany = vi.fn();
  const { tree, source } = renderFolderGrouping(onAssignMany);
  if (view === 'Tree') fireEvent.click(within(source).getByRole('button', { name: 'Tree', exact: true }));
  fireEvent.click(within(source).getByRole('button', { name: 'Assigned · 2' }));
  fireEvent.change(within(source).getByRole('textbox'), { target: { value: asset.name } });
  fireEvent.click(within(tree).getByRole('checkbox', { name: 'Select Credential' }));
  fireEvent.click(within(tree).getByRole('checkbox', { name: 'Select Backup' }));
  const transfer = { types: [], setData: vi.fn(), getData: vi.fn(), setDragImage: vi.fn() };
  const dragged = view === 'Tree'
    ? within(source).getByRole('checkbox', { name: 'Select source vault.json' }).closest('.plan-source-group')!
    : within(source).getByText('Credential');
  fireEvent.dragStart(dragged, { dataTransfer: transfer });
  expect((within(source).getByRole('checkbox', { name: 'Select Credential' }) as HTMLInputElement).checked).toBe(false);
  if (view === 'Tree') {
    expect((within(source).getByRole('checkbox', { name: 'Select source vault.json' }) as HTMLInputElement).checked).toBe(false);
  }
  expect(transfer.setDragImage.mock.calls[0]?.[0].querySelector('[data-drag-layer]')).toBeNull();
  fireEvent.drop(within(tree).getByText('Target plan'), { dataTransfer: transfer });
  expect(onAssignMany.mock.calls[0]?.[0].map((item: typeof asset) => item.id)).toEqual(['a']);
});

it('selects plans only when Ctrl+A is pressed on a focused organisation tree after source selection', () => {
  const { tree, source } = renderFolderGrouping();
  const sourceAsset = (within(source).getByRole('checkbox', { name: 'Select New credential' }) as HTMLInputElement);
  fireEvent.click(sourceAsset);
  tree.focus();
  fireEvent.keyDown(tree, { key: 'a', ctrlKey: true });
  expect(sourceAsset.checked).toBe(false);
  expect(screen.getByText('2 plans selected')).toBeTruthy();
  expect((within(tree).getByRole('checkbox', { name: 'Select Credential' }) as HTMLInputElement).checked).toBe(false);
});

it('lets focused asset and plan checkboxes choose the Ctrl+A selection kind', () => {
  const { tree, source } = renderFolderGrouping();
  const rightAsset = (within(tree).getByRole('checkbox', { name: 'Select Credential' }) as HTMLInputElement);
  const rightBackup = (within(tree).getByRole('checkbox', { name: 'Select Backup' }) as HTMLInputElement);
  const rightPlan = (within(tree).getByRole('checkbox', { name: 'Select Plan A' }) as HTMLInputElement);
  fireEvent.click(rightAsset);
  rightPlan.focus();
  fireEvent.keyDown(rightPlan, { key: 'a', ctrlKey: true });
  expect(rightPlan.checked).toBe(true);
  expect(rightAsset.checked).toBe(false);
  expect(screen.getByText('2 plans selected')).toBeTruthy();
  rightAsset.focus();
  fireEvent.keyDown(rightAsset, { key: 'a', ctrlKey: true });
  expect(rightAsset.checked).toBe(true);
  expect(rightBackup.checked).toBe(true);
  expect(rightPlan.checked).toBe(false);
  const sourceAsset = (within(source).getByRole('checkbox', { name: 'Select New credential' }) as HTMLInputElement);
  sourceAsset.focus();
  fireEvent.keyDown(sourceAsset, { key: 'a', ctrlKey: true });
  expect(sourceAsset.checked).toBe(true);
  expect(rightAsset.checked).toBe(false);
});

it('leaves text selection, repeated shortcuts and input composition alone', () => {
  const { tree, source } = renderFolderGrouping();
  const search = within(source).getByRole('textbox');
  search.focus();
  expect(fireEvent.keyDown(search, { key: 'a', ctrlKey: true })).toBe(true);
  const rightAsset = within(tree).getByRole('checkbox', { name: 'Select Credential' }) as HTMLInputElement;
  rightAsset.focus();
  expect(fireEvent.keyDown(rightAsset, { key: 'a', ctrlKey: true, repeat: true })).toBe(true);
  expect(fireEvent.keyDown(rightAsset, { key: 'a', ctrlKey: true, isComposing: true })).toBe(true);
  expect(rightAsset.checked).toBe(false);
  const sourceAsset = within(source).getByRole('checkbox', { name: 'Select New credential' }) as HTMLInputElement;
  sourceAsset.focus();
  expect(fireEvent.keyDown(sourceAsset, { key: 'a', ctrlKey: true, repeat: true })).toBe(true);
  expect(fireEvent.keyDown(sourceAsset, { key: 'a', ctrlKey: true, isComposing: true })).toBe(true);
  expect(sourceAsset.checked).toBe(false);
});

it.each(['Plan A', 'Folder A'])('clears the %s selection when Ctrl+A selects source assets', (name) => {
  const { tree, source } = renderFolderGrouping();
  const rightSelection = name === 'Plan A'
    ? within(tree).getByRole('checkbox', { name: 'Select Plan A' })
    : within(tree).getByText('Folder A').closest<HTMLElement>('[role="treeitem"]')!;
  const isSelected = () => rightSelection instanceof HTMLInputElement
    ? rightSelection.checked
    : rightSelection.getAttribute('aria-selected') === 'true';
  rightSelection.focus();
  fireEvent.click(rightSelection, { ctrlKey: name === 'Folder A' });
  expect(isSelected()).toBe(true);
  expect(screen.getByRole('button', { name: 'Delete selected' })).toBeTruthy();

  const sourceList = within(source).getByLabelText('Unassigned assets list');
  sourceList.focus();
  fireEvent.keyDown(sourceList, { key: 'a', ctrlKey: true });

  const sourceSelection = within(source).getAllByRole('checkbox', { checked: true });
  expect(sourceSelection).toHaveLength(1);
  expect(sourceSelection[0]).toBe(within(source).getByRole('checkbox', { name: 'Select New credential' }));
  expect(isSelected()).toBe(false);
  expect(screen.queryByRole('button', { name: 'Delete selected' })).toBeNull();
});
