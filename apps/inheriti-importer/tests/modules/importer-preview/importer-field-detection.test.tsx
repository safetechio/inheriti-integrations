// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { SensitiveValue, type ImportSession } from '@modules/import/domain/import-model';
import type { FieldOperationRequest } from '@modules/importer-preview/AssetReviewQueue/field-operations';
import { useImporterWorkspace } from '@modules/importer-preview/ImporterFlow/application/importer-workspace';
import { parseVaultFile } from '@modules/import/infrastructure/parsers';
import { importSessionFromVaultState } from '@modules/import/infrastructure/stores/vault-session-adapter';
import {
  entriesFromParse,
  initialVaultState,
} from '@modules/import/infrastructure/stores/vault-store';
import { createEmptyWorkspace } from '@modules/plans/domain/workspace-model';
import { createPlan } from '@modules/plans/domain/workspace-commands';

function createSession(rows: string[][]): ImportSession {
  const session: ImportSession = {
    id: 'detection-session',
    sources: [
      {
        id: 'fixture',
        kind: 'onepassword',
        name: 'Fixture',
        fileName: 'Fixture',
        importedAt: '',
        warnings: [],
      },
    ],
    rootNodeIds: [],
    nodesById: {},
    fieldsById: {},
  };
  rows.forEach((names, row) => {
    const entryId = `entry-${row}`;
    const fieldIds = names.map((name, column) => {
      const id = `${entryId}-field-${column}`;
      session.fieldsById[id] = {
        id,
        name,
        sourceId: 'fixture',
        parentNodeId: entryId,
        sourcePath: [entryId, name],
        metadata: {},
        value: new SensitiveValue(`fixture-${row}-${column}`),
      };
      return id;
    });
    session.rootNodeIds.push(entryId);
    session.nodesById[entryId] = {
      id: entryId,
      name: `Northline credential ${row + 1}`,
      kind: 'entry',
      sourceId: 'fixture',
      parentNodeId: null,
      path: ['Northline', 'Operations'],
      childNodeIds: [],
      fieldIds,
    };
  });
  return session;
}

function mount(session: ImportSession) {
  return renderHook(
    ({ importSession }) => {
      const [workspace, setWorkspace] = useState(() =>
        createPlan(createEmptyWorkspace(), { clientId: 'plan', name: 'Northline plan' }),
      );
      return { workspace, importer: useImporterWorkspace(importSession, workspace, setWorkspace) };
    },
    { initialProps: { importSession: session } },
  );
}

describe('field-operation detection', () => {
  it('detects only selected pending fields, adds fallback Plain Text, preserves existing mappings, and undoes atomically', () => {
    const session = createSession([['username', 'password', 'api_key', 'region']]);
    const { result } = mount(session);
    const before = result.current.importer.assets
      .filter((asset) => asset.type !== 'PLAIN-TEXT')
      .map(({ id, type, mapped, unmappedSourceFieldIds }) => ({
        id,
        type,
        mapped,
        unmappedSourceFieldIds,
      }));
    const beforeBindings = before.map(({ id, type, mapped }) => ({ id, type, mapped }));
    const region = session.nodesById['entry-0'].fieldIds[3]!;
    const source = result.current.importer.assets[0]!;
    const request: FieldOperationRequest = {
      sourceAssetId: source.id,
      action: 'detect',
      fieldIds: [region],
    };
    const preview = result.current.importer.fieldOperations.preview(request);

    expect(preview).toMatchObject({ canConfirm: true, affectedEntryCount: 1, movedFieldCount: 1 });
    expect(preview.groups).toHaveLength(1);
    expect(preview.groups[0]).toMatchObject({
      type: 'PLAIN-TEXT',
      fieldBindings: { 'secret.text': region },
    });
    expect(preview.groups[0]?.fieldBindings).not.toHaveProperty('secret.username');
    expect(preview.groups[0]?.fieldBindings).not.toHaveProperty('secret.password');

    let committed!: ReturnType<typeof result.current.importer.fieldOperations.commit>;
    act(() => {
      committed = result.current.importer.fieldOperations.commit(preview);
    });
    expect(committed.success).toBe(true);
    expect(
      result.current.importer.suggestions.find(
        (asset) => asset.id === committed.createdAssetIds[0],
      ),
    ).toMatchObject({
      type: 'PLAIN-TEXT',
      fieldBindings: { 'secret.text': { kind: 'source', sourceFieldId: region } },
    });
    expect(
      result.current.importer.assets
        .filter((asset) => asset.type !== 'PLAIN-TEXT')
        .map(({ id, type, mapped }) => ({ id, type, mapped })),
    ).toEqual(beforeBindings);

    act(() => expect(result.current.importer.fieldOperations.undo().success).toBe(true));
    expect(
      result.current.importer.suggestions.filter(
        (asset) => asset.id === committed.createdAssetIds[0],
      ),
    ).toHaveLength(0);
    expect(
      result.current.importer.assets
        .filter((asset) => asset.type !== 'PLAIN-TEXT')
        .map(({ id, type, mapped, unmappedSourceFieldIds }) => ({
          id,
          type,
          mapped,
          unmappedSourceFieldIds,
        })),
    ).toEqual(before);
  });

  it('detects an explicit multi-entry selection without widening to compatible entries', () => {
    const session = createSession([
      ['username', 'password', 'region'],
      ['username', 'password', 'region'],
    ]);
    const { result } = mount(session);
    const [first, second] = [
      session.nodesById['entry-0'].fieldIds[2]!,
      session.nodesById['entry-1'].fieldIds[2]!,
    ];
    const source = result.current.importer.assets[0]!;
    const entries = [
      { sourceAssetId: source.id, fieldIds: [first] },
      {
        sourceAssetId: result.current.importer.assets.find(
          (asset) => asset.sourceNodeId === 'entry-1',
        )!.id,
        fieldIds: [second],
      },
    ];
    const preview = result.current.importer.fieldOperations.preview({
      sourceAssetId: source.id,
      action: 'detect',
      fieldIds: [first, second],
      entries,
    });
    expect(preview).toMatchObject({ canConfirm: true, affectedEntryCount: 2, movedFieldCount: 2 });
    expect(preview.groups).toHaveLength(2);
    expect(preview.groups.every((group) => group.type === 'PLAIN-TEXT')).toBe(true);
    expect(preview.groups.flatMap((group) => group.fieldBindings['secret.text'])).toEqual([
      first,
      second,
    ]);
  });

  it('keeps Vault password history out of detection and available for explicit protection', async () => {
    const file = {
      data: new TextEncoder().encode(
        JSON.stringify({
          data: {
            data: {
              passwordHistory: [{ username: 'old-user', password: 'old-secret' }],
              database: {
                current: { username: 'current-user', password: 'current-password' },
                audit: { history: [{ username: 'archived-user', password: 'archived-secret' }] },
                password_history: [{ username: 'prior-user', password: 'prior-secret' }],
              },
            },
          },
        }),
      ).buffer,
      name: 'vault.json',
    };
    const parsed = await parseVaultFile(file.data, file.name);
    const [entry] = entriesFromParse(parsed, 'fixture');
    const session = importSessionFromVaultState({
      ...initialVaultState,
      vaults: [
        { id: 'fixture', kind: 'vault', name: 'Vault', fileName: file.name, importedAt: '' },
      ],
      entries: [{ current: entry, original: entry }],
    });
    const history = Object.values(session.fieldsById)
      .filter((field) => field.metadata.sourceAutoMapping === 'manual-only')
      .map((field) => field.id);
    expect(history).toHaveLength(5);
    const { result } = mount(session);
    const [source] = result.current.importer.assets;
    expect(result.current.importer.assets).toHaveLength(1);
    expect(source.type).toBe('USER-PSWD');
    const request = { sourceAssetId: source.id, fieldIds: history };
    expect(
      result.current.importer.fieldOperations.preview({ ...request, action: 'detect' }),
    ).toMatchObject({ canConfirm: false, groups: [] });
    for (const entries of [undefined, [request]]) {
      const preview = result.current.importer.fieldOperations.preview({
        ...request,
        action: 'create',
        entries,
      });
      expect(preview).toMatchObject({ canConfirm: true, movedFieldCount: 5 });
      expect(preview.groups).toMatchObject([
        { type: 'PLAIN-TEXT', fieldBindings: { 'secret.text': history } },
      ]);
    }
  });

  it('skips a matching manual-only field when repeating and allows explicit creation', () => {
    const fields = ['username', 'password', 'region'];
    const session = createSession([fields, fields]);
    const fieldId = session.nodesById['entry-0'].fieldIds[2]!;
    const manualId = session.nodesById['entry-1'].fieldIds[2]!;
    session.fieldsById[manualId].metadata.sourceAutoMapping = 'manual-only';
    const { result } = mount(session);
    const importer = result.current.importer;
    const first = importer.assets.find(({ sourceNodeId }) => sourceNodeId === 'entry-0')!;
    const second = importer.assets.find(({ sourceNodeId }) => sourceNodeId === 'entry-1')!;
    const repeat = importer.fieldOperations.preview({
      action: 'create',
      sourceAssetId: first.id,
      fieldIds: [fieldId],
      repeatCompatible: true,
    });
    expect(repeat).toMatchObject({
      canConfirm: true,
      affectedEntryCount: 1,
      skippedEntryCount: 1,
      movedFieldCount: 1,
    });

    const entry = { sourceAssetId: second.id, fieldIds: [manualId] };
    const explicit = importer.fieldOperations.preview({
      ...entry,
      action: 'create',
      entries: [entry],
    });
    expect(explicit.canConfirm).toBe(true);
    expect(explicit.groups).toMatchObject([
      { type: 'PLAIN-TEXT', fieldBindings: { 'secret.text': [manualId] } },
    ]);
  });

  it('rejects repeat-compatible detection and leaves the workspace untouched', () => {
    const session = createSession([
      ['username', 'password', 'region'],
      ['username', 'password', 'region'],
    ]);
    const { result } = mount(session);
    const source = result.current.importer.assets[0]!;
    const before = result.current.importer.assets.map(({ id, type, fieldBindings }) => ({
      id,
      type,
      fieldBindings,
    }));
    const preview = result.current.importer.fieldOperations.preview({
      sourceAssetId: source.id,
      action: 'detect',
      fieldIds: [session.nodesById['entry-0'].fieldIds[2]!],
      repeatCompatible: true,
    });
    expect(preview.canConfirm).toBe(false);
    expect(preview.errors.join(' ')).toMatch(/selected unassigned/i);
    expect(
      result.current.importer.assets.map(({ id, type, fieldBindings }) => ({
        id,
        type,
        fieldBindings,
      })),
    ).toEqual(before);
    expect(result.current.importer.fieldOperations.canUndo).toBe(false);
  });
});
