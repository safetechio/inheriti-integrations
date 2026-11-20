// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SensitiveValue, type ImportSession } from '@modules/import/domain/import-model';
import { useImporterWorkspace } from '@modules/importer-preview/ImporterFlow/application/importer-workspace';
import { createEmptyWorkspace, makePlanDraft } from '@modules/plans/domain/workspace-model';
import { createHistory, pushHistory, undo, redo } from '@modules/plans/domain/workspace-history';

const session: ImportSession = {
  id: 'session',
  sources: [
    {
      id: 'source',
      kind: 'dotenv',
      name: 'Vault',
      fileName: 'vault.env',
      importedAt: '2026-01-01',
      warnings: [],
    },
  ],
  rootNodeIds: ['one', 'two'],
  nodesById: Object.fromEntries(
    ['one', 'two'].map((id) => [
      id,
      {
        id,
        sourceId: 'source',
        parentNodeId: null,
        kind: 'entry' as const,
        name: id,
        path: ['Root', 'Nested'],
        childNodeIds: [],
        fieldIds: [`${id}-field`],
      },
    ]),
  ),
  fieldsById: Object.fromEntries(
    ['one', 'two'].map((id) => [
      `${id}-field`,
      {
        id: `${id}-field`,
        sourceId: 'source',
        parentNodeId: id,
        sourcePath: [id, 'token'],
        name: 'token',
        value: new SensitiveValue('secret'),
        metadata: {},
      },
    ]),
  ),
};

describe('useImporterWorkspace auto grouping', () => {
  it('groups eligible assets in one undoable update and keeps manual metadata', () => {
    const manual = { ...makePlanDraft('manual', 'Manual'), description: 'keep' };
    const initial = {
      ...createEmptyWorkspace(),
      planOrder: ['manual'],
      plansByClientId: { manual },
    };
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
        importer: useImporterWorkspace(session, history.present, setWorkspace),
        undo: () => setHistory(undo),
        redo: () => setHistory(redo),
      };
    });
    for (const asset of result.current.importer.assets) {
      act(() => result.current.importer.reviewAsset('accept', asset));
    }
    const eligible = result.current.importer.unassigned.filter((asset) => asset.valid);
    expect(eligible).toHaveLength(2);
    setterCalls.mockClear();
    let revealedId: string | undefined;
    act(() => { revealedId = result.current.importer.autoGroupUnassigned(true); });
    expect(setterCalls).toHaveBeenCalledTimes(1);
    expect(result.current.history.past).toHaveLength(1);
    expect(result.current.history.present.plansByClientId.manual).toBe(manual);
    expect(result.current.history.present.planOrder).toHaveLength(2);
    const grouped =
      result.current.history.present.plansByClientId[result.current.history.present.planOrder[1]];
    expect(revealedId).toBe(grouped.clientId);
    expect(grouped.sourceGroup).toEqual({ sourceId: 'source', path: ['Root', 'Nested'] });
    expect(result.current.importer.plans[1].sourceName).toBe('vault.env');
    expect(grouped.assets).toHaveLength(eligible.length);
    act(() => result.current.importer.autoGroupUnassigned(true));
    expect(setterCalls).toHaveBeenCalledTimes(1);
    act(() => result.current.undo());
    expect(result.current.history.present).toBe(initial);
    act(() => result.current.redo());
    expect(result.current.history.present.plansByClientId[grouped.clientId]).toBe(grouped);
  });
});
