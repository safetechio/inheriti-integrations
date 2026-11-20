import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PlanGroupingSurface } from '@modules/importer-preview/PlanGroupingSurface';
import type {
  FolderWorkspaceProps,
  GroupingAsset,
  PlanDraft,
} from '@modules/importer-preview/PlanGroupingSurface';

const credential: GroupingAsset = { id: 'a', name: 'Credential', type: 'USER-PSWD', valid: true };
const note: GroupingAsset = { id: 'b', name: 'Note', type: 'PLAIN-TEXT', valid: true };
const leftAsset: GroupingAsset = { id: 'left', name: 'Left asset', type: 'USER-PSWD', valid: true };
const folders: FolderWorkspaceProps = {
  scope: 'SHARED',
  folders: [
    {
      id: 'folder',
      name: 'Finance',
      parentId: null,
      scope: 'SHARED',
      revision: 1,
      effectivePolicy: { teams: { allow: ['team-1'], deny: [] } },
    },
  ],
};
const plan = (
  id: string,
  name: string,
  assignedAssets: GroupingAsset[] = [],
  assets = assignedAssets.length,
): PlanDraft => ({
  id,
  name,
  assets,
  capacity: `${assets} / 10 Assets`,
  valid: true,
  folderId: 'folder',
  sharingModel: 'SHARED',
  assignedAssets,
});
function renderSurface(overrides: Partial<React.ComponentProps<typeof PlanGroupingSurface>> = {}) {
  return render(
    <PlanGroupingSurface
      unassigned={[leftAsset]}
      plans={[
        plan('source', 'Source', [credential, note]),
        plan('target', 'Target'),
        plan('full', 'Full', [], 10),
      ]}
      folders={folders}
      onAssignMany={vi.fn()}
      onUnassignMany={vi.fn()}
      {...overrides}
    />,
  );
}
function openSource() {
  fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
  fireEvent.click(screen.getByRole('button', { name: 'Expand Source' }));
}
afterEach(cleanup);

describe('assigned asset interactions', () => {
  it('chooses a nested destination and creates a draft from the entire right selection', () => {
    const create = vi.fn(() => ['created']);
    const finance = folders.folders[0]!;
    renderSurface({
      onCreatePlansFromAssets: create,
      folders: {
        ...folders,
        folders: [
          finance,
          { ...finance, id: 'payments', name: 'Payments', parentId: finance.id },
          { ...finance, id: 'personal', name: 'Personal', scope: 'PERSONAL' },
        ],
      },
    });
    openSource();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Credential' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create in: Your organisation' }));
    expect(screen.queryByRole('option', { name: 'Personal' })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Choose a folder' }), { target: { value: 'payments' } });
    fireEvent.click(screen.getByRole('option', { name: 'Finance / Payments' }));
    expect(screen.getByRole('button', { name: 'Create in: Finance / Payments' })).toBeTruthy();
    expect(screen.getByText('2 selected')).toBeTruthy();
    expect(create).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'New plan', exact: true }));
    expect(create).toHaveBeenCalledExactlyOnceWith([credential, note], {
      name: '2 imported assets', folderId: 'payments', scope: 'SHARED',
    });
    expect(screen.queryByText('2 selected')).toBeNull();
  });

  it('keeps destination selection usable when folder permissions block creation', () => {
    const create = vi.fn(() => ['created']);
    renderSurface({
      onCreatePlansFromAssets: create,
      folders: {
        ...folders,
        folders: [...folders.folders, { ...folders.folders[0]!, id: 'blocked', name: 'Needs permissions', parentId: 'folder', effectivePolicy: null }],
      },
    });
    openSource();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Credential' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create in: Your organisation' }));
    fireEvent.click(screen.getByRole('option', { name: 'Finance / Needs permissions' }));
    const createButton = screen.getByRole('button', { name: 'New plan', exact: true });
    expect(createButton.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(createButton);
    expect(create).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Create in: Finance / Needs permissions' }));
    fireEvent.click(screen.getByRole('option', { name: 'Your organisation' }));
    expect(screen.getByText('1 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New plan', exact: true }));
    expect(create).toHaveBeenCalledExactlyOnceWith([credential], {
      name: 'Credential', folderId: null, scope: 'SHARED',
    });
  });

  it('offers search-hidden plans in the right toolbar and moves the whole selection', () => {
    const onAssignMany = vi.fn();
    renderSurface({
      onAssignMany,
      plans: [
        plan('source', 'Source', [credential, note]),
        plan('target', 'Target'),
        plan('full', 'Full', [], 10),
        { ...plan('private', 'Private'), sharingModel: 'PRIVATE' },
      ],
    });
    openSource();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search folders or plans' }), { target: { value: 'Source' } });
    expect(screen.queryByText('Target')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Credential' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move to plan' }));
    expect(screen.queryByRole('button', { name: /Private.*available/ })).toBeNull();
    const full = screen.getByRole<HTMLButtonElement>('button', { name: /Full.*available/ });
    expect(full.disabled).toBe(true);
    fireEvent.click(full);
    expect(onAssignMany).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Target.*available/ }));
    expect(onAssignMany).toHaveBeenCalledExactlyOnceWith([credential, note], expect.objectContaining({ id: 'target' }));
    expect(screen.queryByText('2 selected')).toBeNull();
  });

  it('moves the whole right-side selection in one callback and unassigns it from the asset menu', () => {
    const onAssignMany = vi.fn();
    const onUnassignMany = vi.fn();
    renderSurface({ onAssignMany, onUnassignMany });
    openSource();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Credential' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Credential' }));
    fireEvent.click(within(screen.getByRole('button', { name: 'Unassign', exact: true }).parentElement!).getByRole('button', { name: 'Move to plan' }));
    fireEvent.click(screen.getByRole('button', { name: /Target.*available/ }));
    expect(onAssignMany).toHaveBeenCalledWith(
      [credential, note],
      expect.objectContaining({ id: 'target' }),
    );
    expect(screen.queryByText('2 selected')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Credential' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Credential' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unassign' }));
    expect(onUnassignMany).toHaveBeenCalledWith([credential, note]);
  });
  it('rejects a full target for the whole selection', () => {
    const onAssignMany = vi.fn();
    renderSurface({
      onAssignMany,
      plans: [plan('source', 'Source', [credential, note]), plan('full', 'Full', [], 10)],
    });
    openSource();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Credential' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Note' }), { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Credential' }));
    fireEvent.click(within(screen.getByRole('button', { name: 'Unassign', exact: true }).parentElement!).getByRole('button', { name: 'Move to plan' }));
    expect(
      (screen.getByRole('button', { name: /Full.*available/ }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(/No destination has enough space|No plan has capacity/)).toBeTruthy();
    expect(onAssignMany).not.toHaveBeenCalled();
  });
  it('does not bubble an assigned-asset drag to the plan or select a new row', () => {
    renderSurface();
    openSource();
    const row = screen.getByText('Credential').closest('[data-assigned-asset-id]')!;
    row.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true }));
    expect(
      (screen.getByRole('checkbox', { name: 'Select Source' }) as HTMLInputElement).checked,
    ).toBe(false);
  });
  it('clears right plan, folder, and asset selections with Escape', () => {
    renderSurface();
    openSource();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Credential' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Source' }), { ctrlKey: true });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(
      (screen.getByRole('checkbox', { name: 'Select Credential' }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (screen.getByRole('checkbox', { name: 'Select Source' }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(screen.queryByText('2 selected')).toBeNull();
  });
  it('keeps left and right asset selections mutually exclusive', () => {
    renderSurface();
    openSource();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Credential' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Left asset' }));
    expect(
      (screen.getByRole('checkbox', { name: 'Select Left asset' }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (screen.getByRole('checkbox', { name: 'Select Credential' }) as HTMLInputElement).checked,
    ).toBe(false);
  });
});


it('confirms deleting an empty plan and supports cancellation', () => {
  const remove = vi.fn();
  renderSurface({ onDeletePlan: remove });
  openSource();
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Target' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete plan' }));
  expect(remove).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: 'Delete plan?' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Target' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete plan' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete plan' }));
  expect(remove).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'target' }));
});

it('confirms deletion of the last plan from its menu', () => {
  const remove = vi.fn();
  renderSurface({ plans: [plan('source', 'Source', [credential])], onDeletePlan: remove });
  openSource();
  fireEvent.click(screen.getByRole('button', { name: 'Actions for Source' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete plan' }));
  const dialog = screen.getByRole('dialog', { name: 'Delete plan?' });
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete plan' }));
  expect(remove).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'source' }));
});


it('confirms deletion of all selected plans with one bulk delete callback', () => {
  const remove = vi.fn();
  renderSurface({ plans: [plan('source', 'Source', [credential, note]), plan('target', 'Target')], onDeletePlans: remove });
  openSource();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Source' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Target' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));
  const dialog = screen.getByRole('dialog', { name: 'Delete plans?' });
  expect(remove).not.toHaveBeenCalled();
  expect(within(dialog).getByText(/2 assets will return to Unassigned/)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete plans?' })).getByRole('button', { name: 'Delete selected' }));
  expect(remove).toHaveBeenCalledExactlyOnceWith([expect.objectContaining({ id: 'source' }), expect.objectContaining({ id: 'target' })]);
});


it('uses the individual delete action when exactly one selected plan is confirmed', () => {
  const single = vi.fn();
  const bulk = vi.fn();
  renderSurface({ onDeletePlan: single, onDeletePlans: bulk });
  openSource();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Source' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete plan?' })).getByRole('button', { name: 'Delete plan' }));
  expect(single).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'source' }));
  expect(bulk).not.toHaveBeenCalled();
});
