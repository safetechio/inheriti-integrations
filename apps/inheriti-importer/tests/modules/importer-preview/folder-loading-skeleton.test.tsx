// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FolderMoveModal } from '@modules/importer-preview/PlanGroupingSurface/components/OrganizationFolderTree/components/FolderMoveModal';
import { OrganizationFolderTree } from '@modules/importer-preview/PlanGroupingSurface/components/OrganizationFolderTree';
import type { FolderChangePreview } from '@modules/organization/domain/plan-folder';

afterEach(cleanup);

it('shows an accessible impact skeleton and keeps Move disabled until the preview resolves', async () => {
  const folder = {
    id: 'folder',
    name: 'Accounts',
    parentId: null,
    scope: 'SHARED' as const,
    revision: 1,
  };
  const destination = { ...folder, id: 'destination', name: 'Finance' };
  let resolve!: (preview: FolderChangePreview) => void;
  const promise = new Promise<FolderChangePreview>((done) => {
    resolve = done;
  });
  const moveFolder = vi.fn();
  render(
    <FolderMoveModal
      folder={folder}
      initialParentId={destination.id}
      workspace={{
        folders: [folder, destination],
        scope: 'SHARED',
        onMoveFolder: moveFolder,
        onPreviewFolderChange: () => promise,
      }}
      onDismiss={vi.fn()}
    />,
  );

  const loading = screen.getByRole('status', { name: 'Loading impact', busy: true });
  expect(loading.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
  const move = screen.getByRole<HTMLButtonElement>('button', { name: 'Move folder' });
  expect(move.disabled).toBe(true);
  fireEvent.click(move);
  expect(moveFolder).not.toHaveBeenCalled();

  resolve({
    affectedPlanIds: ['plan'],
    addedTeamIds: [],
    removedTeamIds: [],
    addedDeniedTeamIds: [],
    removedDeniedTeamIds: [],
    blockers: [],
  });
  await screen.findByText('1 plan affected');
  expect(screen.queryByRole('status', { name: 'Loading impact' })).toBeNull();
  expect(move.disabled).toBe(false);
});

it('shows skeleton rows during initial folder loading', () => {
  const folder = {
    id: 'folder',
    name: 'Accounts',
    parentId: null,
    scope: 'SHARED' as const,
    revision: 1,
  };
  const workspace = { folders: [folder], scope: 'SHARED' as const };
  const view = render(
    <OrganizationFolderTree
      workspace={{ ...workspace, loading: true }}
      plans={[]}
      dragAssets={[]}
    />,
  );

  const loading = screen.getByRole('status', { name: 'Loading folders…', busy: true });
  expect(loading.querySelectorAll('[aria-hidden="true"]')).toHaveLength(9);
  expect(screen.queryByRole('treeitem')).toBeNull();

  view.rerender(<OrganizationFolderTree workspace={workspace} plans={[]} dragAssets={[]} />);
  expect(screen.queryByRole('status', { name: 'Loading folders…' })).toBeNull();
  expect(screen.getByRole('treeitem', { name: /Accounts/ })).toBeTruthy();
});
