// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FolderPermissionsModal } from '@modules/importer-preview/PlanGroupingSurface/components/OrganizationFolderTree/components/FolderPermissionsModal';
import type { Folder, FolderWorkspaceProps } from '@modules/importer-preview/PlanGroupingSurface/types';

afterEach(cleanup);

const initial: Folder = {
  id: 'folder', name: 'Accounts', scope: 'SHARED', parentId: null, revision: 1,
  policy: { teams: { allow: ['current'], deny: ['denied'] } },
};

function workspace() {
  return {
    folders: [initial],
    scope: 'SHARED',
    teams: [{ id: 'other', name: 'Other team' }],
    onPreviewFolderChange: vi.fn().mockResolvedValue({
      affectedPlanIds: [], addedTeamIds: [], removedTeamIds: [],
      addedDeniedTeamIds: [], removedDeniedTeamIds: [], blockers: [],
    }),
    onChangeFolderPolicy: vi.fn(),
  } satisfies FolderWorkspaceProps;
}

it('preserves the draft and blocks preview and save when the folder revision changes', async () => {
  const props = workspace();
  const onDismiss = vi.fn();
  const { rerender } = render(<FolderPermissionsModal folder={initial} workspace={props} onDismiss={onDismiss} />);
  fireEvent.focus(screen.getByRole('textbox', { name: 'Search teams' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Other team' }));
  await screen.findByText('Plans affected: 0');

  const refreshed = { ...initial, revision: 2, policy: { teams: { allow: ['new'], deny: ['new-denied'] } } };
  props.onPreviewFolderChange.mockClear();
  rerender(<FolderPermissionsModal folder={refreshed} workspace={{ ...props, folders: [refreshed] }} onDismiss={onDismiss} />);

  expect(screen.getByRole('alert').textContent).toContain('Close and reopen permissions');
  expect(screen.getByRole('button', { name: 'Remove Other team' }).getAttribute('aria-disabled')).toBe('true');
  expect(screen.getByRole('button', { name: 'Remove current' })).toBeTruthy();
  expect(screen.queryByText('Plans affected: 0')).toBeNull();
  const save = screen.getByRole('button', { name: 'Save permissions' });
  expect(save.getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(save);
  expect(props.onPreviewFolderChange).not.toHaveBeenCalled();
  expect(props.onChangeFolderPolicy).not.toHaveBeenCalled();
});

it('submits the opening revision and retains the draft if the API reports a conflict', async () => {
  const props = workspace();
  props.onChangeFolderPolicy.mockRejectedValue(new Error('Revision conflict'));
  const onDismiss = vi.fn();
  render(<FolderPermissionsModal folder={initial} workspace={props} onDismiss={onDismiss} />);
  fireEvent.focus(screen.getByRole('textbox', { name: 'Search teams' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Other team' }));
  const save = screen.getByRole('button', { name: 'Save permissions' });
  await waitFor(() => expect(save.getAttribute('aria-disabled')).not.toBe('true'));

  fireEvent.click(save);
  expect((await screen.findByRole('alert')).textContent).toBe('Revision conflict');
  expect(props.onChangeFolderPolicy).toHaveBeenCalledExactlyOnceWith(initial, {
    teams: { allow: ['current', 'other'], deny: ['denied'] },
  });
  expect(screen.getByRole('button', { name: 'Remove Other team' })).toBeTruthy();
  expect(onDismiss).not.toHaveBeenCalled();
});
