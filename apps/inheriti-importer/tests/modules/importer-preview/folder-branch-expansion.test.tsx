import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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

it('shows matching folder contents and excludes unrelated rows when selecting search results', () => {
  render(<OrganizationFolderTree dragAssets={[]} plans={[
    plan('root-plan', 'Root plan', 'root'),
    plan('child-plan', 'Network credentials', 'child'),
    plan('deep-plan', 'Deep plan', 'grandchild'),
    plan('other-plan', 'Other plan', 'other'),
    { ...plan('private-plan', 'Private plan', 'child'), sharingModel: 'PRIVATE' },
  ]} workspace={{ folders, scope: 'SHARED' }} />);
  const search = screen.getByRole('textbox', { name: 'Search folders or plans' });
  fireEvent.change(search, { target: { value: 'CHILD' } });
  const root = screen.getByText('Root').closest<HTMLElement>('[role="treeitem"]')!;
  expect(screen.getByText('Network credentials')).toBeTruthy();
  expect(screen.getByText('Deep plan')).toBeTruthy();
  expect(screen.queryByText('Root plan')).toBeNull();
  expect(screen.queryByText('Other')).toBeNull();
  expect(screen.queryByText('Private plan')).toBeNull();

  root.focus();
  fireEvent.keyDown(root, { key: 'a', ctrlKey: true });
  expect(screen.getByText('2 plans selected')).toBeTruthy();

  fireEvent.change(search, { target: { value: 'root' } });
  expect(screen.getByText('Root plan')).toBeTruthy();
  expect(screen.getByText('Network credentials')).toBeTruthy();
  expect(screen.getByText('Deep plan')).toBeTruthy();
  expect(screen.queryByText('Other')).toBeNull();
});

it('shows the full path to a matching nested plan without showing other plans in that path', () => {
  render(<OrganizationFolderTree dragAssets={[]} plans={[
    plan('root-plan', 'Root plan', 'root'),
    plan('deep-plan', 'Network credentials', 'grandchild'),
    plan('deep-other', 'Unrelated plan', 'grandchild'),
    plan('other-plan', 'Other plan', 'other'),
  ]} workspace={{ folders, scope: 'SHARED' }} />);
  const search = screen.getByRole('textbox', { name: 'Search folders or plans' });
  fireEvent.change(search, { target: { value: 'network' } });
  for (const name of ['Root', 'Child', 'Grandchild', 'Network credentials']) {
    expect(screen.getByText(name)).toBeTruthy();
  }
  for (const name of ['Root plan', 'Unrelated plan', 'Other']) {
    expect(screen.queryByText(name)).toBeNull();
  }
  fireEvent.change(search, { target: { value: 'unmatched' } });
  expect(screen.queryAllByRole('treeitem')).toHaveLength(0);
});

it('restores the folder expansion state when clearing a search', () => {
  render(<OrganizationFolderTree dragAssets={[]} plans={[plan('deep-plan', 'Deep plan', 'grandchild')]}
    workspace={{ folders, scope: 'SHARED' }} />);
  const root = screen.getByText('Root').closest('[role="treeitem"]')!;
  fireEvent.click(root.querySelector('[aria-label="Expand"]')!);
  const search = screen.getByRole('textbox', { name: 'Search folders or plans' });
  fireEvent.change(search, { target: { value: 'root' } });
  expect(screen.getByText('Deep plan')).toBeTruthy();
  fireEvent.click(root.querySelector('[aria-label="Collapse"]')!);
  expect(screen.queryByText('Child')).toBeNull();
  fireEvent.change(search, { target: { value: '' } });
  expect(screen.getByText('Child')).toBeTruthy();
  expect(screen.queryByText('Grandchild')).toBeNull();
});

it('keeps a folder search when revealing a plan it includes and clears it for an excluded plan', () => {
  const props = {
    dragAssets: [],
    plans: [plan('deep-plan', 'Deep plan', 'grandchild'), plan('other-plan', 'Other plan', 'other')],
    workspace: { folders, scope: 'SHARED' as const },
  };
  const { rerender } = render(<OrganizationFolderTree {...props} />);
  const search = screen.getByRole<HTMLInputElement>('textbox', { name: 'Search folders or plans' });
  fireEvent.change(search, { target: { value: 'root' } });
  const root = screen.getByText('Root').closest('[role="treeitem"]')!;
  fireEvent.click(root.querySelector('[aria-label="Collapse"]')!);
  expect(screen.queryByText('Deep plan')).toBeNull();

  rerender(<OrganizationFolderTree {...props} revealRequest={{ id: 'deep-plan', rename: false, sequence: 1 }} />);
  expect(search.value).toBe('root');
  expect(document.activeElement).toBe(screen.getByText('Deep plan').closest('[role="treeitem"]'));
  expect(screen.getByText('Deep plan asset')).toBeTruthy();

  rerender(<OrganizationFolderTree {...props} revealRequest={{ id: 'other-plan', rename: false, sequence: 2 }} />);
  expect(search.value).toBe('');
  expect(document.activeElement).toBe(screen.getByText('Other plan').closest('[role="treeitem"]'));
});

it('uses the latest input when a plan reveal arrives during rapid typing', () => {
  const props = {
    dragAssets: [],
    plans: [plan('deep-plan', 'Deep plan', 'grandchild'), plan('other-plan', 'Other plan', 'other')],
    workspace: { folders, scope: 'SHARED' as const },
  };
  const { rerender } = render(<OrganizationFolderTree {...props} />);
  const search = screen.getByRole<HTMLInputElement>('textbox', { name: 'Search folders or plans' });
  act(() => {
    fireEvent.change(search, { target: { value: 'oth' } });
    fireEvent.change(search, { target: { value: 'deep' } });
    expect(search.value).toBe('deep');
    rerender(<OrganizationFolderTree {...props} revealRequest={{ id: 'other-plan', rename: false, sequence: 1 }} />);
  });
  expect(search.value).toBe('');
  expect(document.activeElement).toBe(screen.getByText('Other plan').closest('[role="treeitem"]'));
});

it('updates an active search when folders or plans change and keeps orphaned results visible', () => {
  const orphan = { ...folders[0]!, id: 'orphan', name: 'Recovered folder', parentId: 'missing' };
  const privateFolder = { ...folders[0]!, id: 'private', name: 'Recovered private', scope: 'PERSONAL' as const };
  const drafts = [
    plan('under-orphan', 'Folder contents', 'orphan'),
    plan('without-folder', 'Recovered draft', 'missing'),
    { ...plan('private-draft', 'Recovered private draft', 'private'), sharingModel: 'PRIVATE' as const },
  ];
  const { rerender } = render(<OrganizationFolderTree dragAssets={[]} plans={drafts}
    workspace={{ folders: [...folders, orphan, privateFolder], scope: 'SHARED' }} />);
  const search = screen.getByRole<HTMLInputElement>('textbox', { name: 'Search folders or plans' });
  fireEvent.change(search, { target: { value: 'recovered' } });
  expect(screen.getByText('Folder contents')).toBeTruthy();
  expect(screen.getByText('Recovered draft')).toBeTruthy();
  expect(screen.queryByText('Recovered private draft')).toBeNull();

  const moved = { ...orphan, name: 'Renamed folder', parentId: 'root' };
  rerender(<OrganizationFolderTree dragAssets={[]} plans={[{ ...drafts[0]!, name: 'Recovered contents' }]}
    workspace={{ folders: [...folders, moved, privateFolder], scope: 'SHARED' }} />);
  expect(search.value).toBe('recovered');
  expect(screen.getByText('Root')).toBeTruthy();
  expect(screen.getByText('Renamed folder')).toBeTruthy();
  expect(screen.getByText('Recovered contents')).toBeTruthy();
  expect(screen.queryByText('Recovered draft')).toBeNull();
});
