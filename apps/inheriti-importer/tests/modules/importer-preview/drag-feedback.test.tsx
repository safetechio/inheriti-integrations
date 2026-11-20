import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OrganizationFolderTree } from '@modules/importer-preview/PlanGroupingSurface/components/OrganizationFolderTree';
import type { FolderWorkspaceProps, PlanDraft } from '@modules/importer-preview/PlanGroupingSurface';

afterEach(cleanup);

const asset = { id: 'asset', name: 'Asset', type: 'USER-PSWD' };
const transfer = (types: string[] = []) => ({ types, dropEffect: 'copy', getData: (type: string) => type === 'text/plan-id' ? 'plan' : '', setData: vi.fn(), setDragImage: vi.fn() });
const workspace: FolderWorkspaceProps = { scope: 'SHARED', folders: [{ id: 'folder', name: 'Permissions needed', parentId: null, scope: 'SHARED', revision: 1 }] };

it('marks an asset drop on a permission blocked folder invalid', () => {
  const create = vi.fn();
  render(<OrganizationFolderTree workspace={workspace} plans={[]} dragAssets={[asset]} onCreatePlansFromAssets={create} />);
  const row = screen.getAllByText('Permissions needed')[0]!.closest('[role="treeitem"]')!;
  const dataTransfer = transfer();
  fireEvent.dragOver(row, { dataTransfer });
  expect(row.className).toContain('over-invalid');
  expect(dataTransfer.dropEffect).toBe('none');
  fireEvent.drop(row, { dataTransfer });
  expect(create).not.toHaveBeenCalled();
});

it('marks a full plan invalid for asset additions', () => {
  const plan: PlanDraft = { id: 'plan', name: 'Full plan', assets: 1, capacity: '1/1', valid: true, assignedAssets: [asset] };
  const assign = vi.fn();
  render(<OrganizationFolderTree workspace={{ ...workspace, folders: [] }} plans={[plan]} dragAssets={[{ ...asset, id: 'another' }]} onAssignMany={assign} />);
  const row = screen.getByText('Full plan').closest('[role="treeitem"]')!;
  const dataTransfer = transfer();
  fireEvent.dragOver(row, { dataTransfer });
  expect(row.className).toContain('over-invalid');
  expect(dataTransfer.dropEffect).toBe('none');
  fireEvent.drop(row, { dataTransfer });
  expect(assign).not.toHaveBeenCalled();
});
