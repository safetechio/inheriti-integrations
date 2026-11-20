// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { moveRoots, validFolderDestination } from '@modules/importer-preview/PlanGroupingSurface/components/OrganizationFolderTree/hooks/folder-drag-move';
import { FolderMoveModal } from '@modules/importer-preview/PlanGroupingSurface/components/OrganizationFolderTree/components/FolderMoveModal';
import type { Folder, FolderWorkspaceProps } from '@modules/importer-preview/PlanGroupingSurface/types';

afterEach(cleanup);
const root: Folder = { id: 'root', name: 'Root', parentId: null, scope: 'SHARED', revision: 1 };
const child: Folder = { ...root, id: 'child', name: 'Child', parentId: 'root' };
const sibling: Folder = { ...root, id: 'sibling', name: 'Sibling' };
const destination: Folder = { ...root, id: 'destination', name: 'Destination' };
const preview = { affectedPlanIds: [], addedTeamIds: [], removedTeamIds: [], addedDeniedTeamIds: [], removedDeniedTeamIds: [], blockers: [], scope: 'SHARED' as const };

it('prunes nested selections and rejects self, descendant, and current parent', () => {
  const folders = [root, child, sibling, destination];
  expect(moveRoots(folders, ['child', 'root', 'sibling'])).toEqual([root, sibling]);
  expect(validFolderDestination(folders, [root], root.id, 'SHARED')).toBe(false);
  expect(validFolderDestination(folders, [root], child.id, 'SHARED')).toBe(false);
  expect(validFolderDestination(folders, [child], root.id, 'SHARED')).toBe(false);
  expect(validFolderDestination(folders, [root], destination.id, 'SHARED')).toBe(true);
  expect(validFolderDestination(folders, [root], null, 'SHARED')).toBe(false);
});

it('previews a preselected destination and moves only top-level selections', async () => {
  const workspace: FolderWorkspaceProps = { folders: [root, child, destination], scope: 'SHARED', onPreviewFolderChange: vi.fn().mockResolvedValue(preview), onMoveFolder: vi.fn().mockResolvedValue(undefined) };
  render(<FolderMoveModal folder={root} folders={[root, child]} workspace={workspace} initialParentId={destination.id} onDismiss={vi.fn()} />);
  await waitFor(() => expect(workspace.onPreviewFolderChange).toHaveBeenCalledWith(root, { parentId: destination.id }));
  fireEvent.click(await screen.findByText('Move folder'));
  await waitFor(() => expect(workspace.onMoveFolder).toHaveBeenCalledTimes(1));
  expect(workspace.onMoveFolder).toHaveBeenCalledWith(root, destination.id);
});

it('does not retry a folder already moved after partial failure', async () => {
  const move = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('failed')).mockResolvedValue(undefined);
  const workspace: FolderWorkspaceProps = { folders: [root, sibling, destination], scope: 'SHARED', onPreviewFolderChange: vi.fn().mockResolvedValue(preview), onMoveFolder: move };
  render(<FolderMoveModal folder={root} folders={[root, sibling]} workspace={workspace} initialParentId={destination.id} onDismiss={vi.fn()} />);
  await waitFor(() => expect((screen.getByText('Move folders').closest('button') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText('Move folders'));
  await screen.findByText(/1 of 2 folders moved/);
  await waitFor(() => expect((screen.getByText('Move folders').closest('button') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(await screen.findByText('Move folders'));
  await waitFor(() => expect(move).toHaveBeenCalledTimes(3));
  expect(move.mock.calls.map((call) => call[0].id)).toEqual(['root', 'sibling', 'sibling']);
});
