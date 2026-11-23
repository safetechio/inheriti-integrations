import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PlanGroupingSurface } from '@modules/importer-preview/PlanGroupingSurface';
import type { GroupingAsset, PlanDraft } from '@modules/importer-preview/PlanGroupingSurface';

afterEach(cleanup);

const plan: PlanDraft = {
  id: 'plan-1',
  name: 'Production',
  assets: 2,
  capacity: '2 / 10 Assets',
  valid: true,
};

const validAsset: GroupingAsset = {
  id: 'asset-1',
  name: 'Credential',
  type: 'USER-PSWD',
  valid: true,
};
const invalidAsset: GroupingAsset = {
  id: 'asset-2',
  name: 'Broken credential',
  type: 'USER-PSWD',
  valid: false,
};

describe('PlanGroupingSurface controls', () => {
  it('navigates same-named folders from separate sources and groups once', () => {
    const onAutoGroup = vi.fn();
    const left = {
      ...plan,
      id: 'left',
      name: 'Left',
      sourceName: 'vault.kdbx',
      sourceGroup: { sourceId: 'source-a', path: ['Shared'] },
    };
    const right = {
      ...plan,
      id: 'right',
      name: 'Right',
      sourceName: 'vault.kdbx',
      sourceGroup: { sourceId: 'source-b', path: ['Shared'] },
    };
    render(
      <PlanGroupingSurface
        unassigned={[validAsset]}
        plans={[left, right]}
        onAutoGroup={onAutoGroup}
      />,
    );
    expect(screen.getByRole('button', { name: 'Select Left' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Select Right' })).toBeTruthy();
    expect(screen.getAllByText('vault.kdbx / Shared')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Group unassigned assets (1)' }));
    expect(onAutoGroup).toHaveBeenCalledOnce();
    expect(onAutoGroup).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Select Right' }));
    expect(screen.getByRole('button', { name: 'Select Right' })).toBeTruthy();
  });

  it('limits mounted unassigned rows while Ctrl+A selects all matching assets', () => {
    const assets = Array.from({ length: 150 }, (_, index) => ({
      ...validAsset,
      id: `asset-${index}`,
      name: `Credential ${index}`,
    }));
    render(<PlanGroupingSurface unassigned={assets} plans={[plan]} onAssignMany={vi.fn()} />);
    expect(screen.getAllByRole('checkbox', { name: /Select Credential/ })).toHaveLength(100);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Credential 0' }));
    fireEvent.keyDown(screen.getByRole('checkbox', { name: 'Select Credential 0' }), {
      key: 'a',
      ctrlKey: true,
    });
    expect(screen.getByText('150 selected')).toBeTruthy();
  }, 15000);
  it('toggles plain checkbox clicks and selects rows with modifiers', () => {
    const assets = [
      validAsset,
      { ...validAsset, id: 'second', name: 'Second' },
      { ...validAsset, id: 'third', name: 'Third' },
    ];
    render(<PlanGroupingSurface unassigned={assets} plans={[plan]} onAssignMany={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Credential' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second' }));
    expect(screen.getByText('2 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Credential' }));
    expect(screen.getByText('1 selected')).toBeTruthy();
    fireEvent.click(screen.getByText('Third'), { ctrlKey: true });
    expect(screen.getByText('2 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Third' }), { ctrlKey: true });
    expect(screen.getByText('1 selected')).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Credential' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Third' }), { shiftKey: true });
    expect(screen.getByText('3 selected')).toBeTruthy();
  });

  it('keeps selection scoped to the pane when crossing from unassigned to assigned', () => {
    const assigned = { ...validAsset, id: 'assigned', name: 'Assigned' };
    render(
      <PlanGroupingSurface
        unassigned={[validAsset]}
        plans={[{ ...plan, assignedAssets: [assigned] }]}
        onAssignMany={vi.fn()}
        onUnassignMany={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Credential' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select Production' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Assigned' }), { ctrlKey: true });
    expect(screen.getByText('1 selected')).toBeTruthy();
    expect(
      (screen.getByRole('checkbox', { name: 'Select Assigned' }) as HTMLInputElement).checked,
    ).toBe(true);

    expect(
      (screen.getByRole('checkbox', { name: 'Select Credential' }) as HTMLInputElement).checked,
    ).toBe(false);
  });

  it('labels a same-plan selection as a no-op', () => {
    const onAssignMany = vi.fn();
    render(
      <PlanGroupingSurface
        unassigned={[]}
        plans={[{ ...plan, assignedAssets: [validAsset] }]}
        onAssignMany={onAssignMany}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Credential' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Move to plan' }), {
      target: { value: plan.id },
    });
    expect(screen.getByText('Already in this plan.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Move 1 assets' }));
    expect(onAssignMany).not.toHaveBeenCalled();
  });
  it('selects a range and moves the whole batch once', () => {
    const onAssignMany = vi.fn();
    const assets = [
      validAsset,
      { ...validAsset, id: 'asset-3', name: 'Second' },
      { ...validAsset, id: 'asset-4', name: 'Third' },
    ];
    render(
      <PlanGroupingSurface
        unassigned={assets}
        plans={[{ ...plan, assets: 0 }]}
        onAssignMany={onAssignMany}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Credential' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Third' }), { shiftKey: true });
    expect(screen.getByText('3 selected')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Move to plan' }), {
      target: { value: plan.id },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Move 3 assets' }));
    expect(onAssignMany).toHaveBeenCalledOnce();
    expect(onAssignMany).toHaveBeenCalledWith(assets, expect.objectContaining({ id: plan.id }));
  });

  it('selects only filtered rows with Ctrl+A and ignores a search input', () => {
    const assets = [
      validAsset,
      { ...validAsset, id: 'asset-3', name: 'Second' },
      { ...validAsset, id: 'asset-4', name: 'Third' },
    ];
    render(<PlanGroupingSurface unassigned={assets} plans={[plan]} onAssignMany={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Search unassigned assets' }));
    const input = screen.getByRole('textbox', { name: 'Search unassigned assets' });
    fireEvent.change(input, { target: { value: 'Second' } });
    fireEvent.keyDown(input, { key: 'a', ctrlKey: true });
    expect(screen.queryByText('1 selected')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second' }));
    fireEvent.keyDown(input.closest('.plan-grouping-surface')!, { key: 'a', ctrlKey: true });
    expect(screen.getByText('1 selected')).toBeTruthy();
    fireEvent.keyDown(input.closest('.plan-grouping-surface')!, { key: 'Escape' });
    expect(screen.queryByText('1 selected')).toBeNull();
  });

  it('replaces stale range anchors and rows when the asset search changes', () => {
    const assets = [
      { ...validAsset, folderPath: ['Matching'] },
      { ...validAsset, id: 'asset-3', name: 'Second', folderPath: ['Other'] },
      { ...validAsset, id: 'asset-4', name: 'Third', folderPath: ['Matching'] },
    ];
    render(<PlanGroupingSurface unassigned={assets} plans={[plan]} onAssignMany={vi.fn()} />);

    const first = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select Credential' });
    const third = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select Third' });
    fireEvent.click(first);

    fireEvent.click(screen.getByRole('button', { name: 'Search unassigned assets' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search unassigned assets' }), {
      target: { value: '  MATCHING  ' },
    });
    expect(first.checked).toBe(false);
    expect(screen.queryByRole('checkbox', { name: 'Select Second' })).toBeNull();

    fireEvent.click(third, { shiftKey: true });
    expect(screen.getByText('1 selected')).toBeTruthy();
    fireEvent.click(first, { shiftKey: true });
    expect(screen.getByText('2 selected')).toBeTruthy();
  });

  it('blocks a batch that exceeds the selected plan capacity', () => {
    const onAssignMany = vi.fn();
    render(
      <PlanGroupingSurface
        unassigned={[validAsset, { ...validAsset, id: 'asset-3', name: 'Second' }]}
        plans={[{ ...plan, assets: 9 }]}
        onAssignMany={onAssignMany}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Credential' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second' }), { ctrlKey: true });
    fireEvent.change(screen.getByRole('combobox', { name: 'Move to plan' }), {
      target: { value: plan.id },
    });
    expect(
      screen.getByText('Plan has insufficient capacity for the whole selection.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Move 2 assets' }));
    expect(onAssignMany).not.toHaveBeenCalled();
  });

  it('unassigns selected assigned assets in one callback', () => {
    const onUnassignMany = vi.fn();
    const assigned = [validAsset, { ...validAsset, id: 'asset-3', name: 'Second' }];
    render(
      <PlanGroupingSurface
        unassigned={[]}
        plans={[{ ...plan, assignedAssets: assigned }]}
        onUnassignMany={onUnassignMany}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Credential' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second' }), { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Unassign selected' }));
    expect(onUnassignMany).toHaveBeenCalledOnce();
    expect(onUnassignMany).toHaveBeenCalledWith(assigned);
  });

  it('drags selected assets as one batch and blocks an over-capacity drop', () => {
    const onAssignMany = vi.fn();
    const assets = [validAsset, { ...validAsset, id: 'asset-3', name: 'Second' }];
    render(
      <PlanGroupingSurface
        unassigned={assets}
        plans={[{ ...plan, assets: 9 }]}
        onAssignMany={onAssignMany}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Credential' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second' }), { ctrlKey: true });
    fireEvent.dragStart(screen.getByText('Credential').closest('.plan-asset-row')!);
    const target = screen
      .getByRole('button', { name: 'Select Production' })
      .closest('.plan-drop-target')!;
    fireEvent.dragOver(target);
    expect(target.className).toContain('over-invalid');
    expect(screen.getByText('This plan cannot accept it')).toBeTruthy();
    fireEvent.drop(target);
    expect(onAssignMany).not.toHaveBeenCalled();
  });

  it('accepts a valid drop on an unselected navigator plan', () => {
    const onAssignMany = vi.fn();
    const extra = { ...plan, id: 'extra', name: 'Extra', assets: 0, assignedAssets: [] };
    render(
      <PlanGroupingSurface
        unassigned={[validAsset]}
        plans={[plan, extra]}
        onAssignMany={onAssignMany}
      />,
    );
    fireEvent.dragStart(screen.getByText('Credential').closest('.plan-asset-row')!);
    const target = screen
      .getByRole('button', { name: 'Select Extra' })
      .closest('.plan-drop-target')!;
    fireEvent.dragOver(target);
    expect(target.className).toContain('over-valid');
    fireEvent.drop(target);
    expect(onAssignMany).toHaveBeenCalledWith([validAsset], extra);
  });
  it('confirms the last empty draft and deletes an empty extra draft immediately', () => {
    const onDeletePlan = vi.fn();
    render(<PlanGroupingSurface unassigned={[]} plans={[plan]} onDeletePlan={onDeletePlan} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Production' }));
    expect(screen.getByRole('dialog', { name: 'Delete plan?' })).toBeTruthy();
    expect(onDeletePlan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete plan' }));
    expect(onDeletePlan).toHaveBeenCalledExactlyOnceWith(plan);
    onDeletePlan.mockClear();
    cleanup();
    const extra = { ...plan, id: 'extra', name: 'Extra', assets: 0, assignedAssets: [] };
    render(
      <PlanGroupingSurface unassigned={[]} plans={[plan, extra]} onDeletePlan={onDeletePlan} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete Extra' }));
    expect(screen.queryByRole('dialog', { name: 'Delete plan?' })).toBeNull();
    expect(onDeletePlan).toHaveBeenCalledWith(extra);
  });
  it('confirms deletion when assigned assets will return to Unassigned', () => {
    const onDeletePlan = vi.fn();
    const assigned = { ...plan, assignedAssets: [validAsset] };
    const extra = { ...plan, id: 'extra', name: 'Extra' };
    render(
      <PlanGroupingSurface unassigned={[]} plans={[assigned, extra]} onDeletePlan={onDeletePlan} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete Production' }));
    expect(screen.getByRole('dialog', { name: 'Delete plan?' })).toBeTruthy();
    expect(screen.getByText('The 1 asset in this plan will return to Unassigned.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onDeletePlan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Production' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete plan' }));
    expect(onDeletePlan).toHaveBeenCalledWith(assigned);
  });
  it('keeps the left asset list free of per-row Assign buttons', () => {
    render(
      <PlanGroupingSurface
        unassigned={[validAsset, invalidAsset]}
        plans={[plan]}
        selectedPlanId={plan.id}
        onAssign={vi.fn()}
        onCreatePlan={vi.fn()}
        onSelectPlan={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Assign' })).toBeNull();
  });

  it('uses the review-card title and reveals, clears, and closes scoped search', () => {
    render(
      <PlanGroupingSurface
        unassigned={[
          { ...validAsset, name: 'Production credential', source: 'prod.kdbx' },
          { ...invalidAsset, source: 'staging.env' },
        ]}
        plans={[plan]}
      />,
    );
    const title = screen.getByText('Production credential');
    expect(title.parentElement?.getAttribute('title')).toBe('Production credential');
    expect(title.className).toContain('plan-asset-row-name');
    expect(title.nextElementSibling?.textContent).toBe('Username and Password');
    fireEvent.click(screen.getByRole('button', { name: 'Search unassigned assets' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search unassigned assets' }), {
      target: { value: 'Broken' },
    });
    expect(screen.queryByText('Production credential')).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter unassigned assets by source' }), {
      target: { value: 'prod.kdbx' },
    });
    expect(screen.getByText('No matching assets.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear unassigned asset search' }));
    expect(screen.getByText('Production credential')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close unassigned asset search' }));
    expect(screen.queryByRole('textbox', { name: 'Search unassigned assets' })).toBeNull();
  });

  it('falls back to all sources when the selected source has no unassigned assets left', () => {
    const sourceA = { ...validAsset, source: 'a.kdbx' };
    const sourceB = { ...invalidAsset, source: 'b.kdbx' };
    const { rerender } = render(
      <PlanGroupingSurface unassigned={[sourceA, sourceB]} plans={[plan]} />,
    );
    const filter = screen.getByRole('combobox', {
      name: 'Filter unassigned assets by source',
    }) as HTMLSelectElement;
    fireEvent.change(filter, { target: { value: 'a.kdbx' } });
    expect(screen.queryByText('Broken credential')).toBeNull();
    rerender(<PlanGroupingSurface unassigned={[sourceB]} plans={[plan]} />);
    expect(filter.value).toBe('all');
    expect(screen.getByText('Broken credential')).toBeTruthy();
    rerender(<PlanGroupingSurface unassigned={[]} plans={[plan]} />);
    rerender(<PlanGroupingSurface unassigned={[sourceA, sourceB]} plans={[plan]} />);
    expect(filter.value).toBe('all');
    expect(screen.getByText('Credential')).toBeTruthy();
    expect(screen.getByText('Broken credential')).toBeTruthy();
  });

  it('disables plan creation when its callback is unavailable', () => {
    render(
      <PlanGroupingSurface unassigned={[validAsset]} plans={[plan]} selectedPlanId={plan.id} />,
    );

    expect(screen.queryByRole('button', { name: 'Assign' })).toBeNull();
    expect(screen.getByRole('button', { name: 'New plan' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });

  it('edits the selected plan name and description through the production editor', () => {
    const onUpdatePlan = vi.fn();
    render(<PlanGroupingSurface unassigned={[]} plans={[plan]} onUpdatePlan={onUpdatePlan} />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Production' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Plan name' }), {
      target: { value: '  Updated plan  ' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Plan description' }), {
      target: { value: '  Keeps production credentials together.  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));

    expect(onUpdatePlan).toHaveBeenCalledWith(plan, {
      name: 'Updated plan',
      description: 'Keeps production credentials together.',
    });
  });

  it('opens the editor for the plan whose pencil was pressed', () => {
    const secondPlan: PlanDraft = {
      id: 'plan-2',
      name: 'Partner access',
      description: 'Existing partner credentials.',
      assets: 0,
      capacity: '0 / 10 Assets',
      valid: true,
    };
    const onUpdatePlan = vi.fn();
    render(
      <PlanGroupingSurface
        unassigned={[]}
        plans={[plan, secondPlan]}
        onUpdatePlan={onUpdatePlan}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Partner access' }));
    expect((screen.getByRole('textbox', { name: 'Plan name' }) as HTMLInputElement).value).toBe(
      'Partner access',
    );
    expect(
      (screen.getByRole('textbox', { name: 'Plan description' }) as HTMLTextAreaElement).value,
    ).toBe('Existing partner credentials.');
  });

  it('keeps the editor open and reports an inline error for a blank plan name', () => {
    const onUpdatePlan = vi.fn();
    render(
      <PlanGroupingSurface
        unassigned={[]}
        plans={[plan]}
        selectedPlanId={plan.id}
        onUpdatePlan={onUpdatePlan}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Production' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Plan name' }), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save details' }));

    expect(screen.getByRole('alert').textContent).toContain('Plan name is required.');
    expect(screen.queryByRole('dialog', { name: 'Edit plan details' })).not.toBeNull();
    expect(onUpdatePlan).not.toHaveBeenCalled();
  });

  it('preserves unsaved metadata when the workspace projection refreshes', () => {
    const onUpdatePlan = vi.fn();
    const { rerender } = render(
      <PlanGroupingSurface
        unassigned={[]}
        plans={[plan]}
        selectedPlanId={plan.id}
        onUpdatePlan={onUpdatePlan}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Production' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Plan name' }), {
      target: { value: 'Unsaved name' },
    });
    rerender(
      <PlanGroupingSurface
        unassigned={[]}
        plans={[{ ...plan }]}
        selectedPlanId={plan.id}
        onUpdatePlan={onUpdatePlan}
      />,
    );

    expect((screen.getByRole('textbox', { name: 'Plan name' }) as HTMLInputElement).value).toBe(
      'Unsaved name',
    );
  });
});
