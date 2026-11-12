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
  it('keeps the last draft and deletes an empty extra draft immediately', () => {
    const onDeletePlan = vi.fn();
    render(<PlanGroupingSurface unassigned={[]} plans={[plan]} onDeletePlan={onDeletePlan} />);
    expect(screen.queryByRole('button', { name: 'Delete Production' })).toBeNull();
    cleanup();
    const extra = { ...plan, id: 'extra', name: 'Extra', assets: 0, assignedAssets: [] };
    render(
      <PlanGroupingSurface unassigned={[]} plans={[plan, extra]} onDeletePlan={onDeletePlan} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete Extra' }));
    expect(screen.queryByRole('dialog', { name: 'Delete Extra?' })).toBeNull();
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
    expect(screen.getByRole('dialog', { name: 'Delete Production?' })).toBeTruthy();
    expect(screen.getByText('The 1 Asset in this plan will return to Unassigned.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onDeletePlan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Production' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete draft' }));
    expect(onDeletePlan).toHaveBeenCalledWith(assigned);
  });
  it('enables assignment only when the asset, plan capacity, and callback allow it', () => {
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

    const assignButtons = screen.getAllByRole('button', { name: 'Assign' });
    expect(assignButtons[0].getAttribute('aria-disabled')).not.toBe('true');
    expect(assignButtons[1].getAttribute('aria-disabled')).toBe('true');
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

  it('disables assignment and plan creation when their callbacks are unavailable', () => {
    render(
      <PlanGroupingSurface unassigned={[validAsset]} plans={[plan]} selectedPlanId={plan.id} />,
    );

    expect(screen.getByRole('button', { name: 'Assign' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'New plan' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });

  it('edits the selected plan name and description through the production editor', () => {
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
        selectedPlanId={plan.id}
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
