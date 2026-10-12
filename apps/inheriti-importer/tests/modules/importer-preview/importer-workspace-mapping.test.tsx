// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { SensitiveValue, type ImportSession } from '@modules/import/domain/import-model';
import { useImporterWorkspace } from '@modules/importer-preview/ImporterFlow/application/importer-workspace';
import { createEmptyWorkspace } from '@modules/plans/domain/workspace-model';
import { createPlan } from '@modules/plans/domain/workspace-commands';
import {
  createHistory,
  pushHistory,
  replaceHistory,
  canUndo,
} from '@modules/plans/domain/workspace-history';

function importSession(): ImportSession {
  return {
    id: 'session-1',
    sources: [
      {
        id: 'source-1',
        kind: 'dotenv',
        name: '.env',
        fileName: '.env',
        importedAt: '2026-01-01',
        warnings: [],
      },
    ],
    rootNodeIds: ['entry-1'],
    nodesById: {
      'entry-1': {
        id: 'entry-1',
        sourceId: 'source-1',
        parentNodeId: null,
        kind: 'entry',
        name: 'Partner',
        path: [],
        childNodeIds: [],
        fieldIds: ['field-token', 'field-other'],
      },
    },
    fieldsById: {
      'field-token': {
        id: 'field-token',
        sourceId: 'source-1',
        parentNodeId: 'entry-1',
        sourcePath: ['entry-1', 'token'],
        name: 'token',
        value: new SensitiveValue('first-token'),
        metadata: {},
      },
      'field-other': {
        id: 'field-other',
        sourceId: 'source-1',
        parentNodeId: 'entry-1',
        sourcePath: ['entry-1', 'other'],
        name: 'other',
        value: new SensitiveValue('second-token'),
        metadata: {},
      },
    },
  };
}

describe('useImporterWorkspace schema mapping lifecycle', () => {
  it('removes an empty production draft without blocking the remaining plan', () => {
    const initialWorkspace = createPlan(
      createPlan(createEmptyWorkspace(), { clientId: 'plan-1', name: 'First' }),
      { clientId: 'plan-2', name: 'Empty' },
    );
    const imported = importSession();
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(initialWorkspace);
      return { workspace, importer: useImporterWorkspace(imported, workspace, setWorkspace) };
    });
    act(() => result.current.importer.deletePlan({ id: 'plan-2' }));
    expect(result.current.workspace.planOrder).toEqual(['plan-1']);
    expect(result.current.importer.plans.map((plan) => plan.id)).toEqual(['plan-1']);
  });

  it('keeps mapping, decisions, and assigned production drafts synchronized', () => {
    const session = importSession();
    const initialWorkspace = createPlan(createEmptyWorkspace(), {
      clientId: 'plan-1',
      name: 'Partner Plan',
    });
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(initialWorkspace);
      return { workspace, importer: useImporterWorkspace(session, workspace, setWorkspace) };
    });

    const reviewAsset = result.current.importer.assets[0]!;
    act(() => result.current.importer.mapAssetField(reviewAsset, 'secret.apiKey', 'field-other'));
    expect(
      result.current.importer.assets[0]?.schemaFields?.find(
        (field) => field.key === 'secret.apiKey',
      )?.sourceFieldId,
    ).toBe('field-other');
    expect(result.current.importer.assets[0]?.status).toBe('needs-review');

    act(() => result.current.importer.reviewAsset('accept', result.current.importer.assets[0]!));
    expect(result.current.importer.unassigned).toHaveLength(1);

    act(() =>
      result.current.importer.assignAsset(
        result.current.importer.unassigned[0]!,
        result.current.importer.plans[0]!,
      ),
    );
    expect(
      result.current.workspace.plansByClientId['plan-1'].assets[0]?.fieldBindings['secret.apiKey'],
    ).toEqual({ kind: 'source', sourceFieldId: 'field-other' });

    act(() =>
      result.current.importer.mapAssetField(
        result.current.importer.assets[0]!,
        'secret.apiKey',
        undefined,
      ),
    );
    expect(
      result.current.workspace.plansByClientId['plan-1'].assets[0]?.fieldBindings['secret.apiKey'],
    ).toBeUndefined();
    expect(result.current.importer.assets[0]?.status).toBe('needs-review');
  });

  it('updates a plain-text literal and an already assigned draft', () => {
    const session = importSession();
    session.fieldsById['field-token'].name = 'unknown';
    session.fieldsById['field-other'].name = 'other';
    const initialWorkspace = createPlan(createEmptyWorkspace(), {
      clientId: 'plan-1',
      name: 'Partner Plan',
    });
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(initialWorkspace);
      return { workspace, importer: useImporterWorkspace(session, workspace, setWorkspace) };
    });

    act(() => result.current.importer.reviewAsset('accept', result.current.importer.assets[0]!));
    act(() =>
      result.current.importer.assignAsset(
        result.current.importer.unassigned[0]!,
        result.current.importer.plans[0]!,
      ),
    );
    act(() => result.current.importer.editPlainText(result.current.importer.assets[0]!, 'edited'));

    expect(result.current.importer.assets[0]?.plainTextValue?.reveal()).toBe('edited');
    const binding =
      result.current.workspace.plansByClientId['plan-1'].assets[0]?.fieldBindings['secret.text'];
    expect(binding?.kind).toBe('literal');
    if (binding?.kind !== 'literal') throw new Error('Expected literal binding');
    expect(binding.value.reveal()).toBe('edited');
    expect(JSON.stringify(result.current.importer.assets[0])).not.toContain('edited');

    act(() =>
      result.current.importer.mapAssetField(
        result.current.importer.assets[0]!,
        'secret.text',
        'field-token',
      ),
    );
    expect(binding.value.isEmpty).toBe(true);
    expect(result.current.importer.assets[0]?.plainTextValue).toBeUndefined();
    expect(result.current.importer.assets[0]?.schemaFields?.[0]?.sourceFieldId).toBe('field-token');
    expect(
      result.current.workspace.plansByClientId['plan-1'].assets[0]?.fieldBindings['secret.text'],
    ).toEqual({ kind: 'source', sourceFieldId: 'field-token' });

    act(() =>
      result.current.importer.mapAssetField(
        result.current.importer.assets[0]!,
        'secret.text',
        undefined,
      ),
    );
    expect(result.current.importer.assets[0]?.plainTextSources).toEqual([
      { id: 'field-token', name: 'unknown', length: 11 },
      { id: 'field-other', name: 'other', length: 12 },
    ]);
    expect(
      result.current.workspace.plansByClientId['plan-1'].assets[0]?.fieldBindings['secret.text'],
    ).toEqual({
      kind: 'sources',
      sources: [
        { sourceFieldId: 'field-token', name: 'unknown' },
        { sourceFieldId: 'field-other', name: 'other' },
      ],
    });
  });

  it('only offers and applies the structured-to-plain-text override', () => {
    const session = importSession();
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(createEmptyWorkspace());
      return useImporterWorkspace(session, workspace, setWorkspace);
    });

    expect(result.current.assets[0]?.alternatives).toEqual(['PLAIN-TEXT']);
    act(() => result.current.reviewAsset('alternate:PLAIN-TEXT', result.current.assets[0]!));
    expect(result.current.assets[0]?.type).toBe('PLAIN-TEXT');
    expect(result.current.assets[0]?.alternatives).toEqual([]);
    expect(result.current.assets[0]?.plainTextSources).toEqual([
      { id: 'field-token', name: 'token', length: 11 },
      { id: 'field-other', name: 'other', length: 12 },
    ]);
    expect(JSON.stringify(result.current.assets[0])).not.toContain('first-token');
    act(() => result.current.editPlainText(result.current.assets[0]!, 'edited fallback'));
    expect(result.current.assets[0]?.plainTextValue?.reveal()).toBe('edited fallback');
    act(() => result.current.reviewAsset('accept', result.current.assets[0]!));
    expect(result.current.unassigned[0]?.id).toBe('entry-1:PLAIN-TEXT');
  });

  it('restores the original structured suggestion before assignment', () => {
    const session = importSession();
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(createEmptyWorkspace());
      return useImporterWorkspace(session, workspace, setWorkspace);
    });

    act(() => result.current.reviewAsset('alternate:PLAIN-TEXT', result.current.assets[0]!));
    expect(result.current.assets[0]?.convertedFromType).toBe('API-KEY');
    act(() => result.current.reviewAsset('restore-suggestion', result.current.assets[0]!));

    expect(result.current.assets[0]?.id).toBe('entry-1:API-KEY');
    expect(result.current.assets[0]?.type).toBe('API-KEY');
    expect(result.current.assets[0]?.convertedFromType).toBeUndefined();
  });

  it('replaces an already assigned structured draft with the canonical plain-text draft', () => {
    const session = importSession();
    const initialWorkspace = createPlan(createEmptyWorkspace(), {
      clientId: 'plan-1',
      name: 'Partner Plan',
    });
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(initialWorkspace);
      return { workspace, importer: useImporterWorkspace(session, workspace, setWorkspace) };
    });

    act(() => result.current.importer.reviewAsset('accept', result.current.importer.assets[0]!));
    act(() =>
      result.current.importer.assignAsset(
        result.current.importer.unassigned[0]!,
        result.current.importer.plans[0]!,
      ),
    );
    act(() =>
      result.current.importer.reviewAsset(
        'alternate:PLAIN-TEXT',
        result.current.importer.assets[0]!,
      ),
    );

    const draft = result.current.workspace.plansByClientId['plan-1'].assets[0]!;
    expect(draft.id).toBe('entry-1:PLAIN-TEXT');
    expect(draft.type).toBe('PLAIN-TEXT');
    expect(result.current.importer.unassigned).toEqual([]);

    act(() =>
      result.current.importer.reviewAsset('restore-suggestion', result.current.importer.assets[0]!),
    );
    const restored = result.current.workspace.plansByClientId['plan-1'].assets[0]!;
    expect(restored.id).toBe('entry-1:API-KEY');
    expect(restored.type).toBe('API-KEY');
    expect(restored.fieldBindings['secret.apiKey']).toEqual({
      kind: 'source',
      sourceFieldId: 'field-token',
    });
  });

  it('clears removed source literals and discards history so undo cannot restore them', () => {
    const session = importSession();
    session.fieldsById['field-token'].name = 'unknown';
    const initialWorkspace = createPlan(createEmptyWorkspace(), {
      clientId: 'plan-1',
      name: 'Partner Plan',
    });
    const { result } = renderHook(() => {
      const [history, setHistory] = useState(createHistory(initialWorkspace));
      const setWorkspace = (
        next:
          typeof initialWorkspace | ((current: typeof initialWorkspace) => typeof initialWorkspace),
      ) =>
        setHistory((current) =>
          pushHistory(current, typeof next === 'function' ? next(current.present) : next),
        );
      const replaceWorkspace = (
        next: (current: typeof initialWorkspace) => typeof initialWorkspace,
        discard: (workspace: typeof initialWorkspace) => void,
      ) => setHistory((current) => replaceHistory(current, next(current.present), discard));
      return {
        history,
        importer: useImporterWorkspace(session, history.present, setWorkspace, replaceWorkspace),
      };
    });

    expect(result.current.importer.assets[0]!.plainTextValue).toBeUndefined();
    act(() => result.current.importer.reviewAsset('accept', result.current.importer.assets[0]!));
    act(() =>
      result.current.importer.assignAsset(
        result.current.importer.unassigned[0]!,
        result.current.importer.plans[0]!,
      ),
    );
    act(() => result.current.importer.editPlainText(result.current.importer.assets[0]!, 'edited'));
    const projectedLiteral = result.current.importer.assets[0]!.plainTextValue!;
    const draftBinding =
      result.current.history.present.plansByClientId['plan-1'].assets[0].fieldBindings[
        'secret.text'
      ];
    if (draftBinding?.kind !== 'literal') throw new Error('Expected literal binding');
    const draftLiteral = draftBinding.value;

    act(() => result.current.importer.removeSource('source-1'));

    expect(projectedLiteral.isEmpty).toBe(true);
    expect(draftLiteral.isEmpty).toBe(true);
    expect(canUndo(result.current.history)).toBe(false);
    expect(result.current.history.present.plansByClientId['plan-1']).toBeUndefined();
  });
});
