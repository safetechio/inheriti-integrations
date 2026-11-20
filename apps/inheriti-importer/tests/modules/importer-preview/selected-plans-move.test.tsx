// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { OrganizationFolderTree } from '@modules/importer-preview/PlanGroupingSurface/components/OrganizationFolderTree';
import type { FolderWorkspaceProps, PlanDraft } from '@modules/importer-preview/PlanGroupingSurface/types';

afterEach(cleanup);
const folder = (id: string, name: string, policy = true): FolderWorkspaceProps['folders'][number] => ({
  id, name, parentId: null, scope: 'SHARED', revision: 1,
  effectivePolicy: policy ? { teams: { allow: [], deny: [] } } : null,
});
const plans: PlanDraft[] = ['One', 'Two'].map((name, index) => ({
  id: String(index), name, folderId: null, assets: 0, capacity: '5', valid: true,
}));
const workspace: FolderWorkspaceProps = { folders: [folder('finance', 'Finance'), folder('blocked', 'Blocked', false)], scope: 'SHARED' };

function open(move: ReturnType<typeof vi.fn>) {
  render(<OrganizationFolderTree workspace={workspace} plans={plans} dragAssets={[]} onMovePlans={move}/>);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select One' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Two' }));
  fireEvent.click(screen.getByRole('button', { name: 'Move to folder' }));
  return screen.getByRole('dialog');
}

it('requires an explicit different destination and moves both drafts in one callback', () => {
  const move = vi.fn();
  const dialog = open(move);
  const save = within(dialog).getByRole('button', { name: 'Move plans' }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  expect(within(dialog).getByText('All selected plans are already in this location.')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('combobox', { name: 'Destination' }));
  fireEvent.click(within(dialog).getByRole('option', { name: 'Organisation root / Finance' }));
  expect(save.disabled).toBe(false);
  fireEvent.click(save);
  expect(move).toHaveBeenCalledOnce();
  expect(move).toHaveBeenCalledWith(plans, 'finance', 'SHARED');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText('2 plans selected')).toBeNull();
});

it('keeps cancel harmless and explains a folder without the required policy', () => {
  const move = vi.fn();
  const dialog = open(move);
  fireEvent.click(within(dialog).getByRole('combobox', { name: 'Destination' }));
  fireEvent.click(within(dialog).getByRole('option', { name: 'Organisation root / Blocked' }));
  expect((within(dialog).getByRole('button', { name: 'Move plans' }) as HTMLButtonElement).disabled).toBe(true);
  expect(within(dialog).getByText('Choose a folder in this scope that allows plans.')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(move).not.toHaveBeenCalled();
  expect(screen.getByText('2 plans selected')).toBeTruthy();
});
