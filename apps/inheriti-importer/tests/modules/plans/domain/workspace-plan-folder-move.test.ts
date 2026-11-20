import { expect, it } from 'vitest';
import { createEmptyWorkspace } from '@modules/plans/domain/workspace-model';
import { createPlan, movePlansToFolder } from '@modules/plans/domain/workspace-commands';
import { createHistory, pushHistory } from '@modules/plans/domain/workspace-history';

it('moves a whole selected draft group in one revision and history entry', () => {
  let before = createPlan(createEmptyWorkspace(), { clientId: 'a', name: 'Alpha' });
  before = createPlan(before, { clientId: 'b', name: 'Beta' });
  before = createPlan(before, { clientId: 'c', name: 'Gamma' });
  const binding = { sourceFieldId: 'field-1' };
  before = {
    ...before,
    plansByClientId: {
      ...before.plansByClientId,
      a: { ...before.plansByClientId.a, description: 'kept', assets: [{ id: 'asset', name: 'Asset', type: 'PLAIN-TEXT', fieldBindings: { value: binding } }] },
    },
  };
  const after = movePlansToFolder(before, { clientIds: ['a', 'b'], folderId: 'folder', scope: 'SHARED' });
  const history = pushHistory(createHistory(before), after);
  expect(after.revision).toBe(before.revision + 1);
  expect(history.past).toEqual([before]);
  expect(after.plansByClientId.a).toEqual({ ...before.plansByClientId.a, folderId: 'folder' });
  expect(after.plansByClientId.b.folderId).toBe('folder');
  expect(after.plansByClientId.c).toBe(before.plansByClientId.c);
  expect(after.plansByClientId.a.assets).toBe(before.plansByClientId.a.assets);
  expect(movePlansToFolder(after, { clientIds: ['a', 'b'], folderId: 'folder', scope: 'SHARED' })).toBe(after);
  expect(movePlansToFolder(before, { clientIds: ['a', 'missing'], folderId: 'folder', scope: 'SHARED' })).toBe(before);
  expect(movePlansToFolder(before, { clientIds: ['a', 'a'], folderId: 'folder', scope: 'SHARED' })).toBe(before);
  expect(movePlansToFolder(before, { clientIds: [], folderId: 'folder', scope: 'SHARED' })).toBe(before);
});

it('rejects implicit privacy changes for mixed and mismatched selections', () => {
  let before = createPlan(createEmptyWorkspace(), { clientId: 'shared', name: 'Shared' });
  before = createPlan(before, { clientId: 'private', name: 'Private', scope: 'PERSONAL' });
  expect(movePlansToFolder(before, { clientIds: ['shared', 'private'], folderId: 'f', scope: 'SHARED' })).toBe(before);
  expect(movePlansToFolder(before, { clientIds: ['private'], folderId: 'f', scope: 'SHARED' })).toBe(before);
  const after = movePlansToFolder(before, { clientIds: ['private'], folderId: 'f', scope: 'PERSONAL' });
  expect(after.plansByClientId.private.governance).toBe(before.plansByClientId.private.governance);
});
