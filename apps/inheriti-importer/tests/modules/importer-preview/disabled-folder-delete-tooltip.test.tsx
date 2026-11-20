// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FolderSelectionToolbar } from '@modules/importer-preview/PlanGroupingSurface/components/OrganizationFolderTree/components/FolderSelectionToolbar';
import type { FolderWorkspaceProps } from '@modules/importer-preview/PlanGroupingSurface/types';

afterEach(cleanup);
const folder = { id: 'folder', name: 'Accounts', parentId: null, scope: 'SHARED' as const, revision: 1 };
const workspace = (onDeleteFolders: FolderWorkspaceProps['onDeleteFolders']): FolderWorkspaceProps => ({
  folders: [folder], scope: 'SHARED', teams: [], onDeleteFolders,
});

it('explains a blocked folder delete without opening confirmation', () => {
  const remove = vi.fn();
  render(<FolderSelectionToolbar folders={[folder]} workspace={workspace(remove)} localDraftCount={2} onClear={vi.fn()} />);
  const button = screen.getByText('Delete selected');
  fireEvent.mouseEnter(button.closest('.importer-tooltip-anchor')!);
  expect(screen.getByRole('tooltip').textContent).toBe('Move the 2 plans out of the selected folders before deleting them.');
  fireEvent.click(button);
  expect(screen.queryByText('Delete folders?')).toBeNull();
  expect(remove).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).toBeNull();
});

it('keeps enabled delete directly actionable', () => {
  render(<FolderSelectionToolbar folders={[folder]} workspace={workspace(vi.fn())} localDraftCount={0} onClear={vi.fn()} />);
  fireEvent.click(screen.getByText('Delete selected'));
  expect(screen.getByText('Delete folders?')).toBeTruthy();
  expect(screen.queryByRole('tooltip')).toBeNull();
});
