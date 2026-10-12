import { describe, expect, it } from 'vitest';
import { createEmptyWorkspace } from '@modules/plans/domain/workspace-model';
import {
  bindField,
  createAsset,
  createPlan,
  ignoreSourceField,
  moveAsset,
  removeAsset,
  removePlan,
  renamePlan,
  updatePlanMetadata,
  reorderPlans,
  unbindField,
} from '@modules/plans/domain/workspace-commands';

const asset = (id: string, type = 'PLAIN-TEXT') => ({ id, type, name: id, fieldBindings: {} });

describe('workspace commands', () => {
  it('createPlan adds a draft and bumps revision', () => {
    const s0 = createEmptyWorkspace();
    const s1 = createPlan(s0, { clientId: 'p1', name: 'One' });
    expect(s1.planOrder).toEqual(['p1']);
    expect(s1.plansByClientId.p1?.name).toBe('One');
    expect(s1.revision).toBe(1);
    // idempotent on the same id
    expect(createPlan(s1, { clientId: 'p1', name: 'again' })).toBe(s1);
  });

  it('renamePlan / removePlan', () => {
    let s = createPlan(createEmptyWorkspace(), { clientId: 'p1', name: 'One' });
    s = renamePlan(s, { clientId: 'p1', name: 'Renamed' });
    expect(s.plansByClientId.p1?.name).toBe('Renamed');
    s = removePlan(s, { clientId: 'p1' });
    expect(s.planOrder).toEqual([]);
    expect(s.plansByClientId.p1).toBeUndefined();
  });

  it('updatePlanMetadata trims metadata and preserves the rest of the draft', () => {
    let s = createPlan(createEmptyWorkspace(), { clientId: 'p1', name: 'One' });
    s = createAsset(s, { planClientId: 'p1', asset: asset('asset-1') });
    const before = s.plansByClientId.p1;
    const updated = updatePlanMetadata(s, {
      clientId: 'p1',
      name: '  Renamed  ',
      description: '  Import credentials  ',
    });

    expect(updated.plansByClientId.p1).toMatchObject({
      name: 'Renamed',
      description: 'Import credentials',
    });
    expect(updated.plansByClientId.p1?.assets).toEqual(before?.assets);
    expect(updated.revision).toBe(s.revision + 1);
    expect(updatePlanMetadata(updated, { clientId: 'p1', name: '   ' })).toBe(updated);
    expect(updatePlanMetadata(updated, { clientId: 'missing', name: 'Valid' })).toBe(updated);
  });

  it('reorderPlans only accepts a permutation of the known ids', () => {
    let s = createEmptyWorkspace();
    s = createPlan(s, { clientId: 'a', name: 'a' });
    s = createPlan(s, { clientId: 'b', name: 'b' });
    const rev = s.revision;
    s = reorderPlans(s, { order: ['b', 'a'] });
    expect(s.planOrder).toEqual(['b', 'a']);
    expect(reorderPlans(s, { order: ['b'] })).toEqual({ ...s });
    expect(reorderPlans(s, { order: ['b', 'a', 'c'] }).planOrder).toEqual(['b', 'a']);
    expect(s.revision).toBe(rev + 1);
  });

  it('createAsset / removeAsset / moveAsset', () => {
    let s = createEmptyWorkspace();
    s = createPlan(s, { clientId: 'p1', name: 'p1' });
    s = createPlan(s, { clientId: 'p2', name: 'p2' });
    s = createAsset(s, { planClientId: 'p1', asset: asset('x') });
    expect(s.plansByClientId.p1?.assets.map((a) => a.id)).toEqual(['x']);

    s = moveAsset(s, { fromPlanClientId: 'p1', toPlanClientId: 'p2', assetId: 'x' });
    expect(s.plansByClientId.p1?.assets).toEqual([]);
    expect(s.plansByClientId.p2?.assets.map((a) => a.id)).toEqual(['x']);

    s = removeAsset(s, { planClientId: 'p2', assetId: 'x' });
    expect(s.plansByClientId.p2?.assets).toEqual([]);
  });

  it('bindField / unbindField only touch the target asset', () => {
    let s = createEmptyWorkspace();
    s = createPlan(s, { clientId: 'p1', name: 'p1' });
    s = createAsset(s, { planClientId: 'p1', asset: asset('x', 'USER-PSWD') });
    s = bindField(s, {
      planClientId: 'p1',
      assetId: 'x',
      assetFieldSource: 'secret.password',
      binding: { kind: 'source', sourceFieldId: 'f1' },
    });
    expect(s.plansByClientId.p1?.assets[0]?.fieldBindings['secret.password']).toEqual({
      kind: 'source',
      sourceFieldId: 'f1',
    });
    s = unbindField(s, { planClientId: 'p1', assetId: 'x', assetFieldSource: 'secret.password' });
    expect(s.plansByClientId.p1?.assets[0]?.fieldBindings).toEqual({});
  });

  it('ignoreSourceField is idempotent', () => {
    const s1 = ignoreSourceField(createEmptyWorkspace(), { sourceFieldId: 'f1' });
    expect(s1.ignoredSourceFieldIds).toEqual(['f1']);
    expect(ignoreSourceField(s1, { sourceFieldId: 'f1' })).toBe(s1);
  });
});
