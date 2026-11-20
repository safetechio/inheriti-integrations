// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { FolderActionsMenu } from '@modules/importer-preview/PlanGroupingSurface/components/OrganizationFolderTree/components/FolderActionsMenu';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps folder actions in the viewport as the anchor scrolls and the window resizes', () => {
  vi.stubGlobal('innerWidth', 420);
  vi.stubGlobal('innerHeight', 400);
  let anchorTop = 350;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('folder-menu')
      ? new DOMRect(405, anchorTop, 40, 28)
      : new DOMRect(0, 0, 190, 240);
  });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(240);

  const folder = { id: 'folder', name: 'Accounts', parentId: null, scope: 'SHARED' as const, revision: 1 };
  render(
    <FolderActionsMenu
      folder={folder}
      workspace={{ folders: [folder], scope: 'SHARED', onDeleteFolder: vi.fn() }}
      canCreatePlan={false}
      onNewSubfolder={vi.fn()}
      onRename={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByLabelText('Actions for Accounts'));
  const menu = screen.getByRole('button', { name: 'Delete' }).closest<HTMLElement>('.folder-menu-popover')!;
  expect(menu.style.top).toBe('106px');
  expect(menu.style.left).toBe('222px');

  anchorTop = 44;
  fireEvent.scroll(screen.getByLabelText('Actions for Accounts').closest('.folder-menu')!);
  expect(menu.style.top).toBe('76px');

  vi.stubGlobal('innerHeight', 120);
  fireEvent(window, new Event('resize'));
  expect(menu.style.top).toBe('76px');
  expect(menu.style.maxHeight).toBe('36px');
  expect(menu.style.overflowY).toBe('auto');
});
