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
  render(<FolderSelectionToolbar folders={[folder]} workspace={workspace(remove)} deleteBlocker="Move 2 local draft plans out before deleting." onClear={vi.fn()} />);
  const button = screen.getByText('Delete selected');
  fireEvent.focus(button.closest('.importer-tooltip-anchor')!);
  expect(screen.getByRole('tooltip').textContent).toBe('Move 2 local draft plans out before deleting.');
  fireEvent.click(button);
  expect(screen.queryByText('Delete folders?')).toBeNull();
  expect(remove).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('tooltip')).toBeNull();
});

it('keeps enabled delete directly actionable', () => {
  render(<FolderSelectionToolbar folders={[folder]} workspace={workspace(vi.fn())} onClear={vi.fn()} />);
  const button = screen.getByRole('button', { name: 'Delete selected' });
  fireEvent.mouseEnter(button.closest('.importer-tooltip-anchor')!);
  expect(screen.getByRole('tooltip').textContent).toBe('Review and confirm deleting the selected folders from the organisation.');
  fireEvent.click(button);
  expect(screen.getByText('Delete folders?')).toBeTruthy();
  expect(screen.queryByRole('tooltip')).toBeNull();
});
