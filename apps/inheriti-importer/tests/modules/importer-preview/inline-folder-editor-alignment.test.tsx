// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OrganizationFolderTree } from '@modules/importer-preview/PlanGroupingSurface/components/OrganizationFolderTree';

afterEach(cleanup);

it('places a new subfolder first inside its parent at the child depth', () => {
  const { container } = render(<OrganizationFolderTree
    workspace={{
      scope: 'SHARED',
      folders: [
        { id: 'parent', name: 'Parent', parentId: null, scope: 'SHARED', revision: 1 },
        { id: 'child', name: 'Existing child', parentId: 'parent', scope: 'SHARED', revision: 1 },
      ],
          onCreateFolder: vi.fn(),
    }}
    plans={[]}
    dragAssets={[]}
  />);
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Parent' }));
  fireEvent.click(screen.getByRole('button', { name: 'New subfolder' }));

  const editor = container.querySelector('.folder-inline-editor') as HTMLElement;
  const parent = screen.getByText('Parent').closest('.folder-tree-row') as HTMLElement;
  const child = screen.getByText('Existing child').closest('.folder-tree-row') as HTMLElement;
  expect(editor.style.paddingLeft).toBe('44px');
  expect(parent.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(editor.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole('textbox', { name: 'New folder name' }).getAttribute('placeholder')).toBe('Type a name and press Enter');
});
