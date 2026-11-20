import { describe, expect, it } from 'vitest';
import {
  assignAssets,
  unassignAssets,
} from '@modules/importer-preview/ImporterFlow/hooks/flow-assignment';
import {
  flowReducer,
  type FlowState,
} from '@modules/importer-preview/ImporterFlow/hooks/flow-reducer';
import type { GroupingAsset, PlanDraft } from '@modules/importer-preview/PlanGroupingSurface';

const first: GroupingAsset = { id: 'a', name: 'First', type: 'USER-PSWD', valid: true };
const second: GroupingAsset = { ...first, id: 'b', name: 'Second' };
const target: PlanDraft = {
  id: 'target',
  name: 'Target',
  assets: 0,
  capacity: '0 / 2 Assets',
  valid: true,
  assignedAssets: [],
};
function initial(): FlowState {
  return {
    stage: 'plans',
    stagingState: 'idle',
    files: [],
    assets: [],
    unassigned: [second],
    plans: [{ ...target, id: 'source', assets: 1, assignedAssets: [first] }, target],
  };
}

describe('preview bulk assignment', () => {
  it('deletes selected plans in one update and returns their assets', () => {
    const state = { ...initial(), plans: [...initial().plans, { ...target, id: 'third' }] };
    const deleted = flowReducer(state, { type: 'delete-plans', ids: ['source', 'third'] });
    expect(deleted.plans.map((plan) => plan.id)).toEqual(['target']);
    expect(deleted.unassigned).toEqual([second, first]);
    expect(flowReducer(state, { type: 'delete-plans', ids: ['source', 'missing'] })).toBe(state);
    expect(flowReducer(state, { type: 'delete-plans', ids: ['source', 'source'] })).toBe(state);
    const cleared = flowReducer(state, { type: 'delete-plans', ids: ['source', 'target', 'third'] });
    expect(cleared.plans).toEqual([]);
    expect(cleared.unassigned).toEqual([second, first]);
    expect(flowReducer(cleared, {
      type: 'create-plans-from-assets',
      assets: cleared.unassigned,
      ids: ['regrouped'],
      options: { name: 'Regrouped', folderId: null, scope: 'SHARED' },
    })).toMatchObject({
      plans: [{ id: 'regrouped', assignedAssets: [second, first] }],
      unassigned: [],
    });
  });
  it('creates a destination from assigned and unassigned assets in one action', () => {
    const state = initial();
    const action = {
      type: 'create-plans-from-assets' as const,
      assets: [first, second],
      ids: ['created'],
      options: { name: 'Created', folderId: 'folder', scope: 'PERSONAL' as const },
    };
    const moved = flowReducer(state, action);
    expect(moved.plans[0]).toMatchObject({
      id: 'created',
      assets: 2,
      folderId: 'folder',
      sharingModel: 'PRIVATE',
      assignedAssets: [first, second],
    });
    expect(moved.plans[1].assets).toBe(0);
    expect(moved.unassigned).toEqual([]);
    expect(flowReducer(state, { ...action, assets: [first, { ...second, id: 'missing' }] })).toBe(
      state,
    );
  });
  it('moves assigned and unassigned assets together without duplicates and can return the batch', () => {
    const moved = assignAssets(initial(), [first, second, first], target);
    expect(moved.unassigned).toEqual([]);
    expect(moved.plans[0].assets).toBe(0);
    expect(moved.plans[1].assignedAssets).toEqual([first, second]);
    expect(assignAssets(moved, [first, second], target)).toBe(moved);
    const removed = unassignAssets(moved, [first, second]);
    expect(removed.unassigned).toEqual([first, second]);
    expect(removed.plans[1].assets).toBe(0);
  });

  it('rejects the entire batch for stale IDs, invalid bindings or current capacity', () => {
    const state = initial();
    expect(assignAssets(state, [first, { ...second, id: 'missing' }], target)).toBe(state);
    const invalid = { ...state, unassigned: [{ ...second, valid: false }] };
    expect(assignAssets(invalid, [first, second], target)).toBe(invalid);
    const limited = { ...state, plans: [state.plans[0], { ...target, capacity: '0 / 1 Assets' }] };
    expect(assignAssets(limited, [first, second], target)).toBe(limited);
    expect(unassignAssets(state, [first, second])).toBe(state);
  });
});
