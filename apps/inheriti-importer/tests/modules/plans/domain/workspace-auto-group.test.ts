import { describe, expect, it } from 'vitest';
import {
  autoGroupUnassigned,
  type AutoGroupSelection,
} from '../../../../src/modules/plans/domain/workspace-auto-group';
import {
  createEmptyWorkspace,
  makePlanDraft,
} from '../../../../src/modules/plans/domain/workspace-model';

function items(
  count: number,
  sourceId = 'source-a',
  folderPath: string[] = [],
): AutoGroupSelection[] {
  return Array.from({ length: count }, (_, index) => {
    const id = `${sourceId}-${index}`;
    return {
      id,
      sourceId,
      sourceName: 'vault',
      folderPath,
      accepted: true,
      draft: { id, name: id, type: 'USER-PSWD', fieldBindings: {} },
      matches: (asset) => asset.id === id,
    };
  });
}

describe('autoGroupUnassigned', () => {
  it.each([10, 11, 20])('splits %i assets at capacity with one revision', (count) => {
    const result = autoGroupUnassigned(createEmptyWorkspace(), items(count), true, ['a', 'b'], 10);
    expect(result.planOrder).toHaveLength(Math.ceil(count / 10));
    expect(result.planOrder.map((id) => result.plansByClientId[id].assets.length)).toEqual(
      count === 11 ? [10, 1] : count === 20 ? [10, 10] : [10],
    );
    expect(result.revision).toBe(1);
    expect(autoGroupUnassigned(result, items(count), true, ['c', 'd'], 10)).toBe(result);
  });

  it('keeps identical folder names from different sources separate', () => {
    const result = autoGroupUnassigned(
      createEmptyWorkspace(),
      [...items(1, 'a', ['Nested', 'Team']), ...items(1, 'b', ['Nested', 'Team'])],
      true,
      ['one', 'two'],
      10,
    );
    expect(result.planOrder).toEqual(['one', 'two']);
    expect(result.plansByClientId.one.sourceGroup).toEqual({
      sourceId: 'a',
      path: ['Nested', 'Team'],
    });
    expect(result.plansByClientId.two.sourceGroup).toEqual({
      sourceId: 'b',
      path: ['Nested', 'Team'],
    });
  });

  it('does not merge a literal delimiter with nested path segments from one source', () => {
    const literal = items(1, 'source', ['A / B', 'C'])[0];
    const nested = {
      ...items(1, 'source', ['A', 'B', 'C'])[0],
      id: 'nested',
      draft: { ...items(1, 'source')[0].draft, id: 'nested' },
      matches: (asset: { id: string }) => asset.id === 'nested',
    };
    const result = autoGroupUnassigned(
      createEmptyWorkspace(),
      [literal, nested],
      true,
      ['literal-plan', 'nested-plan'],
      10,
    );
    expect(result.planOrder).toEqual(['literal-plan', 'nested-plan']);
    expect(result.plansByClientId['literal-plan'].sourceGroup?.path).toEqual(['A / B', 'C']);
    expect(result.plansByClientId['nested-plan'].sourceGroup?.path).toEqual(['A', 'B', 'C']);
  });

  it('preserves edited plans and current assignments', () => {
    const manual = {
      ...makePlanDraft('manual', 'Edited'),
      description: 'keep',
      assets: [items(1)[0].draft],
    };
    const state = { ...createEmptyWorkspace(), planOrder: ['manual'], plansByClientId: { manual } };
    const result = autoGroupUnassigned(state, items(2), false, ['new'], 10);
    expect(result.plansByClientId.manual).toBe(manual);
    expect(result.plansByClientId.new.assets.map((asset) => asset.id)).toEqual(['source-a-1']);
    expect(result.revision).toBe(1);
  });

  it('rejects invalid selections atomically and consumes only a pristine placeholder', () => {
    const placeholder = { ...makePlanDraft('initial', 'Plan 1'), placeholder: true as const };
    const state = {
      ...createEmptyWorkspace(),
      planOrder: ['initial'],
      plansByClientId: { initial: placeholder },
    };
    expect(
      autoGroupUnassigned(state, [{ ...items(1)[0], accepted: false }], true, ['new'], 10),
    ).toBe(state);
    const result = autoGroupUnassigned(state, items(1), true, ['new'], 10);
    expect(result.planOrder).toEqual(['new']);
    expect(result.plansByClientId.initial).toBeUndefined();
  });
});
