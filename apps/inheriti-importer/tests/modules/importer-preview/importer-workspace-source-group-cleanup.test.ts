import { describe, expect, it } from 'vitest';
import type { ImportSession } from '@modules/import/domain/import-model';
import { removeSourceFromWorkspace } from '@modules/importer-preview/ImporterFlow/application/importer-workspace-cleanup';
import { createEmptyWorkspace, makePlanDraft } from '@modules/plans/domain/workspace-model';

const session: ImportSession = {
  id: 'session',
  sources: [],
  rootNodeIds: [],
  fieldsById: {},
  nodesById: {
    removed: {
      id: 'removed',
      sourceId: 'old',
      parentNodeId: null,
      kind: 'entry',
      name: 'Removed',
      path: [],
      childNodeIds: [],
      fieldIds: [],
    },
    surviving: {
      id: 'surviving',
      sourceId: 'new',
      parentNodeId: null,
      kind: 'entry',
      name: 'Surviving',
      path: [],
      childNodeIds: [],
      fieldIds: [],
    },
  },
};

describe('removeSourceFromWorkspace source group cleanup', () => {
  it('clears removed source metadata on mixed and empty plans while preserving assets and manual details', () => {
    const asset = (id: string) => ({
      id: `${id}:PLAIN-TEXT`,
      name: id,
      type: 'PLAIN-TEXT',
      fieldBindings: {},
    });
    const mixed = {
      ...makePlanDraft('mixed', 'Edited'),
      description: 'keep',
      sourceGroup: { sourceId: 'old', path: ['A'] },
      assets: [asset('removed'), asset('surviving')],
    };
    const empty = {
      ...makePlanDraft('empty', 'Manual'),
      description: 'still here',
      sourceGroup: { sourceId: 'old', path: [] },
    };
    const workspace = {
      ...createEmptyWorkspace(),
      planOrder: ['mixed', 'empty'],
      plansByClientId: { mixed, empty },
    };
    const next = removeSourceFromWorkspace(session, workspace, 'old');
    expect(next.revision).toBe(workspace.revision + 1);
    expect(next.planOrder).toEqual(['mixed', 'empty']);
    expect(next.plansByClientId.mixed).toMatchObject({
      name: 'Edited',
      description: 'keep',
      assets: [asset('surviving')],
    });
    expect(next.plansByClientId.mixed.sourceGroup).toBeUndefined();
    expect(next.plansByClientId.empty).toMatchObject({
      name: 'Manual',
      description: 'still here',
      assets: [],
    });
    expect(next.plansByClientId.empty.sourceGroup).toBeUndefined();
    expect(removeSourceFromWorkspace(session, next, 'old')).toBe(next);
  });
});
