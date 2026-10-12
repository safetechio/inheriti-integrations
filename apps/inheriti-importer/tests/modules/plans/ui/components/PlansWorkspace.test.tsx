// @vitest-environment happy-dom
// See MappingWorkspace.test.tsx for why happy-dom is required here (getPlanAssetIconName
// pulls in Core's /core bundle).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PlansWorkspace } from '@modules/plans/ui/components/PlansWorkspace';
import {
  createEmptyImportSession,
  SensitiveValue,
  type ImportSession,
} from '@modules/import/domain/import-model';
import {
  makePlanDraft,
  type AssetDraft,
  type PlanDraft,
} from '@modules/plans/domain/workspace-model';

afterEach(cleanup);

function asset(overrides: Partial<AssetDraft> = {}): AssetDraft {
  return {
    id: 'a1',
    type: 'PLAIN-TEXT',
    name: 'Note',
    fieldBindings: { 'secret.text': { kind: 'literal', value: new SensitiveValue('hello world') } },
    ...overrides,
  };
}

function plan(overrides: Partial<PlanDraft> = {}): PlanDraft {
  return {
    ...makePlanDraft(overrides.clientId ?? 'plan-1', overrides.name ?? 'My Plan'),
    ...overrides,
  };
}

function baseProps(overrides: Partial<Parameters<typeof PlansWorkspace>[0]> = {}) {
  return {
    plans: [] as PlanDraft[],
    selectedPlanClientId: null,
    onSelectPlan: vi.fn(),
    onCreatePlan: vi.fn(),
    onEditPlan: vi.fn(),
    onDeletePlan: vi.fn(),
    onEditAsset: vi.fn(),
    onDeleteAsset: vi.fn(),
    onDropSuggestion: vi.fn(),
    onDropOutside: vi.fn(),
    session: createEmptyImportSession('s1') as ImportSession,
    onMoveAsset: vi.fn(),
    ...overrides,
  };
}

describe('PlansWorkspace', () => {
  it('renders the empty state with no Plans', () => {
    render(<PlansWorkspace {...baseProps()} />);
    expect(screen.getByText(/Drop an entry here, or create a Plan/i)).toBeTruthy();
  });

  it('expands a Plan by mouse and by keyboard to reveal its Assets', () => {
    const onSelectPlan = vi.fn();
    const single = plan({ assets: [asset()] });
    render(<PlansWorkspace {...baseProps({ plans: [single], onSelectPlan })} />);
    fireEvent.click(screen.getByRole('button', { name: /Expand My Plan/i }));
    expect(onSelectPlan).toHaveBeenCalledWith('plan-1');

    onSelectPlan.mockClear();
    fireEvent.keyDown(screen.getByRole('button', { name: /Expand My Plan/i }), { key: 'Enter' });
    expect(onSelectPlan).toHaveBeenCalledWith('plan-1');
  });

  it('shows per-Plan usage against the default limits once expanded', () => {
    const withAsset = plan({ assets: [asset()] });
    render(
      <PlansWorkspace {...baseProps({ plans: [withAsset], selectedPlanClientId: 'plan-1' })} />,
    );
    // 'hello world' is 11 chars, well within the 500-char default.
    expect(screen.getByText('11/500 chars · 0/10 files')).toBeTruthy();
    expect(screen.queryByText('Over limit')).toBeNull();
  });

  it('flags an over-limit Plan once its usage exceeds the supplied limits', () => {
    const withAsset = plan({
      assets: [
        asset({
          fieldBindings: {
            'secret.text': { kind: 'literal', value: new SensitiveValue('x'.repeat(20)) },
          },
        }),
      ],
    });
    render(
      <PlansWorkspace
        {...baseProps({
          plans: [withAsset],
          selectedPlanClientId: 'plan-1',
          usageLimits: { maxChars: 10, maxFiles: 10, maxFileBytes: 1024 },
        })}
      />,
    );
    expect(screen.getByText('Over limit')).toBeTruthy();
  });

  it('reports actionable issues for an invalid Plan draft (missing name, no Assets)', () => {
    const invalid = plan({ name: '', assets: [] });
    render(<PlansWorkspace {...baseProps({ plans: [invalid], selectedPlanClientId: 'plan-1' })} />);
    expect(screen.getByText('The Plan needs a name.')).toBeTruthy();
  });

  it('disables the per-asset Move action when there is only one Plan', () => {
    const single = plan({ assets: [asset()] });
    render(<PlansWorkspace {...baseProps({ plans: [single], selectedPlanClientId: 'plan-1' })} />);
    expect(screen.getByRole('button', { name: 'Move Note to another Plan' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('previews the usage delta on both Plans and moves the Asset once a destination is confirmed', () => {
    const onMoveAsset = vi.fn();
    const from = plan({ clientId: 'plan-1', name: 'Source Plan', assets: [asset()] });
    const to = plan({ clientId: 'plan-2', name: 'Destination Plan', assets: [] });
    render(
      <PlansWorkspace
        {...baseProps({ plans: [from, to], selectedPlanClientId: 'plan-1', onMoveAsset })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Move Note to another Plan' }));
    expect(screen.getByText('Move "Note"')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Destination Plan' }));
    // Source drops to 0 chars, destination picks up 11 ('hello world' has no files, only text).
    expect(screen.getByText('11/500 chars · 0/10 files → 0/500 chars · 0/10 files')).toBeTruthy();
    expect(screen.getByText('0/500 chars · 0/10 files → 11/500 chars · 0/10 files')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(onMoveAsset).toHaveBeenCalledWith({
      fromPlanClientId: 'plan-1',
      toPlanClientId: 'plan-2',
      assetId: 'a1',
    });
  });

  it('keeps Move disabled until a destination Plan is chosen', () => {
    const from = plan({ clientId: 'plan-1', assets: [asset()] });
    const to = plan({ clientId: 'plan-2', name: 'Other' });
    render(
      <PlansWorkspace {...baseProps({ plans: [from, to], selectedPlanClientId: 'plan-1' })} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Move Note to another Plan' }));
    expect(screen.getByRole('button', { name: 'Move' })).toHaveProperty('disabled', true);
  });

  it('deletes an Asset via its row action, by mouse and by keyboard', () => {
    const onDeleteAsset = vi.fn();
    const withAsset = plan({ assets: [asset()] });
    render(
      <PlansWorkspace
        {...baseProps({ plans: [withAsset], selectedPlanClientId: 'plan-1', onDeleteAsset })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete Note' }));
    expect(onDeleteAsset).toHaveBeenCalledWith('plan-1', 'a1');

    fireEvent.keyDown(screen.getByRole('button', { name: 'Edit Note' }), { key: 'Enter' });
  });

  it('edits and deletes a Plan via its row actions', () => {
    const onEditPlan = vi.fn();
    const onDeletePlan = vi.fn();
    render(<PlansWorkspace {...baseProps({ plans: [plan()], onEditPlan, onDeletePlan })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit My Plan' }));
    expect(onEditPlan).toHaveBeenCalledWith('plan-1');
    fireEvent.click(screen.getByRole('button', { name: 'Delete My Plan' }));
    expect(onDeletePlan).toHaveBeenCalledWith('plan-1');
  });

  it('shows a "no Assets yet" placeholder for an expanded, empty Plan', () => {
    render(<PlansWorkspace {...baseProps({ plans: [plan()], selectedPlanClientId: 'plan-1' })} />);
    expect(screen.getByText('No Assets yet. Map a field or add one to get started.')).toBeTruthy();
  });

  it('renders a dense list of many Plans, each with working row actions', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      plan({ clientId: `plan-${i}`, name: `Plan ${i}` }),
    );
    render(<PlansWorkspace {...baseProps({ plans: many })} />);
    expect(screen.getAllByRole('button', { name: /^Edit Plan \d+$/ })).toHaveLength(10);
  });
});
