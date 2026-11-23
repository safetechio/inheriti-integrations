// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { OrganizationFolderTree } from '@modules/importer-preview/PlanGroupingSurface/components/OrganizationFolderTree';
import { InlineFolderEditor } from '@modules/importer-preview/PlanGroupingSurface/components/OrganizationFolderTree/components/InlineFolderEditor';
import { FolderActionsMenu } from '@modules/importer-preview/PlanGroupingSurface/components/OrganizationFolderTree/components/FolderActionsMenu';
import { FolderSelectionToolbar } from '@modules/importer-preview/PlanGroupingSurface/components/OrganizationFolderTree/components/FolderSelectionToolbar';
import type { FolderWorkspaceProps } from '@modules/importer-preview/PlanGroupingSurface/types';

afterEach(cleanup);
const folder = { id: 'folder', name: 'Accounts', parentId: null, scope: 'SHARED' as const, revision: 1 };
const workspace = (): FolderWorkspaceProps => ({ folders: [folder], scope: 'SHARED', teams: [{ id: 'team', name: 'Team A' }] });

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe('folder management', () => {
  it('creates with Enter from a name-only editor', () => {
    const save = vi.fn();
    render(<InlineFolderEditor initialName="Accounts" onDraftChange={vi.fn()} pending={false} error="" onSave={save} onCancel={vi.fn()} />);
    expect(screen.queryByText('Folder teams')).toBeNull();
    expect(screen.queryByText('Save')).toBeNull();
    fireEvent.keyDown(screen.getByLabelText('New folder name'), { key: 'Enter' });
    expect(save).toHaveBeenCalledExactlyOnceWith('Accounts');
  });

  it('shows access impact automatically and preserves edits on save failure', async () => {
    const props = workspace();
    props.onPreviewFolderChange = vi.fn().mockResolvedValue({ affectedPlanIds: ['plan'], addedTeamIds: [], removedTeamIds: [], addedDeniedTeamIds: [], removedDeniedTeamIds: [], blockers: [] });
    props.onChangeFolderPolicy = vi.fn().mockRejectedValue(new Error('Revision changed'));
    render(<FolderActionsMenu folder={folder} workspace={props} canCreatePlan={false} onNewSubfolder={vi.fn()} onRename={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Actions for Accounts'));
    fireEvent.click(screen.getByText('Permissions'));
    expect(screen.queryByText('Inherit permissions')).toBeNull();
    fireEvent.focus(screen.getByRole('textbox', { name: 'Search teams' }));
    const team = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Team A' });
    fireEvent.click(team);
    expect(team.checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Team A' }));
    expect(team.checked).toBe(false);
    fireEvent.click(team);
    await screen.findByText('Plans affected: 1');
    expect(props.onChangeFolderPolicy).not.toHaveBeenCalled();
    expect(screen.queryByText('Deny')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save permissions', exact: true }).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Save permissions', exact: true }));
    await screen.findByText('Revision changed');
    expect(screen.getByRole('button', { name: 'Remove Team A' })).toBeTruthy();
    expect(props.onChangeFolderPolicy).toHaveBeenCalledWith(folder, { teams: { allow: ['team'], deny: [] } });
  });

  it('offers inheritance only for a child and keeps existing denied teams when saving an own policy', async () => {
    const child = { ...folder, id: 'child', parentId: folder.id, policy: { teams: { allow: ['existing-team'], deny: ['legacy'] } } };
    const props = workspace();
    props.folders = [folder, child];
    props.onPreviewFolderChange = vi.fn().mockResolvedValue({ affectedPlanIds: [], addedTeamIds: [], removedTeamIds: [], addedDeniedTeamIds: [], removedDeniedTeamIds: [], blockers: [] });
    props.onChangeFolderPolicy = vi.fn().mockResolvedValue(undefined);
    render(<FolderActionsMenu folder={child} workspace={props} canCreatePlan={false} onNewSubfolder={vi.fn()} onRename={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Actions for Accounts'));
    fireEvent.click(screen.getByText('Permissions'));
    expect(screen.getByText('Inherit permissions')).toBeTruthy();
    expect(screen.getByLabelText('Inherit permissions').className).toContain('choice-group-radio');
    expect(screen.queryByText('Deny')).toBeNull();
    fireEvent.focus(screen.getByRole('textbox', { name: 'Search teams' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Team A' }));
    await waitFor(() => expect(screen.getByText('Save permissions').closest('button')?.disabled).toBe(false));
    fireEvent.click(screen.getByText('Save permissions'));
    await waitFor(() => expect(props.onChangeFolderPolicy).toHaveBeenCalledWith(child, { teams: { allow: ['existing-team', 'team'], deny: ['legacy'] } }));
  });

  it('saves inherited permissions as null for a child', async () => {
    const child = { ...folder, id: 'child', parentId: folder.id };
    const props = workspace();
    props.folders = [folder, child];
    props.onPreviewFolderChange = vi.fn().mockResolvedValue({ affectedPlanIds: [], addedTeamIds: [], removedTeamIds: [], addedDeniedTeamIds: [], removedDeniedTeamIds: [], blockers: [] });
    props.onChangeFolderPolicy = vi.fn().mockResolvedValue(undefined);
    render(<FolderActionsMenu folder={child} workspace={props} canCreatePlan={false} onNewSubfolder={vi.fn()} onRename={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Actions for Accounts'));
    fireEvent.click(screen.getByText('Permissions'));
    fireEvent.click(screen.getByText('Inherit permissions'));
    await waitFor(() => expect(screen.getByText('Save permissions').closest('button')?.disabled).toBe(false));
    fireEvent.click(screen.getByText('Save permissions'));
    await waitFor(() => expect(props.onChangeFolderPolicy).toHaveBeenCalledWith(child, null));
  });

  it('blocks local draft deletion and confirms bulk deletion', async () => {
    const props = workspace();
    props.onDeleteFolders = vi.fn().mockResolvedValue(undefined);
    const clear = vi.fn();
    const view = render(<FolderSelectionToolbar folders={[folder]} workspace={props} localDraftCount={1} onClear={clear} />);
    expect(screen.getByText('Delete selected').closest('button')?.disabled).toBe(true);
    view.rerender(<FolderSelectionToolbar folders={[folder]} workspace={props} localDraftCount={0} onClear={clear} />);
    fireEvent.click(screen.getByText('Delete selected'));
    expect(props.onDeleteFolders).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Delete folders'));
    await waitFor(() => expect(props.onDeleteFolders).toHaveBeenCalledWith([folder]));
    expect(clear).toHaveBeenCalledOnce();
  });

  it.each(['create', 'rename'] as const)('keeps the inline %s name and blocks competing edits while saving', async (operation) => {
    const request = deferred();
    const save = vi.fn().mockReturnValue(request.promise);
    const props = { ...workspace(), onCreateFolder: operation === 'create' ? save : vi.fn(), onRenameFolder: operation === 'rename' ? save : vi.fn() };
    const create = operation === 'create';
    render(<OrganizationFolderTree workspace={props} plans={[]} dragAssets={[]} />);
    const newFolder = screen.getByRole('button', { name: 'New folder' });
    if (create) fireEvent.click(newFolder);
    else {
      fireEvent.click(screen.getByRole('button', { name: 'Actions for Accounts' }));
      fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    }
    const name = screen.getByRole<HTMLInputElement>('textbox', { name: create ? 'New folder name' : 'Rename Accounts' });
    fireEvent.change(name, { target: { value: 'Personal accounts' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(name.disabled).toBe(true);
    expect(newFolder.getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(name, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Accounts' }));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: create ? 'Rename' : 'New subfolder' }).disabled).toBe(true);
    expect(await screen.findByText(create ? 'Creating…' : 'Saving…')).toBeTruthy();
    expect(name.value).toBe('Personal accounts');
    expect(save).toHaveBeenCalledOnce();
    await act(() => request.resolve());
    expect(name.isConnected).toBe(false);
  });

  it('keeps typing local and retains the draft through refresh and save errors', async () => {
    const readFolders = vi.fn(() => [folder]);
    const props = {
      ...workspace(),
      get folders() { return readFolders(); },
      hasLoaded: true,
      onCreateFolder: vi.fn().mockRejectedValue(new Error('Try again')),
      onRenameFolder: vi.fn().mockResolvedValue(undefined),
    };
    const view = render(<OrganizationFolderTree workspace={props} plans={[]} dragAssets={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'New folder name' });
    readFolders.mockClear();

    fireEvent.change(input, { target: { value: 'Account' } });
    fireEvent.change(input, { target: { value: 'Accounts backup' } });
    expect(readFolders).not.toHaveBeenCalled();
    expect(props.onCreateFolder).not.toHaveBeenCalled();

    view.rerender(<OrganizationFolderTree workspace={{ ...props, error: 'Refresh failed' }} plans={[]} dragAssets={[]} />);
    expect(screen.getByRole('textbox', { name: 'New folder name' })).toBe(input);
    expect(input.value).toBe('Accounts backup');
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText('Try again');
    expect(input.value).toBe('Accounts backup');
    expect(input.disabled).toBe(false);
    expect(props.onCreateFolder).toHaveBeenCalledExactlyOnceWith({ name: 'Accounts backup', parentId: null, scope: 'SHARED', policy: null });

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Accounts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const rename = screen.getByRole<HTMLInputElement>('textbox', { name: 'Rename Accounts' });
    expect(rename.value).toBe('Accounts');
    fireEvent.change(rename, { target: { value: 'Work accounts' } });
    await act(async () => fireEvent.blur(rename));
    expect(props.onRenameFolder).toHaveBeenCalledExactlyOnceWith(folder, 'Work accounts');

    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'New folder name' }).value).toBe('');
  });

  it('restores a subfolder draft after collapsing and expanding its parent', async () => {
    const props = { ...workspace(), onCreateFolder: vi.fn().mockResolvedValue(undefined) };
    render(<OrganizationFolderTree workspace={props} plans={[]} dragAssets={[]} />);
    const row = screen.getByRole('treeitem', { name: /Accounts/ });
    fireEvent.click(within(row).getByRole('button', { name: 'Actions for Accounts' }));
    fireEvent.click(screen.getByRole('button', { name: 'New subfolder' }));
    const name = { name: 'New folder name' };
    fireEvent.change(screen.getByRole('textbox', name), { target: { value: 'Archive' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Actions for Accounts' }));
    fireEvent.click(screen.getByRole('button', { name: 'New subfolder' }));

    fireEvent.click(within(row).getByRole('button', { name: 'Collapse' }));
    expect(screen.queryByRole('textbox', name)).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: 'Expand' }));
    const input = screen.getByRole<HTMLInputElement>('textbox', name);
    expect(input.value).toBe('Archive');

    await act(async () => fireEvent.keyDown(input, { key: 'Enter' }));
    expect(props.onCreateFolder).toHaveBeenCalledExactlyOnceWith({ name: 'Archive', parentId: folder.id, scope: 'SHARED', policy: null });
  });

  it('shows initial loading and keeps rows visible throughout a background refresh', async () => {
    const props = workspace();
    const view = render(<OrganizationFolderTree workspace={{ ...props, loading: true }} plans={[]} dragAssets={[]} />);
    expect(screen.getByText('Loading folders…').closest('[role="status"]')).toBeTruthy();
    view.rerender(<OrganizationFolderTree workspace={{ ...props, refreshing: true }} plans={[]} dragAssets={[]} />);
    expect(screen.getByRole('treeitem', { name: /Accounts/ })).toBeTruthy();
    expect(screen.queryByText('Refreshing…')).toBeNull();
    expect((await screen.findByText('Refreshing…')).closest('[role="status"]')).toBeTruthy();
    expect(screen.getByRole('treeitem', { name: /Accounts/ })).toBeTruthy();
    view.rerender(<OrganizationFolderTree workspace={props} plans={[]} dragAssets={[]} />);
    expect(screen.queryByText('Refreshing…')).toBeNull();
  });

  it('preserves a root plan and pending editor when an empty catalog fails to refresh', async () => {
    const request = deferred();
    const error = 'Folders could not be loaded.';
    const props = { ...workspace(), folders: [], onCreateFolder: vi.fn().mockReturnValue(request.promise) };
    const plans = [{ id: 'root-plan', name: 'Root plan', assets: 0, capacity: '10', valid: true }];
    const view = render(<OrganizationFolderTree workspace={{ ...props, hasLoaded: false, error }} plans={plans} dragAssets={[]} />);
    expect(screen.getByRole('alert').textContent).toBe(error);
    expect(screen.queryByText('Root plan')).toBeNull();
    expect(screen.queryByText('No shared folders or plans yet')).toBeNull();

    view.rerender(<OrganizationFolderTree workspace={{ ...props, hasLoaded: true }} plans={plans} dragAssets={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    const name = screen.getByRole<HTMLInputElement>('textbox', { name: 'New folder name' });
    fireEvent.change(name, { target: { value: 'My folder' } });
    fireEvent.keyDown(name, { key: 'Enter' });

    view.rerender(<OrganizationFolderTree workspace={{ ...props, hasLoaded: true, error }} plans={plans} dragAssets={[]} />);
    expect(screen.getByRole('alert').textContent).toBe(error);
    expect(screen.getByText('Root plan')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'New folder name' })).toBe(name);
    expect(name.value).toBe('My folder');
    await act(() => request.resolve());
  });

  it.each(['single', 'bulk'] as const)('blocks dismissing a pending %s delete and allows retry after an error', async (kind) => {
    const request = deferred();
    const remove = vi.fn().mockReturnValueOnce(request.promise).mockResolvedValue(undefined);
    const bulk = kind === 'bulk';
    const props = { ...workspace(), onDeleteFolder: bulk ? undefined : remove, onDeleteFolders: bulk ? remove : undefined };
    const view = render(<OrganizationFolderTree workspace={props} plans={[]} dragAssets={[]} />);
    if (bulk) {
      fireEvent.click(screen.getByRole('treeitem', { name: /Accounts/ }), { ctrlKey: true });
      fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Actions for Accounts' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    }
    const item = bulk ? 'folders' : 'folder';
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: `Delete ${item}` }));
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    expect(cancel.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(cancel);
    fireEvent.click(within(dialog).getByRole('button', { name: `Close Delete ${item}?` }));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(within(dialog).getByRole('button', { name: `Deleting ${item}…` }));
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(remove).toHaveBeenCalledOnce();

    const refreshError = 'Folders could not be loaded.';
    view.rerender(<OrganizationFolderTree workspace={{ ...props, error: refreshError, onRetry: vi.fn() }} plans={[]} dragAssets={[]} />);
    expect(screen.getByText(refreshError)).toBeTruthy();
    expect(screen.getByRole('treeitem', { name: /Accounts/ })).toBeTruthy();
    expect(screen.getByRole('dialog')).toBe(dialog);
    await act(() => request.reject(new Error('Try again')));
    expect(within(dialog).getByRole('alert').textContent).toBe('Try again');
    expect(cancel.getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(within(dialog).getByRole('button', { name: `Delete ${item}` }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
