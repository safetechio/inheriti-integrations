// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OrganizationFolderTree } from '@modules/importer-preview/PlanGroupingSurface/components/OrganizationFolderTree';
import type { PlanDraft } from '@modules/importer-preview/PlanGroupingSurface/types';

afterEach(cleanup);

const folders = [
  { id: 'parent', name: 'Engineering', parentId: null },
  { id: 'child', name: 'Production', parentId: 'parent' },
  { id: 'empty-child', name: 'In progress', parentId: 'parent' },
  { id: 'empty-root', name: 'Archive', parentId: null },
].map((folder) => ({ ...folder, scope: 'SHARED' as const, revision: 1 }));

const plans: PlanDraft[] = [
  {
    id: 'deep',
    folderId: 'child',
    name: 'Deployment credentials',
    assets: 1,
    capacity: '5',
    valid: true,
  },
  { id: 'root', folderId: null, name: 'Shared root plan', assets: 1, capacity: '5', valid: true },
  {
    id: 'private',
    folderId: 'empty-root',
    name: 'Private draft',
    assets: 1,
    capacity: '5',
    valid: true,
    sharingModel: 'PRIVATE',
  },
];

const workspace = { folders, scope: 'SHARED' as const };
const toggle = () => screen.getByRole('button', { name: 'With plans' });
const search = (value: string) =>
  fireEvent.change(screen.getByRole('textbox', { name: 'Search folders or plans' }), {
    target: { value },
  });

it('filters empty folders while retaining matching plans, their ancestors, and root plans', () => {
  render(<OrganizationFolderTree workspace={workspace} plans={plans} dragAssets={[]} />);
  expect(toggle().getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByText('Archive')).toBeTruthy();

  fireEvent.click(toggle());
  expect(toggle().getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByText('Archive')).toBeNull();
  expect(screen.getByText('Shared root plan')).toBeTruthy();

  search('engineering');
  expect(screen.getByText('Engineering')).toBeTruthy();
  expect(screen.getByText('Production')).toBeTruthy();
  expect(screen.getByText('Deployment credentials')).toBeTruthy();
  expect(screen.queryByText('In progress')).toBeNull();
  expect(screen.queryByText('Shared root plan')).toBeNull();

  search('In progress');
  expect(screen.getByText('No draft plans match this search.')).toBeTruthy();
  expect(screen.queryByText('Engineering')).toBeNull();

  fireEvent.click(toggle());
  expect(screen.getByText('In progress')).toBeTruthy();
  expect(screen.getByText('Engineering')).toBeTruthy();
});

it('reveals a nested plan and keeps the filter enabled after clearing an unrelated search', () => {
  const tree = (revealRequest?: { id: string; rename: boolean; sequence: number }) => (
    <OrganizationFolderTree
      workspace={workspace}
      plans={plans}
      dragAssets={[]}
      revealRequest={revealRequest}
    />
  );
  const view = render(tree());
  fireEvent.click(toggle());
  search('Archive');
  expect(screen.queryByText('Deployment credentials')).toBeNull();

  view.rerender(tree({ id: 'deep', rename: false, sequence: 1 }));
  expect(toggle().getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('Deployment credentials')).toBeTruthy();
  expect(screen.queryByText('Archive')).toBeNull();
});

it('retains the selected destination and opens the folder editor when filtering', () => {
  const onCreateFolder = vi.fn(async () => {});
  const onTargetFolderChange = vi.fn();
  render(
    <OrganizationFolderTree
      workspace={{ ...workspace, onCreateFolder }}
      plans={plans}
      dragAssets={[]}
      targetFolderId="empty-root"
      onTargetFolderChange={onTargetFolderChange}
    />,
  );
  fireEvent.click(toggle());
  expect(screen.getByRole('button', { name: 'Use organisation root' }).textContent).toContain(
    'Archive',
  );
  expect(onTargetFolderChange).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
  expect(toggle().getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByRole('textbox', { name: 'New folder name' })).toBeTruthy();
});

it('opens the subfolder editor inside a collapsed search match with With plans enabled', () => {
  render(
    <OrganizationFolderTree
      workspace={{ ...workspace, onCreateFolder: vi.fn(async () => {}) }}
      plans={plans}
      dragAssets={[]}
    />,
  );
  fireEvent.click(toggle());
  search('engineering');
  const parent = screen.getByRole('treeitem', { name: /Engineering/ });
  fireEvent.click(within(parent).getByRole('button', { name: 'Collapse' }));
  expect(screen.queryByText('Production')).toBeNull();

  fireEvent.click(within(parent).getByRole('button', { name: 'Actions for Engineering' }));
  fireEvent.click(screen.getByRole('button', { name: 'New subfolder' }));
  expect(toggle().getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByRole('textbox', { name: 'New folder name' })).toBeTruthy();
  expect(screen.getByText('Production')).toBeTruthy();
});
