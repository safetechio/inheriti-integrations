import { describe, expect, it } from 'vitest';
import {
  flowReducer,
  type FlowState,
} from '@modules/importer-preview/ImporterFlow/hooks/flow-reducer';
import {
  hasPlanCapacity,
  isPlanOverCapacity,
  planUsage,
} from '@modules/importer-preview/PlanGroupingSurface/capacity';
import type { PlanDraft } from '@modules/importer-preview/PlanGroupingSurface';

function state(overrides: Partial<FlowState> = {}): FlowState {
  return {
    stage: overrides.stage ?? 'sources',
    stagingState: overrides.stagingState ?? 'idle',
    selectedAssetId: overrides.selectedAssetId,
    files: overrides.files ?? [],
    assets: overrides.assets ?? [],
    unassigned: overrides.unassigned ?? [],
    plans: overrides.plans ?? [],
  };
}

function plan(assets: number, id = 'plan-1', name = 'Plan draft 1'): PlanDraft {
  return {
    id,
    name,
    assets,
    capacity: '11 / 10 Assets',
    valid: true,
    assignedAssets: [],
  };
}

describe('importer preview state', () => {
  it('stores complete metadata after unlocking a source', () => {
    const current = state({
      stagingState: 'releasing',
      files: [{ name: 'vault.json', format: 'Vault', status: 'unlock-required' }],
    });

    const next = flowReducer(current, {
      type: 'source-status',
      name: 'vault.json',
      status: 'imported',
      entries: 24,
      warnings: 0,
    });

    expect(next.files[0]).toMatchObject({ status: 'imported', entries: 24, warnings: 0 });
    expect(next.stagingState).toBe('configured');
  });

  it('resets staging when a plan is created', () => {
    const next = flowReducer(state({ stagingState: 'encrypting', plans: [plan(3)] }), {
      type: 'create-plan',
      id: 'plan-2',
    });

    expect(next.stagingState).toBe('configured');
    expect(next.plans.map((item) => item.id)).toEqual(['plan-2', 'plan-1']);
    expect(next.plans[0]?.name).toBe('Plan 2');
  });

  it('ignores a duplicate create-plan action', () => {
    const current = state({ plans: [plan(3)] });
    const next = flowReducer(current, { type: 'create-plan', id: 'plan-1' });

    expect(next).toEqual(current);
  });

  it('deletes a draft and returns its Assets to Unassigned', () => {
    const asset = { id: 'asset-1', name: 'Credential', type: 'USER-PSWD' };
    const next = flowReducer(
      state({
        plans: [{ ...plan(1), assignedAssets: [asset] }, plan(0, 'plan-2', 'Plan draft 2')],
      }),
      {
        type: 'delete-plan',
        id: 'plan-1',
      },
    );
    expect(next.plans.map((item) => item.id)).toEqual(['plan-2']);
    expect(next.unassigned).toEqual([asset]);
  });

  it('protects the default first Plan from deletion', () => {
    const asset = { id: 'asset-1', name: 'Credential', type: 'USER-PSWD' };
    const current = state({ plans: [{ ...plan(1), assignedAssets: [asset] }] });
    const next = flowReducer(current, { type: 'delete-plan', id: 'plan-1' });

    expect(next.plans).toEqual(current.plans);
    expect(next.unassigned).toEqual([]);
  });

  it('uses mutable plan usage so an over-capacity draft can recover', () => {
    const overCapacity = plan(11);
    const recovered = plan(10);

    expect(planUsage(overCapacity)).toBe(11);
    expect(isPlanOverCapacity(overCapacity)).toBe(true);
    expect(planUsage(recovered)).toBe(10);
    expect(isPlanOverCapacity(recovered)).toBe(false);
    expect(hasPlanCapacity(recovered)).toBe(false);
  });
});
