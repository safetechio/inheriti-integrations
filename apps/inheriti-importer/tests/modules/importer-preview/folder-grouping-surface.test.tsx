import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlanGroupingSurface } from '@modules/importer-preview/PlanGroupingSurface';
import type {
  FolderWorkspaceProps,
  GroupingAsset,
} from '@modules/importer-preview/PlanGroupingSurface';

afterEach(cleanup);

const asset: GroupingAsset = {
  id: 'a',
  name: 'Credential',
  type: 'USER-PSWD',
  source: 'vault.json',
  folderPath: ['payments'],
  valid: true,
};
const folders: FolderWorkspaceProps = {
  scope: 'SHARED',
  folders: [
    {
      id: 'finance',
      name: 'Finance',
      parentId: null,
      scope: 'SHARED',
      revision: 1,
      effectivePolicy: { teams: { allow: ['team-1'], deny: [] } },
    },
  ],
  onCreateFolder: vi.fn(async () => {}),
  onRenameFolder: vi.fn(async () => {}),
};

describe('folder grouping surface', () => {
  it('shows organisation search without a shared/private switch', () => {
    render(<PlanGroupingSurface unassigned={[asset]} plans={[]} folders={folders} />);
    expect(screen.queryByRole('button', { name: 'Shared', exact: true })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Private', exact: true })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Search folders or plans' })).toBeTruthy();
  });

  it('shows a mixed source checkbox when only one child is selected', () => {
    render(<PlanGroupingSurface unassigned={[
      { ...asset, id: 'a' },
      { ...asset, id: 'b', name: 'Other credential' },
    ]} plans={[]} folders={folders} onAssignMany={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tree' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Credential' }));
    const source = screen.getByRole('checkbox', { name: 'Select source vault.json' }) as HTMLInputElement;
    expect(source.indeterminate).toBe(true);
    expect(source.getAttribute('aria-checked')).toBe('mixed');
  });
  it('closes the previous folder menu when another folder menu opens', () => {
    render(<PlanGroupingSurface unassigned={[]} plans={[]} folders={{ ...folders, folders: [
      folders.folders[0]!,
      { ...folders.folders[0]!, id: 'engineering', name: 'Engineering' },
    ] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Finance' }));
    const other = screen.getByRole('button', { name: 'Actions for Engineering' });
    fireEvent.mouseDown(other);
    fireEvent.click(other);
    expect(screen.getAllByRole('button', { name: 'Rename' })).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
  });
  it('extends Shift selection in the visible tree order without including collapsed folders', () => {
    render(<PlanGroupingSurface unassigned={[
      { ...asset, id: 'a', name: 'First A', folderPath: ['A'] },
      { ...asset, id: 'b', name: 'Hidden B', folderPath: ['B'] },
      { ...asset, id: 'c', name: 'Second A', folderPath: ['A'] },
    ]} plans={[]} folders={folders} onAssignMany={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tree' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select First A' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second A' }), { shiftKey: true });
    expect(screen.getByText('2 selected')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'Select Hidden B' })).toBeNull();
  });
  it('creates and renames folders through callbacks without adding fake rows', async () => {
    const workspace = {
      ...folders,
      onCreateFolder: vi.fn(async () => {}),
      onRenameFolder: vi.fn(async () => {}),
    };
    render(<PlanGroupingSurface unassigned={[asset]} plans={[]} folders={workspace} />);
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New folder name' }), {
      target: { value: 'Engineering' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'New folder name' }), { key: 'Enter' });
    await waitFor(() =>
      expect(workspace.onCreateFolder).toHaveBeenCalledWith({
        name: 'Engineering',
        parentId: null,
        scope: 'SHARED',
        policy: null,
      }),
    );
    expect(screen.queryByText('Engineering')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Finance' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Rename Finance' }), {
      target: { value: 'Finance team' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Rename Finance' }), { key: 'Enter' });
    await waitFor(() =>
      expect(workspace.onRenameFolder).toHaveBeenCalledWith(workspace.folders[0], 'Finance team'),
    );
  });

  it('groups assets by source path and drops selected assets onto a folder', () => {
    const create = vi.fn();
    render(
      <PlanGroupingSurface
        unassigned={[asset]}
        plans={[]}
        folders={folders}
        onCreatePlansFromAssets={create}
        onAssignMany={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tree' }));
    expect(screen.getAllByText('vault.json').length).toBeGreaterThan(0);
    expect(screen.getByText('payments')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Credential' }));
    fireEvent.dragStart(screen.getByText('Credential'));
    fireEvent.drop(screen.getByText('Finance'));
    expect(create).toHaveBeenCalledWith([asset], {
      name: 'Credential',
      folderId: 'finance',
      scope: 'SHARED',
    });
  });

  it('blocks shared plan creation without folder teams and creates a folder by name only', async () => {
    const create = vi.fn();
    const onCreateFolder = vi.fn(async () => {});
    render(
      <PlanGroupingSurface
        unassigned={[asset]}
        plans={[]}
        folders={{
          ...folders,
          folders: [{ ...folders.folders[0]!, effectivePolicy: null }],
          teams: [{ id: 'team-1', name: 'Operations' }],
          onCreateFolder,
        }}
        onCreatePlansFromAssets={create}
      />,
    );
    fireEvent.dragStart(screen.getByText('Credential'));
    fireEvent.drop(screen.getByText('Finance'));
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Finance'));
    expect(
      screen.getByText('Set folder permissions before creating plans here.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'New folder name' }), {
      target: { value: 'Operations' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'New folder name' }), { key: 'Enter' });
    await waitFor(() =>
      expect(onCreateFolder).toHaveBeenCalledWith({
        name: 'Operations',
        parentId: null,
        scope: 'SHARED',
        policy: null,
      }),
    );
  });

  it('creates at top level and creates selected assets in the chosen folder', () => {
    const onCreatePlan = vi.fn();
    const create = vi.fn(() => ['new-plan']);
    render(
      <PlanGroupingSurface
        unassigned={[asset]}
        plans={[]}
        folders={folders}
        onCreatePlan={onCreatePlan}
        onCreatePlansFromAssets={create}
        onAssignMany={vi.fn()}
      />,
    );
    expect(
      screen.queryByText('Set folder permissions before creating plans here.'),
    ).toBeNull();
    expect(screen.queryByText('Top level')).toBeNull();
    fireEvent.dragStart(screen.getByText('Credential'));
    fireEvent.drop(screen.getByRole('tree', { name: 'Organisation folders' }));
    expect(create).toHaveBeenCalledWith([asset], expect.objectContaining({ folderId: null, scope: 'SHARED' }));
    fireEvent.click(screen.getByText('Finance'));
    fireEvent.click(screen.getByRole('button', { name: 'Use organisation root' }));
    expect(screen.getByRole('button', { name: 'Use organisation root' }).textContent).toContain('Your organisation');
    fireEvent.click(screen.getByText('Finance'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Credential' }));
    expect(screen.queryByRole('button', { name: 'New plan from selected' })).toBeNull();
  });

  it('drops the full assigned and mixed selection without losing assigned assets', () => {
    const assigned = { ...asset, id: 'b', name: 'Assigned credential' };
    const plan = {
      id: 'existing',
      name: 'Existing',
      assets: 1,
      capacity: '1 / 10 Assets',
      valid: true,
      assignedAssets: [assigned],
    };
    const create = vi.fn(() => ['new-plan']);
    render(
      <PlanGroupingSurface
        unassigned={[asset]}
        plans={[plan]}
        folders={folders}
        onCreatePlansFromAssets={create}
        onAssignMany={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Assigned · 1/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Assigned credential' }));
    fireEvent.dragStart(screen.getByText('Assigned credential'));
    fireEvent.drop(screen.getByText('Finance'));
    expect(create).toHaveBeenLastCalledWith(
      [assigned],
      expect.objectContaining({ folderId: 'finance' }),
    );
    fireEvent.click(screen.getByRole('button', { name: /All · 2/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Credential' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Assigned credential' }));
    fireEvent.dragStart(screen.getByText('Credential'));
    fireEvent.drop(screen.getByText('Finance'));
    expect(create).toHaveBeenLastCalledWith(
      [asset, assigned],
      expect.objectContaining({ folderId: 'finance' }),
    );
  });

  it('blocks a policyless folder through bulk create and plan move, and permits last draft delete', () => {
    const blocked = { ...folders, folders: [{ ...folders.folders[0]!, effectivePolicy: null }] };
    const plan = {
      id: 'existing',
      name: 'Existing',
      assets: 0,
      capacity: '0 / 10 Assets',
      valid: true,
      folderId: null,
      assignedAssets: [],
    };
    const create = vi.fn();
    const update = vi.fn();
    render(
      <PlanGroupingSurface
        unassigned={[asset]}
        plans={[plan]}
        folders={blocked}
        onCreatePlansFromAssets={create}
        onAssignMany={vi.fn()}
        onUpdatePlan={update}
        onDeletePlan={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Finance'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Credential' }));
    expect(screen.queryByRole('button', { name: 'New plan from selected' })).toBeNull();
    const dataTransfer = { setData: vi.fn(), getData: vi.fn(() => 'existing') };
    fireEvent.dragStart(screen.getByText('Existing'), { dataTransfer });
    fireEvent.drop(screen.getAllByText('Finance').at(-1)!, { dataTransfer });
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Existing' }));
    expect(screen.getByRole('dialog', { name: 'Existing' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete plan' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Existing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open plan' }));
    expect(screen.getByRole('dialog', { name: 'Existing' })).toBeTruthy();
  });
});
