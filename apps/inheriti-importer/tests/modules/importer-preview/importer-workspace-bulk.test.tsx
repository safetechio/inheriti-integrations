// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SensitiveValue, type ImportSession } from '@modules/import/domain/import-model';
import { suggestedAssetToDraft } from '@modules/mapping/application/suggestion-engine';
import { useImporterWorkspace } from '@modules/importer-preview/ImporterFlow/application/importer-workspace';
import {
  sourceSuggestions,
  statusKey,
} from '@modules/importer-preview/ImporterFlow/application/importer-workspace-suggestions';
import { createEmptyWorkspace } from '@modules/plans/domain/workspace-model';
import { createPlan } from '@modules/plans/domain/workspace-commands';
import { createHistory, pushHistory, redo, undo } from '@modules/plans/domain/workspace-history';

function session(): ImportSession {
  return {
    id: 'session',
    sources: [
      {
        id: 'source',
        kind: 'dotenv',
        name: '.env',
        fileName: '.env',
        importedAt: '2026-01-01',
        warnings: [],
      },
    ],
    rootNodeIds: ['entry'],
    nodesById: {
      entry: {
        id: 'entry',
        sourceId: 'source',
        parentNodeId: null,
        kind: 'entry',
        name: 'Token',
        path: [],
        childNodeIds: [],
        fieldIds: ['field'],
      },
    },
    fieldsById: {
      field: {
        id: 'field',
        sourceId: 'source',
        parentNodeId: 'entry',
        sourcePath: ['entry', 'token'],
        name: 'token',
        value: new SensitiveValue('secret'),
        metadata: {},
      },
    },
  };
}

describe('useImporterWorkspace bulk plan actions', () => {
  it('moves an assigned asset with one setter call and one undoable history entry', () => {
    const imported = session();
    const suggestion = sourceSuggestions(imported)[0]!;
    const draft = suggestedAssetToDraft(suggestion, statusKey(suggestion));
    const from = createPlan(createEmptyWorkspace(), { clientId: 'from', name: 'From' });
    const initial = createPlan(from, { clientId: 'to', name: 'To' });
    initial.plansByClientId.from.assets = [draft];
    const setterCalls = vi.fn();
    const { result } = renderHook(() => {
      const [history, setHistory] = useState(() => createHistory(initial));
      const setWorkspace = (
        next: typeof initial | ((current: typeof initial) => typeof initial),
      ) => {
        setterCalls();
        setHistory((current) =>
          pushHistory(current, typeof next === 'function' ? next(current.present) : next),
        );
      };
      return {
        history,
        importer: useImporterWorkspace(imported, history.present, setWorkspace),
        undo: () => setHistory(undo),
        redo: () => setHistory(redo),
      };
    });
    const assigned = result.current.importer.plans[0]!.assignedAssets![0]!;
    act(() => result.current.importer.assignAssets([assigned], result.current.importer.plans[1]!));
    expect(setterCalls).toHaveBeenCalledTimes(1);
    expect(result.current.history.past).toHaveLength(1);
    expect(result.current.history.present.plansByClientId.from.assets).toEqual([]);
    expect(result.current.history.present.plansByClientId.to.assets[0]).toBe(draft);
    act(() => result.current.undo());
    expect(result.current.history.present.plansByClientId.from.assets[0]).toBe(draft);
    act(() => result.current.redo());
    expect(result.current.history.present.plansByClientId.to.assets[0]).toBe(draft);
  });
  it('can delete every draft in one undoable update and regroup its assets from zero', () => {
    const imported = session();
    const suggestion = sourceSuggestions(imported)[0]!;
    const draft = suggestedAssetToDraft(suggestion, statusKey(suggestion));
    const first = createPlan(createEmptyWorkspace(), { clientId: 'first', name: 'First' });
    const initial = createPlan(first, { clientId: 'last', name: 'Last' });
    initial.plansByClientId.last.assets = [draft];
    const { result } = renderHook(() => {
      const [history, setHistory] = useState(() => createHistory(initial));
      const setWorkspace = (next: typeof initial | ((current: typeof initial) => typeof initial)) =>
        setHistory((current) =>
          pushHistory(current, typeof next === 'function' ? next(current.present) : next),
        );
      return {
        history,
        importer: useImporterWorkspace(imported, history.present, setWorkspace),
        undo: () => setHistory(undo),
      };
    });

    const review = result.current.importer.assets.find((asset) => asset.id === draft.id)!;
    act(() => result.current.importer.reviewAsset('accept', review));
    act(() => result.current.importer.deletePlans(result.current.importer.plans));
    expect(result.current.importer.plans).toEqual([]);
    expect(result.current.importer.unassigned.map((asset) => asset.name)).toEqual([draft.name]);
    expect(result.current.history.past).toHaveLength(1);
    act(() => result.current.undo());
    expect(result.current.history.present).toBe(initial);
    expect(result.current.importer.unassigned).toEqual([]);

    act(() => result.current.importer.deletePlan({ id: 'first' }));
    act(() => result.current.importer.deletePlan({ id: 'last' }));
    expect(result.current.importer.plans).toEqual([]);
    const unassigned = result.current.importer.unassigned;
    expect(unassigned.map((asset) => asset.name)).toEqual([draft.name]);
    act(() => result.current.importer.createPlansFromAssets(unassigned, {
      name: 'Regrouped',
      folderId: null,
      scope: 'SHARED',
    }));
    expect(result.current.importer.plans).toEqual([expect.objectContaining({ name: 'Regrouped', assets: 1 })]);
    expect(result.current.importer.unassigned).toEqual([]);
  });

});
