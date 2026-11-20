// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FolderMoveModal } from '@modules/importer-preview/PlanGroupingSurface/components/OrganizationFolderTree/components/FolderMoveModal';
import type { FolderWorkspaceProps } from '@modules/importer-preview/PlanGroupingSurface/types';

afterEach(cleanup);
const folder = { id: 'folder', name: 'Accounts', parentId: null, scope: 'SHARED' as const, revision: 1 };
const destination = { ...folder, id: 'destination', name: 'Finance' };
const preview = { affectedPlanIds: ['plan'], addedTeamIds: [], removedTeamIds: [], addedDeniedTeamIds: [], removedDeniedTeamIds: [], blockers: [] };

it('previews a changed destination before moving', async () => {
  const workspace: FolderWorkspaceProps = {
    folders: [folder, destination], scope: 'SHARED',
    onPreviewFolderChange: vi.fn().mockResolvedValue(preview), onMoveFolder: vi.fn().mockResolvedValue(undefined),
  };
  const dismiss = vi.fn();
  render(<FolderMoveModal folder={folder} workspace={workspace} onDismiss={dismiss} />);
  expect((screen.getByText('Move folder').closest('button') as HTMLButtonElement).disabled).toBe(true);
  const select = screen.getByRole('combobox', { name: 'Destination' });
  fireEvent.click(select);
  fireEvent.change(select, { target: { value: 'finance' } });
  expect(workspace.onPreviewFolderChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('option', { name: 'Organisation root / Finance' }));
  await screen.findByText('1 plan affected');
  expect(workspace.onMoveFolder).not.toHaveBeenCalled();
  const moveButton = screen.getByRole('button', { name: 'Move folder' }) as HTMLButtonElement;
  await waitFor(() => expect(moveButton.disabled).toBe(false));
  fireEvent.click(moveButton);
  await waitFor(() => expect(workspace.onMoveFolder).toHaveBeenCalledWith(folder, destination.id));
  expect(dismiss).toHaveBeenCalledOnce();
});

it('disables destination changes while a preview is pending', async () => {
  let resolve!: (value: typeof preview) => void;
  const workspace: FolderWorkspaceProps = {
    folders: [folder, destination], scope: 'SHARED',
    onPreviewFolderChange: vi.fn().mockReturnValue(new Promise((done) => { resolve = done; })), onMoveFolder: vi.fn(),
  };
  render(<FolderMoveModal folder={folder} workspace={workspace} onDismiss={vi.fn()} />);
  fireEvent.click(screen.getByRole('combobox', { name: 'Destination' }));
  fireEvent.click(screen.getByRole('option', { name: 'Organisation root / Finance' }));
  expect((screen.getByText('Move folder').closest('button') as HTMLButtonElement).disabled).toBe(true);
  resolve(preview);
  await screen.findByText('1 plan affected');
});


it('displays the existing parent as the selected destination without enabling a no-op', () => {
  const nested = { ...folder, parentId: destination.id };
  render(<FolderMoveModal folder={nested} workspace={{ folders: [nested, destination], scope: 'SHARED', onPreviewFolderChange: vi.fn(), onMoveFolder: vi.fn() }} onDismiss={vi.fn()} />);
  const select = screen.getByRole('combobox', { name: 'Destination' }) as HTMLInputElement;
  expect(select.value).toBe('Organisation root / Finance');
  expect((screen.getByRole('button', { name: 'Move folder' }) as HTMLButtonElement).disabled).toBe(true);
});
