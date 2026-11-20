import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OrganizationFolderTree } from '@modules/importer-preview/PlanGroupingSurface/components/OrganizationFolderTree';
import type { PlanDraft } from '@modules/importer-preview/PlanGroupingSurface/types';
import { useAssetSelection } from '@modules/importer-preview/PlanGroupingSurface/hooks/use-asset-selection';

afterEach(cleanup);

const folders = [
  { id: 'root', name: 'Root', parentId: null },
  { id: 'child', name: 'Child', parentId: 'root' },
  { id: 'grandchild', name: 'Grandchild', parentId: 'child' },
  { id: 'other', name: 'Other', parentId: null },
].map((folder) => ({ ...folder, scope: 'SHARED' as const, revision: 1 }));
const plan = (id: string, name: string, folderId: string): PlanDraft => ({
  id, name, folderId, assets: 1, capacity: '5', valid: true,
  assignedAssets: [{ id: `${id}-asset`, name: `${name} asset`, type: 'NOTE' }],
});

it('expands and collapses only the selected folder branch, including plan assets', () => {
  render(<OrganizationFolderTree dragAssets={[]} plans={[
    plan('root-plan', 'Root plan', 'root'), plan('deep-plan', 'Deep plan', 'grandchild'), plan('other-plan', 'Other plan', 'other'),
  ]} workspace={{ folders, scope: 'SHARED' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Expand all in Other' }));
  fireEvent.click(screen.getByRole('button', { name: 'Expand all in Root' }));
  expect(screen.getByText('Root plan asset')).toBeTruthy();
  expect(screen.getByText('Deep plan asset')).toBeTruthy();
  expect(screen.getByText('Other plan asset')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Collapse all in Root' }));
  expect(screen.queryByText('Child')).toBeNull();
  expect(screen.queryByText('Root plan asset')).toBeNull();
  expect(screen.getByText('Other plan asset')).toBeTruthy();
  fireEvent.click(screen.getByText('Root').closest('[role="treeitem"]')!.querySelector('[aria-label="Expand"]')!);
  expect(screen.getByText('Child')).toBeTruthy();
  expect(screen.queryByText('Grandchild')).toBeNull();
  expect(screen.queryByText('Root plan asset')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Expand all in Root' }));
  expect(screen.getByText('Deep plan asset')).toBeTruthy();
});

it('keeps a searched branch collapsed until the query changes', () => {
  render(<OrganizationFolderTree dragAssets={[]} plans={[plan('deep-plan', 'Deep plan', 'grandchild')]}
    workspace={{ folders, scope: 'SHARED' }} />);
  const search = screen.getByPlaceholderText('Search folders or plans…');
  fireEvent.change(search, { target: { value: 'Child' } });
  expect(screen.getByText('Child')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Expand all in Root' }));
  fireEvent.click(screen.getByRole('button', { name: 'Collapse all in Root' }));
  expect(screen.queryByText('Child')).toBeNull();
  fireEvent.change(search, { target: { value: 'Grandchild' } });
  expect(screen.getByText('Grandchild')).toBeTruthy();
});

it('clears hidden branch assets while preserving assets selected in another branch', () => {
  const plans = [plan('root-plan', 'Root plan', 'root'), plan('other-plan', 'Other plan', 'other')];
  function Tree() {
    const assetSelection = useAssetSelection([], plans);
    return <OrganizationFolderTree dragAssets={[]} plans={plans} assetSelection={assetSelection}
      workspace={{ folders, scope: 'SHARED' }} />;
  }
  render(<Tree />);
  fireEvent.click(screen.getByRole('button', { name: 'Expand all in Root' }));
  fireEvent.click(screen.getByRole('button', { name: 'Expand all in Other' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Root plan asset' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Other plan asset' }), { ctrlKey: true });
  expect(screen.getByText('2 selected')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Collapse all in Root' }));
  expect(screen.queryByText('2 selected')).toBeNull();
  expect((screen.getByRole('checkbox', { name: 'Select Other plan asset' }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Collapse all in Other' }));
  expect(screen.queryByText(/\d selected/)).toBeNull();
});

it('clears the selected folder when its row closes', () => {
  render(<OrganizationFolderTree dragAssets={[]} plans={[plan('root-plan', 'Root plan', 'root')]}
    workspace={{ folders, scope: 'SHARED' }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Expand all in Root' }));
  const root = screen.getByText('Root').closest('[role="treeitem"]')!;
  fireEvent.click(root, { ctrlKey: true });
  expect(root.getAttribute('aria-selected')).toBe('true');
  fireEvent.click(root.querySelector('[aria-label="Collapse"]')!);
  expect(root.getAttribute('aria-selected')).toBe('false');
});
