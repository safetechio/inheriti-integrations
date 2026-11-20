import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PlanGroupingSurface } from '@modules/importer-preview/PlanGroupingSurface';
import type { Folder, FolderWorkspaceProps, GroupingAsset } from '@modules/importer-preview/PlanGroupingSurface';

afterEach(cleanup);

const asset: GroupingAsset = { id: 'a', name: 'Credential', type: 'USER-PSWD', source: 'vault.json', valid: true };
const finance: Folder = {
  id: 'finance', name: 'Finance', parentId: null, scope: 'SHARED', revision: 1,
  effectivePolicy: { teams: { allow: ['team-1'], deny: [] } },
};
const workspace: FolderWorkspaceProps = {
  scope: 'SHARED',
  folders: [
    finance,
    { ...finance, id: 'payments', name: 'Payments', parentId: finance.id },
    { ...finance, id: 'draft', name: 'Needs permissions', effectivePolicy: null },
    { ...finance, id: 'personal', name: 'Personal', scope: 'PERSONAL' },
  ],
};

function setup() {
  const create = vi.fn();
  const props = {
    unassigned: [asset], plans: [], folders: workspace, onAssignMany: vi.fn(), onCreatePlansFromAssets: create,
  };
  const view = render(<PlanGroupingSurface {...props} />);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Credential' }));
  return { create, view, props };
}

const picker = (path: string) => screen.getByRole('button', { name: `Create in: ${path}` });
const choose = (path: string) => fireEvent.click(screen.getByRole('option', { name: path }));

describe('selected assets creation destination', () => {
  it('syncs folder clicks and searchable choices without changing the selection', () => {
    const { create } = setup();
    fireEvent.click(screen.getByText('Finance'));
    expect(picker('Finance')).toBeTruthy();
    fireEvent.click(picker('Finance'));
    const search = screen.getByRole('combobox', { name: 'Choose a folder' });
    expect(document.activeElement).toBe(search);
    expect(screen.queryByRole('option', { name: 'Personal' })).toBeNull();
    fireEvent.change(search, { target: { value: 'payments' } });
    expect(screen.queryByRole('option', { name: 'Your organisation' })).toBeNull();
    choose('Finance / Payments');
    expect(document.activeElement).toBe(picker('Finance / Payments'));
    expect(screen.getByRole('button', { name: 'Use organisation root' }).textContent).toContain('Finance / Payments');
    expect(screen.getByLabelText('New plan destination').closest('[role="treeitem"]')?.textContent).toContain('Payments');
    expect(screen.getByText('1 selected')).toBeTruthy();
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'New plan', exact: true }));
    expect(create).toHaveBeenLastCalledWith([asset], expect.objectContaining({ folderId: 'payments', scope: 'SHARED' }));

    fireEvent.click(picker('Finance / Payments'));
    choose('Your organisation');
    fireEvent.click(screen.getByRole('button', { name: 'New plan', exact: true }));
    expect(create).toHaveBeenLastCalledWith([asset], expect.objectContaining({ folderId: null, scope: 'SHARED' }));
  });

  it('closes with one Escape or an outside click and returns focus', () => {
    setup();
    const trigger = picker('Your organisation');
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Choose a folder' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Choose a folder' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByText('1 selected')).toBeTruthy();

    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Choose a folder' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it.each([false, true])('closes on Tab without preventing focus traversal (shift = %s)', (shiftKey) => {
    const { create } = setup();
    fireEvent.click(screen.getByText('Finance'));
    const trigger = picker('Finance');
    fireEvent.click(trigger);
    const search = screen.getByRole('combobox', { name: 'Choose a folder' });
    act(() => search.focus());
    expect(document.activeElement).toBe(search);
    expect(fireEvent.keyDown(search, { key: 'Tab', shiftKey })).toBe(true);
    expect(screen.queryByRole('dialog', { name: 'Choose a folder' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByText('1 selected')).toBeTruthy();
    expect(picker('Finance')).toBe(trigger);
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps the picker available when the destination lacks permissions and resets removed targets', () => {
    const { create, view, props } = setup();
    fireEvent.click(picker('Your organisation'));
    choose('Needs permissions');
    const createButton = screen.getByRole('button', { name: 'New plan', exact: true });
    expect(createButton.getAttribute('aria-disabled')).toBe('true');
    fireEvent.focus(createButton.parentElement!);
    expect(screen.getByRole('tooltip').textContent).toBe('Set folder permissions before creating plans here.');
    fireEvent.click(createButton);
    expect(create).not.toHaveBeenCalled();

    fireEvent.click(picker('Needs permissions'));
    choose('Finance');
    expect(screen.getByRole('button', { name: 'New plan', exact: true }).getAttribute('aria-disabled')).not.toBe('true');
    view.rerender(<PlanGroupingSurface {...props} folders={{ ...workspace, folders: [] }} />);
    expect(picker('Your organisation')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use organisation root' }).textContent).toContain('Your organisation');
  });
});
