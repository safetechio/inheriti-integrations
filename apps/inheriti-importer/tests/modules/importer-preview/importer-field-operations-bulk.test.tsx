// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { SensitiveValue, type ImportSession } from '@modules/import/domain/import-model';
import type { FieldOperationRequest } from '@modules/importer-preview/AssetReviewQueue/field-operations';
import { useImporterWorkspace } from '@modules/importer-preview/ImporterFlow/application/importer-workspace';
import { createAsset, createPlan } from '@modules/plans/domain/workspace-commands';
import { createEmptyWorkspace } from '@modules/plans/domain/workspace-model';
import { materialiseAsset } from '@modules/plans/domain/asset-materializer';

function sessionWithEntries(count: number): ImportSession {
  const session: ImportSession = {
    id: 'bulk-session',
    sources: [
      {
        id: 'bulk-source',
        kind: 'dotenv',
        name: 'bulk.env',
        fileName: 'bulk.env',
        importedAt: '',
        warnings: [],
      },
    ],
    rootNodeIds: [],
    nodesById: {},
    fieldsById: {},
  };
  for (let row = 0; row < count; row += 1) {
    const entryId = `entry-${row}`;
    const fieldIds = ['alpha', 'beta'].map((name, column) => {
      const id = `${entryId}-${name}`;
      session.fieldsById[id] = {
        id,
        name,
        sourceId: 'bulk-source',
        parentNodeId: entryId,
        sourcePath: [entryId, name],
        metadata: {},
        value: new SensitiveValue(`value-${row}-${column}`),
      };
      return id;
    });
    session.rootNodeIds.push(entryId);
    session.nodesById[entryId] = {
      id: entryId,
      name: `Entry ${row}`,
      kind: 'entry',
      sourceId: 'bulk-source',
      parentNodeId: null,
      path: [],
      childNodeIds: [],
      fieldIds,
    };
  }
  return session;
}

describe('field-operation bulk preview', () => {
  it.each(['repeat', 'explicit'] as const)(
    'previews and commits 1000 entries in %s mode',
    (mode) => {
      const session = sessionWithEntries(1000);
      const { result } = renderHook(() => {
        const [workspace, setWorkspace] = useState(createEmptyWorkspace);
        return useImporterWorkspace(session, workspace, setWorkspace);
      });
      const entries = result.current.assets.map((asset) => ({
        sourceAssetId: asset.id,
        fieldIds: [session.nodesById[asset.sourceNodeId!]!.fieldIds[0]!],
      }));
      const request: FieldOperationRequest = {
        ...entries[0],
        action: 'create',
        ...(mode === 'explicit'
          ? { entries, fieldIds: entries.flatMap(({ fieldIds }) => fieldIds) }
          : { repeatCompatible: true }),
      };
      const started = performance.now();
      const preview = result.current.fieldOperations.preview(request);
      const previewMs = performance.now() - started;

      expect(preview.canConfirm).toBe(true);
      expect(preview.affectedEntryCount).toBe(1000);
      expect(preview.compatibleEntryCount).toBe(1000);
      expect(preview.skippedEntryCount).toBe(0);
      expect(preview.groups).toHaveLength(mode === 'explicit' ? 1000 : 1);

      let committed: ReturnType<typeof result.current.fieldOperations.commit>;
      const commitStarted = performance.now();
      act(() => {
        committed = result.current.fieldOperations.commit(preview);
      });
      const commitMs = performance.now() - commitStarted;
      expect(committed!.success).toBe(true);
      expect(committed!.createdAssetIds).toHaveLength(1000);
      expect(new Set(committed!.createdAssetIds).size).toBe(1000);
      const created = result.current.suggestions.filter((asset) =>
        committed!.createdAssetIds.includes(asset.id),
      );
      expect(created).toHaveLength(1000);
      for (const asset of created) {
        const sourceBinding = asset.fieldBindings['secret.text'];
        expect(sourceBinding?.kind).toBe('source');
        if (sourceBinding?.kind !== 'source') continue;
        const row = Number(asset.fromNodeId.replace('entry-', ''));
        expect(sourceBinding.sourceFieldId).toBe(`entry-${row}-alpha`);
        const materialised = materialiseAsset(asset, session);
        expect(materialised.errors).toEqual([]);
        expect(materialised.asset.secret.text).toBe(`value-${row}-0`);
        expect(materialised.asset.secret.text).not.toContain(`value-${row === 0 ? 1 : 0}-0`);
      }
      expect(session.fieldsById['entry-0-alpha']!.value.reveal()).toBe('value-0-0');
      expect(session.fieldsById['entry-999-alpha']!.value.reveal()).toBe('value-999-0');
      act(() => expect(result.current.fieldOperations.undo().success).toBe(true));
      expect(result.current.suggestions).toHaveLength(1000);
      console.log(JSON.stringify({ mode, bulkEntries: 1000, previewMs, commitMs }));
    },
    30_000,
  );

  it('moves fields in 1000 populated plan slots as one change and restores them in one undo', () => {
    const session = sessionWithEntries(1000);
    let initial = createEmptyWorkspace();
    Object.values(session.nodesById).forEach((node, index) => {
      const clientId = `plan-${Math.floor(index / 10)}`;
      const [token] = node.fieldIds;
      session.fieldsById[token].name = 'token';
      if (index % 10 === 0) initial = createPlan(initial, { clientId, name: clientId });
      initial = createAsset(initial, {
        planClientId: clientId,
        asset: {
          id: `${node.id}:API-KEY`,
          type: 'API-KEY',
          name: node.name,
          fieldBindings: { 'secret.apiKey': { kind: 'source', sourceFieldId: token } },
        },
      });
    });
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(initial);
      return { workspace, importer: useImporterWorkspace(session, workspace, setWorkspace) };
    });
    const entries = result.current.importer.assets.map((asset) => ({
      sourceAssetId: asset.id,
      targetAssetId: asset.id,
      fieldIds: [session.nodesById[asset.sourceNodeId!]!.fieldIds[1]!],
    }));
    const started = performance.now();
    const preview = result.current.importer.fieldOperations.preview({
      action: 'move',
      sourceAssetId: entries[0].sourceAssetId,
      fieldIds: entries.flatMap(({ fieldIds }) => fieldIds),
      entries,
    });
    const previewMs = performance.now() - started;
    expect(preview).toMatchObject({
      canConfirm: true,
      affectedEntryCount: 1000,
      movedFieldCount: 1000,
    });
    act(() => expect(result.current.importer.fieldOperations.commit(preview).success).toBe(true));
    expect(result.current.workspace.revision).toBe(initial.revision + 1);
    expect(
      Object.values(result.current.workspace.plansByClientId).every((plan) => !plan.assets.length),
    ).toBe(true);
    act(() => expect(result.current.importer.fieldOperations.undo().success).toBe(true));
    expect(result.current.workspace.plansByClientId).toBe(initial.plansByClientId);
    console.log(JSON.stringify({ populatedPlanSlots: 1000, previewMs }));
  }, 30_000);
});
