import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  PlanGroupingSurface,
  type Folder,
  type GroupingAsset,
  type PlanDraft,
  type PlanGroupingSurfaceProps,
} from '@modules/importer-preview/PlanGroupingSurface';

import { ImporterFlow } from '@modules/importer-preview/ImporterFlow';

afterEach(cleanup);

const asset: GroupingAsset = { id: 'asset', name: 'Credential', type: 'USER-PSWD', valid: true };
const finance: Folder = {
  id: 'finance', name: 'Finance', parentId: null, scope: 'SHARED', revision: 1,
  effectivePolicy: { teams: { allow: ['team-1'], deny: [] } },
};
const operations = { ...finance, id: 'ops', name: 'Operations', parentId: finance.id };
const folders = { scope: 'SHARED', folders: [finance, operations] } as const;
const newPlan: PlanDraft = {
  id: 'created', name: 'Plan 1', assets: 0, capacity: '0 / 10 Assets', valid: true,
  folderId: operations.id, description: 'Preserved description',
};

type Props = Partial<PlanGroupingSurfaceProps>;

function Workspace({ onUpdatePlan, plans: initialPlans, ...props }: Props) {
  const [plans, setPlans] = useState<PlanDraft[]>(initialPlans ?? []);
  const [unassigned, setUnassigned] = useState([asset]);
  return <PlanGroupingSurface
    unassigned={unassigned}
    plans={plans}
    folders={{ ...folders, folders: [...folders.folders] }}
    onCreatePlan={() => { setPlans([newPlan]); return newPlan.id; }}
    onCreatePlansFromAssets={(assets, options) => {
      const first = { ...newPlan, ...options, assets: assets.length, assignedAssets: assets };
      setPlans([first, { ...first, id: 'second', name: 'Second plan' }]);
      setUnassigned([]);
      return [first.id, 'second'];
    }}
    onAssignMany={(assets, target) => {
      setPlans([{ ...target, assets: assets.length, assignedAssets: assets }]);
      setUnassigned([]);
    }}
    onUndo={() => { setPlans([]); setUnassigned([asset]); }}
    onRedo={() => setPlans([newPlan])}
    canUndo
    canRedo
    onUpdatePlan={(plan, metadata) => {
      onUpdatePlan?.(plan, metadata);
      setPlans((current) => current.map((item) => item.id === plan.id ? { ...item, ...metadata } : item));
    }}
    {...props}
  />;
}

function chooseNestedFolder() {
  fireEvent.click(screen.getByText('Finance'));
  fireEvent.click(screen.getByText('Operations'));
}

function selectAsset() {
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Credential' }));
}

describe('plan creation reveal', () => {
  it('creates in the shown nested destination, opens collapsed ancestors and clears blocking search', () => {
    const update = vi.fn();
    render(<Workspace onUpdatePlan={update} />);

    selectAsset();
    expect(screen.getByRole('button', { name: 'Create in: Your organisation', exact: true })).toBeTruthy();
    chooseNestedFolder();
    const destination = screen.getByRole('button', { name: 'Create in: Finance / Operations', exact: true });
    expect(destination.getAttribute('title')).toBe('Finance / Operations');
    fireEvent.click(within(screen.getByText('Finance', { selector: '.folder-tree-name' }).closest('[role="treeitem"]') as HTMLElement)
      .getByRole('button', { name: 'Collapse' }));
    const search = screen.getByRole('textbox', { name: 'Search folders or plans' }) as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'hidden by search' } });
    selectAsset();
    fireEvent.click(screen.getByRole('button', { name: 'New plan', exact: true }));

    const editor = screen.getByRole('textbox', { name: 'Plan name' }) as HTMLInputElement;
    expect(search.value).toBe('');
    expect(document.activeElement).toBe(editor);
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([0, 'Credential'.length]);
    expect(editor.closest('[role="treeitem"]')?.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Second plan', exact: true })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.change(editor, { target: { value: '   ' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toBe('Enter a plan name.');
    fireEvent.change(editor, { target: { value: 'a'.repeat(161) } });
    fireEvent.blur(editor);
    expect(screen.getByRole('alert').textContent).toContain('160 characters');
    expect(update).not.toHaveBeenCalled();
    fireEvent.change(editor, { target: { value: '  Finance plan  ' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    fireEvent.blur(editor);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: newPlan.id, folderId: operations.id }), {
      name: 'Finance plan', description: newPlan.description,
    });
    expect(screen.queryByRole('textbox', { name: 'Plan name' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Finance plan' }).closest('[role="treeitem"]'));
  });

  it('keeps the default name on Escape and leaves undo and redo free of reveal', () => {
    const update = vi.fn();
    render(<Workspace onUpdatePlan={update} />);
    chooseNestedFolder();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Operations' }));
    fireEvent.click(screen.getByRole('button', { name: 'New plan', exact: true }));
    const editor = screen.getByRole('textbox', { name: 'Plan name' });
    fireEvent.change(editor, { target: { value: 'Discarded name' } });
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(update).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Plan 1' }).closest('[role="treeitem"]'));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(screen.getByRole('button', { name: 'Plan 1' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Plan name' })).toBeNull();
  });

  it('commits a trimmed name on blur after creating by drop', () => {
    const update = vi.fn();
    render(<Workspace onUpdatePlan={update} />);
    fireEvent.dragStart(screen.getByText(asset.name));
    fireEvent.drop(screen.getByText('Finance'));
    const editor = screen.getByRole('textbox', { name: 'Plan name' });
    fireEvent.change(editor, { target: { value: '  Finance  ' } });
    const outside = screen.getByRole('button', { name: 'Use organisation root' });
    act(() => outside.focus());
    fireEvent.click(outside);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: newPlan.id }), {
      name: 'Finance', description: newPlan.description,
    });
    expect(document.activeElement).toBe(outside);
  });

  it('focuses and expands an existing plan after assigning without opening the editor or dialog', () => {
    render(<Workspace plans={[newPlan]} />);
    selectAsset();
    fireEvent.click(screen.getByRole('button', { name: 'Assign to plan' }));
    fireEvent.click(screen.getByRole('button', { name: /Plan 1.*spaces available/ }));

    const target = screen.getByRole('button', { name: 'Plan 1' }).closest('[role="treeitem"]');
    expect(target?.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(target);
    expect(within(screen.getByRole('tree', { name: 'Organisation folders' })).getByText(asset.name)).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Plan name' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Plan 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand Plan 1' }));
    const search = screen.getByRole('textbox', { name: 'Search folders or plans' });
    search.focus();
    fireEvent.change(search, { target: { value: 'unrelated' } });
    fireEvent.change(search, { target: { value: '' } });
    expect(document.activeElement).toBe(search);
  });

  it('reveals the same existing plan again when another asset is assigned', () => {
    const second = { ...asset, id: 'second', name: 'Another credential' };
    function Fixture() {
      const [unassigned, setUnassigned] = useState([asset, second]);
      return <Workspace plans={[newPlan]} unassigned={unassigned}
        onAssignMany={(assigned) => setUnassigned(unassigned.filter((item) => !assigned.includes(item)))} />;
    }
    render(<Fixture />);
    function assign(name: string) {
      fireEvent.click(screen.getByRole('checkbox', { name: `Select ${name}` }));
      fireEvent.click(screen.getByRole('button', { name: 'Assign to plan' }));
      fireEvent.click(screen.getByRole('button', { name: /Plan 1.*spaces available/ }));
    }
    assign(asset.name);
    const target = screen.getByRole('button', { name: 'Plan 1' }).closest('[role="treeitem"]');
    expect(document.activeElement).toBe(target);
    assign(second.name);
    expect(document.activeElement).toBe(target);
    expect(screen.queryByRole('textbox', { name: 'Plan name' })).toBeNull();
  });

  it('renames a folder plan in the standalone ImporterFlow', () => {
    render(<ImporterFlow initialStage="plans" files={[]} assets={[]} unassigned={[]} plans={[]}
      checklist={[]} folders={{ ...folders, folders: [...folders.folders] }} />);
    fireEvent.click(screen.getByText('Finance'));
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Operations' }));
    fireEvent.click(screen.getByRole('button', { name: 'New plan', exact: true }));

    const editor = screen.getByRole('textbox', { name: 'Plan name' });
    fireEvent.change(editor, { target: { value: 'Standalone plan' } });
    fireEvent.keyDown(editor, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Standalone plan' }));
    const details = screen.getByRole('dialog', { name: 'Standalone plan' });
    expect(within(details).getByText('Location in your organisation: Operations')).toBeTruthy();
  });

  it('does not reveal a plan when a creation callback returns no ID', () => {
    const create = vi.fn();
    render(<Workspace plans={[{ ...newPlan, folderId: null }]} onCreatePlan={create} />);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Finance' }));
    fireEvent.click(screen.getByRole('button', { name: 'New plan', exact: true }));
    expect(create).toHaveBeenCalledWith({ folderId: finance.id, scope: 'SHARED' });
    expect(screen.queryByRole('textbox', { name: 'Plan name' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Expand Plan 1' })).toBeTruthy();
  });
});
