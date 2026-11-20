import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { OrganizationFolderTree } from '@modules/importer-preview/PlanGroupingSurface/components/OrganizationFolderTree';
import type {
  FolderWorkspaceProps,
  PlanDraft,
} from '@modules/importer-preview/PlanGroupingSurface';

afterEach(cleanup);
const folder: FolderWorkspaceProps['folders'][number] = {
  id: 'f',
  name: 'Finance',
  parentId: null,
  scope: 'SHARED',
  revision: 1,
  effectivePolicy: { teams: { allow: ['team'], deny: [] } },
};
const workspace: FolderWorkspaceProps = {
  scope: 'SHARED',
  folders: [folder],
};
const plans: PlanDraft[] = [
  {
    id: 'one',
    name: 'First plan',
    assets: 1,
    capacity: '10',
    valid: true,
    folderId: 'f',
    assignedAssets: [{ id: 'asset', name: 'Credential', type: 'USER-PSWD' }],
  },
  { id: 'two', name: 'Second plan', assets: 0, capacity: '10', valid: true, folderId: 'f' },
];
const renderTree = (props: Partial<React.ComponentProps<typeof OrganizationFolderTree>> = {}) =>
  render(<OrganizationFolderTree workspace={workspace} plans={plans} dragAssets={[]} {...props} />);

describe('right folder tree', () => {
  it('opens folders and inline plan assets independently from the plan modal', () => {
    const select = vi.fn();
    renderTree({ onSelectPlan: select });
    fireEvent.click(screen.getByText('Finance'));
    expect(screen.getByText('First plan')).toBeTruthy();
    expect(screen.queryByText(/Draft/)).toBeNull();
    const planRow = screen.getByRole('treeitem', { name: /First plan/ });
    fireEvent.click(planRow);
    expect(screen.getByText('Credential')).toBeTruthy();
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(planRow);
    expect(screen.queryByText('Credential')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand First plan' }));
    expect(screen.getByText('Credential')).toBeTruthy();
    expect(select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'First plan' }));
    expect(select).toHaveBeenCalledWith(plans[0]);
    const name = screen.getByText('Credential');
    expect(name.className).toContain('folder-plan-asset-name');
  });
  it('selects multiple drafts and sends one atomic move request', () => {
    const move = vi.fn();
    renderTree({ onMovePlans: move });
    fireEvent.click(screen.getByText('Finance'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select First plan' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move to folder' }));
    const dialog = screen.getByRole('dialog', { name: 'Move 2 plans' });
    expect(move).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('combobox', { name: 'Destination' }));
    fireEvent.click(within(dialog).getByRole('option', { name: 'Organisation root' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move plans' }));
    expect(move).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledWith(plans, null, 'SHARED');
  });

  it('keeps folder rows checkbox-free and selects them only with Ctrl', () => {
    const second = { ...folder, id: 'g', name: 'Engineering' };
    renderTree({ workspace: { ...workspace, folders: [folder, second] }, plans: [] });
    const finance = screen.getByRole('treeitem', { name: /Finance/ });
    expect(finance.querySelector('input[type="checkbox"]')).toBeNull();
    fireEvent.click(finance);
    expect(finance.getAttribute('aria-selected')).toBe('false');
    fireEvent.click(finance, { ctrlKey: true });
    expect(finance.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('1 folder selected')).toBeTruthy();
  });

  it('clears a folder drop highlight on mouseup, drop, and dragend', () => {
    renderTree({ dragAssets: [{ id: 'drag', name: 'Dragged', type: 'USER-PSWD', valid: true }], onCreatePlansFromAssets: vi.fn() });
    const finance = screen.getByRole('treeitem', { name: /Finance/ });
    fireEvent.dragOver(finance);
    expect(finance.className).toContain('over-valid');
    fireEvent.mouseUp(window);
    expect(finance.className).not.toContain('over-valid');
    fireEvent.dragOver(finance);
    fireEvent.drop(finance);
    expect(finance.className).not.toContain('over-valid');
    fireEvent.dragOver(finance);
    fireEvent(window, new Event('dragend'));
    expect(finance.className).not.toContain('over-valid');
  });
});

it('expands an empty plan with an aligned asset drop hint', () => {
  renderTree();
  fireEvent.click(screen.getByText('Finance'));
  const row = screen.getByRole('treeitem', { name: /Second plan/ });
  fireEvent.click(row);
  expect(row.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByText('Drag and drop an asset')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Collapse Second plan' })).toBeTruthy();
  expect(screen.queryByText('No assets yet')).toBeNull();
});


it('accepts an asset on the expanded empty plan hint', () => {
  const asset = { id: 'new', name: 'New credential', type: 'USER-PSWD', valid: true };
  const assign = vi.fn();
  renderTree({ dragAssets: [asset], onAssignMany: assign });
  fireEvent.click(screen.getByText('Finance'));
  fireEvent.click(screen.getByRole('button', { name: 'Expand Second plan' }));
  fireEvent.drop(screen.getByText('Drag and drop an asset'));
  expect(assign).toHaveBeenCalledExactlyOnceWith([asset], expect.objectContaining({ id: 'two' }));
});


it('extends plan selection in displayed order without including collapsed folders', () => {
  const hiddenFolder = { ...folder, id: 'hidden-folder', name: 'Engineering' };
  const hidden = { ...plans[1]!, id: 'hidden', name: 'Hidden plan', folderId: hiddenFolder.id };
  renderTree({ workspace: { ...workspace, folders: [folder, hiddenFolder] }, plans: [plans[0]!, hidden, plans[1]!] });
  fireEvent.click(screen.getByText('Finance'));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select First plan' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second plan' }), { shiftKey: true });
  expect(screen.getByText('2 plans selected')).toBeTruthy();
  expect(screen.queryByText('3 plans selected')).toBeNull();
});


it('keeps tree state unchanged when editing teams and saves permissions only explicitly', async () => {
  const changeTarget = vi.fn();
  const save = vi.fn();
  renderTree({ workspace: { ...workspace, teams: [{ id: 'team', name: 'Operations' }], onPreviewFolderChange: vi.fn().mockResolvedValue({ affectedPlanIds: [], addedTeamIds: [], removedTeamIds: [], addedDeniedTeamIds: [], removedDeniedTeamIds: [], blockers: [] }), onChangeFolderPolicy: save }, onTargetFolderChange: changeTarget });
  const finance = screen.getByText('Finance').closest('[role="treeitem"]')!;
  const callsBefore = changeTarget.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Finance' }));
  fireEvent.click(screen.getByRole('button', { name: 'Permissions' }));
  const dialog = screen.getByRole('dialog', { name: 'Permissions for Finance' });
  const search = within(dialog).getByRole('textbox', { name: 'Search teams' });
  fireEvent.focus(search);
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Operations' }));
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(within(dialog).queryByRole('checkbox', { name: 'Operations' })).toBeNull();
  fireEvent.keyDown(search, { key: 'ArrowDown' });
  expect(within(dialog).getByRole<HTMLInputElement>('checkbox', { name: 'Operations' }).checked).toBe(true);
  await within(dialog).findByText('Plans affected: 0');
  expect(finance.getAttribute('aria-expanded')).toBe('false');
  expect(changeTarget).toHaveBeenCalledTimes(callsBefore);
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(save).not.toHaveBeenCalled();
  expect(finance.getAttribute('aria-expanded')).toBe('false');
});
