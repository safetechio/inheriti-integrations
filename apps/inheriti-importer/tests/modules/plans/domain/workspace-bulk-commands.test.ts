import { describe, expect, it } from 'vitest';
import {
  makePlanDraft,
  type AssetDraft,
  type WorkspaceState,
} from '@modules/plans/domain/workspace-model';
import {
  assignAssetsToPlan,
  createPlansFromAssets,
  unassignAssetsFromPlans,
  type BulkAssetSelection,
} from '@modules/plans/domain/workspace-bulk-commands';

const asset = (id: string): AssetDraft => ({
  id,
  name: id,
  type: 'PLAIN-TEXT',
  fieldBindings: { 'secret.text': { kind: 'source', sourceFieldId: `source-${id}` } },
});
const select = (id: string, accepted = true): BulkAssetSelection => ({
  id,
  accepted,
  draft: asset(id),
  matches: (item) => item.id === id,
});
function workspace(from: AssetDraft[] = [], to: AssetDraft[] = []): WorkspaceState {
  return {
    planOrder: ['from', 'to'],
    plansByClientId: {
      from: { ...makePlanDraft('from', 'From'), assets: from },
      to: { ...makePlanDraft('to', 'To'), assets: to },
    },
    ignoredSourceFieldIds: [],
    revision: 0,
  };
}

describe('bulk workspace commands', () => {
  it('replaces only the untouched initial placeholder when creating plans from a selection', () => {
    const before = workspace();
    before.planOrder = ['from'];
    delete before.plansByClientId.to;
    before.plansByClientId.from.placeholder = true;
    const options = { name: 'Imported', folderId: null, scope: 'SHARED' as const };
    const after = createPlansFromAssets(before, [select('new')], ['one'], options);
    expect(after.planOrder).toEqual(['one']);
    expect(after.plansByClientId.from).toBeUndefined();
    expect(after.revision).toBe(1);
    before.plansByClientId.from.placeholder = undefined;
    expect(createPlansFromAssets(before, [select('new')], ['one'], options).planOrder).toEqual(['one', 'from']);
  });
  it('creates split personal plans in one revision while preserving existing assignments', () => {
    const before = workspace([asset('existing')]);
    const selections = Array.from({ length: 11 }, (_, n) => select(`new-${n}`));
    const after = createPlansFromAssets(before, selections, ['one', 'two'], {
      name: 'Imported',
      folderId: 'folder-1',
      scope: 'PERSONAL',
    });
    expect(after.revision).toBe(1);
    expect(after.planOrder.slice(0, 2)).toEqual(['one', 'two']);
    expect(after.plansByClientId.one.assets).toHaveLength(10);
    expect(after.plansByClientId.two.assets).toHaveLength(1);
    expect(after.plansByClientId.one.folderId).toBe('folder-1');
    expect(after.plansByClientId.one.governance.sharingModel).toBe('PRIVATE');
    expect(after.plansByClientId.from.assets).toEqual([asset('existing')]);
    const moved = createPlansFromAssets(before, [select('existing'), select('new')], ['moved'], {
      name: 'Moved',
      folderId: null,
      scope: 'SHARED',
    });
    expect(moved.plansByClientId.from.assets).toEqual([]);
    expect(moved.plansByClientId.moved.assets[0]).toBe(before.plansByClientId.from.assets[0]);
    expect(moved.plansByClientId.moved.assets[1]).toEqual(asset('new'));
    expect(moved.revision).toBe(1);
    expect(
      createPlansFromAssets(before, [select('new'), select('bad', false)], ['no'], {
        name: 'No',
        folderId: null,
        scope: 'SHARED',
      }),
    ).toBe(before);
    expect(
      createPlansFromAssets(before, [select('new')], ['no'], {
        name: '  ',
        folderId: null,
        scope: 'SHARED',
      }),
    ).toBe(before);
  });
  it('splits mixed assigned and unassigned assets without losing bindings', () => {
    const bound = asset('bound');
    const before = workspace([bound]);
    const selected = [
      select('bound'),
      ...Array.from({ length: 10 }, (_, index) => select(`fresh-${index}`)),
    ];
    const after = createPlansFromAssets(before, selected, ['first', 'second'], {
      name: 'Group',
      folderId: null,
      scope: 'SHARED',
    });
    expect(after.plansByClientId.first.assets[0]).toBe(bound);
    expect(after.plansByClientId.first.assets).toHaveLength(10);
    expect(after.plansByClientId.second.assets).toHaveLength(1);
    expect(after.plansByClientId.from.assets).toEqual([]);
    expect(after.revision).toBe(1);
    const ambiguous = workspace([asset('same')], [asset('same')]);
    expect(
      createPlansFromAssets(ambiguous, [select('same')], ['no'], {
        name: 'No',
        folderId: null,
        scope: 'SHARED',
      }),
    ).toBe(ambiguous);
  });
  it('moves a bound asset without duplicating it and uses one revision', () => {
    const original = asset('a');
    const before = workspace([original]);
    const after = assignAssetsToPlan(before, 'to', [select('a'), select('b')], 10);
    expect(after.plansByClientId.from.assets).toEqual([]);
    expect(after.plansByClientId.to.assets).toEqual([original, asset('b')]);
    expect(after.plansByClientId.to.assets[0]).toBe(original);
    expect(after.revision).toBe(1);
    expect(before.plansByClientId.from.assets).toEqual([original]);
  });

  it('accepts exact capacity and rejects a full target atomically', () => {
    const before = workspace(
      [asset('a')],
      Array.from({ length: 9 }, (_, n) => asset(`old-${n}`)),
    );
    const full = assignAssetsToPlan(before, 'to', [select('a')], 10);
    expect(full.plansByClientId.to.assets).toHaveLength(10);
    expect(assignAssetsToPlan(full, 'to', [select('new')], 10)).toBe(full);
    expect(assignAssetsToPlan(before, 'to', [select('a'), select('new')], 10)).toBe(before);
  });

  it('uses the latest workspace count when a preview still shows an empty target', () => {
    const stalePreviewCapacity = 10;
    const before = workspace(
      [],
      Array.from({ length: 9 }, (_, n) => asset(`old-${n}`)),
    );
    const current = assignAssetsToPlan(before, 'to', [select('a')], stalePreviewCapacity);
    expect(current.plansByClientId.to.assets).toHaveLength(10);
    expect(assignAssetsToPlan(current, 'to', [select('b')], stalePreviewCapacity)).toBe(current);
  });

  it('deduplicates selected IDs and repeated assignment is a no-op', () => {
    const before = workspace();
    const after = assignAssetsToPlan(before, 'to', [select('a'), select('a')], 10);
    expect(after.plansByClientId.to.assets).toHaveLength(1);
    expect(assignAssetsToPlan(after, 'to', [select('a')], 10)).toBe(after);
  });

  it('rejects an unaccepted asset, missing target, or ambiguous existing asset without partial changes', () => {
    const before = workspace([asset('a')]);
    expect(assignAssetsToPlan(before, 'to', [select('a'), select('bad', false)], 10)).toBe(before);
    expect(assignAssetsToPlan(before, 'missing', [select('a')], 10)).toBe(before);
    const ambiguous = workspace([asset('a')], [asset('a')]);
    expect(assignAssetsToPlan(ambiguous, 'to', [select('a')], 10)).toBe(ambiguous);
  });

  it('unassigns selected assets in one update and rejects unknowns atomically', () => {
    const before = workspace([asset('a')], [asset('b')]);
    expect(unassignAssetsFromPlans(before, [select('a'), select('missing')])).toBe(before);
    const after = unassignAssetsFromPlans(before, [select('a'), select('b'), select('a')]);
    expect(after.plansByClientId.from.assets).toEqual([]);
    expect(after.plansByClientId.to.assets).toEqual([]);
    expect(after.revision).toBe(1);
    expect(unassignAssetsFromPlans(after, [select('a')])).toBe(after);
  });
});
