// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SensitiveValue, type ImportSession } from '@modules/import/domain/import-model';
import { useImporterWorkspace } from '@modules/importer-preview/ImporterFlow/application/importer-workspace';
import type { ReviewBatchResult } from '@modules/importer-preview/AssetReviewQueue/types';
import { createEmptyWorkspace, type WorkspaceState } from '@modules/plans/domain/workspace-model';
import { createAsset, createPlan, renamePlan } from '@modules/plans/domain/workspace-commands';
import { suggestedAssetToDraft } from '@modules/mapping/application/suggestion-engine';
import { materialiseAsset } from '@modules/plans/domain/asset-materializer';

function importSession() {
  const session: ImportSession = {
    id: 'session',
    sources: ['source', 'other'].map((id) => ({
      id,
      kind: 'dotenv',
      name: id,
      fileName: id,
      importedAt: '2026-01-01',
      warnings: [],
    })),
    rootNodeIds: [],
    nodesById: {},
    fieldsById: {},
  };
  function addNode(id: string, names: string[], sourceId = 'source') {
    session.rootNodeIds.push(id);
    session.nodesById[id] = {
      id,
      sourceId,
      parentNodeId: null,
      kind: 'entry',
      name: id,
      path: [],
      childNodeIds: [],
      fieldIds: names.map((_, index) => `${id}-${index}`),
    };
    names.forEach((name, index) => {
      const fieldId = `${id}-${index}`;
      session.fieldsById[fieldId] = {
        id: fieldId,
        sourceId,
        parentNodeId: id,
        sourcePath: [id, name],
        name,
        value: new SensitiveValue(`${id} value ${index}`),
        metadata: {},
      };
    });
  }
  return { session, addNode };
}

function setup(session: ImportSession) {
  const workspaceUpdates = vi.fn();
  const reviewChanges = vi.fn();
  const initial = createPlan(createEmptyWorkspace(), { clientId: 'plan', name: 'Original' });
  const { result } = renderHook(() => {
    const [workspace, setWorkspace] = useState(initial);
    const updateWorkspace = (update: Parameters<typeof setWorkspace>[0]) => {
      workspaceUpdates();
      setWorkspace(update);
    };
    return {
      workspace,
      updateWorkspace,
      importer: useImporterWorkspace(session, workspace, updateWorkspace, undefined, reviewChanges),
    };
  });
  const current = () => result.current.importer;
  const asset = (name: string) => current().assets.find((item) => item.name === name)!;
  const assign = (name: string) => {
    act(() => current().reviewAsset('accept', asset(name)));
    act(() =>
      current().assignAsset(
        current().unassigned.find((item) => item.name === name)!,
        current().plans[0]!,
      ),
    );
  };
  return { result, current, asset, assign, workspaceUpdates, reviewChanges };
}

describe('selected review batches', () => {
  it('accepts eligible current rows, deduplicates input IDs, and isolates global undo', () => {
    const { session, addNode } = importSession();
    for (const id of ['excluded', 'edited', 'global', 'invalid']) addNode(id, ['token', 'other']);
    const { current, asset, reviewChanges } = setup(session);
    act(() => current().reviewAsset('exclude', asset('excluded')));
    act(() => current().mapAssetField(asset('invalid'), 'secret.apiKey', undefined));
    reviewChanges.mockClear();
    let result!: ReviewBatchResult;
    const excluded = asset('excluded');
    const edited = asset('edited');
    const invalid = asset('invalid');
    act(() => {
      result = current().reviewAssets('accept', [
        { ...excluded, status: 'accepted' },
        edited,
        edited,
        { ...invalid, schemaFields: undefined },
        { ...excluded, id: 'stale' },
      ]);
    });
    expect(result).toEqual({
      changedIds: [excluded.id, edited.id],
      skippedIds: [invalid.id, 'stale'],
    });
    expect(reviewChanges).toHaveBeenCalledTimes(1);
    expect(asset('excluded').status).toBe('accepted');
    act(() => current().acceptAllEligible());
    act(() => current().reviewAsset('accept', asset('edited')));
    act(() => current().undoReviewBatch());
    expect(asset('excluded').status).toBe('excluded');
    expect(asset('edited').status).toBe('accepted');
    expect(asset('global').status).toBe('accepted');
    act(() => current().undoAcceptAll());
    expect(asset('global').status).not.toBe('accepted');
  });

  it('removes assigned drafts in one update and restores their positions with later plan metadata', () => {
    const { session, addNode } = importSession();
    for (const id of ['first', 'middle', 'last']) addNode(id, ['token', 'other']);
    const { result, current, asset, assign, workspaceUpdates } = setup(session);
    for (const id of ['first', 'middle', 'last']) assign(id);
    const original = result.current.workspace.plansByClientId.plan.assets;
    workspaceUpdates.mockClear();
    act(() => current().reviewAssets('exclude', [asset('last'), asset('first')]));
    expect(workspaceUpdates).toHaveBeenCalledTimes(1);
    expect(result.current.workspace.plansByClientId.plan.assets).toEqual([original[1]]);
    act(() =>
      result.current.updateWorkspace((workspace) =>
        renamePlan(workspace, { clientId: 'plan', name: 'Later name' }),
      ),
    );
    act(() => current().undoReviewBatch());
    expect(result.current.workspace.plansByClientId.plan).toMatchObject({
      name: 'Later name',
      assets: original,
    });
    expect(asset('last').status).toBe('accepted');
    expect(current().canUndoReviewBatch).toBe(false);
  });

  it('skips restoration when a later edit filled the original plan', () => {
    const { session, addNode } = importSession();
    addNode('assigned', ['token']);
    const { result, current, asset, assign } = setup(session);
    assign('assigned');
    act(() => current().reviewAssets('exclude', [asset('assigned')]));
    const assignedId = asset('assigned').id;
    act(() =>
      result.current.updateWorkspace((workspace): WorkspaceState => ({
        ...workspace,
        plansByClientId: {
          plan: {
            ...workspace.plansByClientId.plan,
            assets: Array.from({ length: 10 }, (_, index) => ({
              id: String(index),
              type: 'PLAIN-TEXT',
              name: String(index),
              fieldBindings: {},
            })),
          },
        },
      })),
    );
    let undo!: ReviewBatchResult;
    act(() => {
      undo = current().undoReviewBatch();
    });
    expect(undo).toEqual({ changedIds: [], skippedIds: [assignedId] });
    expect(asset('assigned').status).toBe('excluded');
    expect(result.current.workspace.plansByClientId.plan.assets).toHaveLength(10);
  });

  it('skips rows assigned after accepting the batch and still restores other rows', () => {
    const { session, addNode } = importSession();
    for (const id of ['newly assigned', 'other']) addNode(id, ['token', 'other']);
    const { result, current, asset } = setup(session);
    const assigned = asset('newly assigned');
    const unrelated = asset('other');
    act(() => current().reviewAssets('accept', [assigned, unrelated]));
    act(() =>
      current().assignAsset(
        current().unassigned.find((item) => item.id === assigned.id)!,
        current().plans[0]!,
      ),
    );

    let undo!: ReviewBatchResult;
    act(() => {
      undo = current().undoReviewBatch();
    });
    expect(undo).toEqual({ changedIds: [unrelated.id], skippedIds: [assigned.id] });
    expect(result.current.workspace.plansByClientId.plan.assets[0]?.id).toBe(assigned.id);
    expect(asset('newly assigned').status).toBe('accepted');
    expect(asset('other').status).toBe(unrelated.status);
  });

  it('drops only removed source entries and wipes their excluded draft literals', () => {
    const { session, addNode } = importSession();
    addNode('first', ['custom']);
    addNode('other source', ['token'], 'other');
    const { result, current, asset, assign } = setup(session);
    assign('first');
    act(() => current().editPlainText(asset('first'), 'updated text'));
    const binding =
      result.current.workspace.plansByClientId.plan.assets[0].fieldBindings['secret.text'];
    if (binding.kind !== 'literal') throw new Error('Expected a literal binding');
    act(() => current().reviewAssets('exclude', [asset('first'), asset('other source')]));
    act(() => current().removeSource('source'));
    expect(binding.value.isEmpty).toBe(true);
    expect(current().canUndoReviewBatch).toBe(true);
    act(() => current().undoReviewBatch());
    expect(result.current.workspace.plansByClientId.plan.assets).toEqual([]);
    expect(asset('other source').status).not.toBe('excluded');
  });

  it('does not restore a global decision over a later exclusion', () => {
    const { session, addNode } = importSession();
    for (const id of ['later', 'global']) addNode(id, ['token', 'other']);
    const { current, asset } = setup(session);
    act(() => current().acceptAllEligible());
    act(() => current().reviewAssets('exclude', [asset('later')]));
    act(() => current().undoAcceptAll());
    expect(asset('later').status).toBe('excluded');
    expect(asset('global').status).not.toBe('accepted');
    act(() => current().undoReviewBatch());
    expect(asset('later').status).toBe('accepted');
  });
});

describe('selected mapping batches', () => {
  it('uses each target’s own binding IDs while ignoring spoofed rows and manual unmapping', () => {
    const { session, addNode } = importSession();
    for (const id of ['template', 'target', 'manual', 'converted', 'excluded'])
      addNode(id, ['token', 'other']);
    addNode('different source', ['token', 'other'], 'other');
    addNode('different shape', ['token', 'different']);
    addNode('duplicate labels', ['token', 'other', 'other']);
    const { result, current, asset, assign, workspaceUpdates } = setup(session);
    assign('target');
    act(() => current().mapAssetField(asset('template'), 'secret.apiKey', 'template-1'));
    act(() => current().mapAssetField(asset('manual'), 'secret.apiKey', undefined));
    act(() => current().reviewAsset('alternate:USER-PSWD', asset('converted')));
    act(() => current().reviewAsset('exclude', asset('excluded')));
    const skipped = [
      'manual',
      'different source',
      'different shape',
      'converted',
      'duplicate labels',
      'excluded',
    ].map(asset);
    const target = asset('target');
    const template = asset('template');
    workspaceUpdates.mockClear();
    let mapping!: ReviewBatchResult;
    act(() => {
      mapping = current().applyMappings({ ...template, schemaFields: [] }, [
        { ...target, sourceId: 'spoofed', schemaFields: [] },
        ...skipped,
      ]);
    });
    expect(mapping).toEqual({
      changedIds: [target.id],
      skippedIds: skipped.map((item) => item.id),
    });
    expect(workspaceUpdates).toHaveBeenCalledTimes(1);
    expect(asset('target').status).toBe('needs-review');
    expect(
      asset('manual').schemaFields?.find((field) => field.key === 'secret.apiKey'),
    ).toMatchObject({
      manuallyMapped: true,
      sourceFieldId: undefined,
    });
    let draft = result.current.workspace.plansByClientId.plan.assets[0]!;
    expect(draft.fieldBindings['secret.apiKey']).toEqual({
      kind: 'source',
      sourceFieldId: 'target-1',
    });
    expect(materialiseAsset(draft, session).asset.secret.apiKey).toBe('target value 1');

    act(() => current().undoReviewBatch());
    draft = result.current.workspace.plansByClientId.plan.assets[0]!;
    expect(draft.fieldBindings['secret.apiKey']).toEqual({
      kind: 'source',
      sourceFieldId: 'target-0',
    });
    expect(asset('target').status).toBe('accepted');
    expect(session.fieldsById['template-1']!.value.reveal()).toBe('template value 1');
    expect(session.fieldsById['target-1']!.value.reveal()).toBe('target value 1');
  });

  it('keeps staged bindings consistent if a target gets an assignment after applying', () => {
    const { session, addNode } = importSession();
    for (const id of ['template', 'target']) addNode(id, ['token', 'other']);
    const { result, current, asset } = setup(session);
    act(() => current().mapAssetField(asset('template'), 'secret.apiKey', 'template-1'));
    act(() => current().applyMappings(asset('template'), [asset('target')]));
    const target = asset('target');
    const suggestion = current().suggestions.find((item) => item.fromNodeId === 'target')!;
    const draft = suggestedAssetToDraft(suggestion, target.id);
    act(() =>
      result.current.updateWorkspace((workspace) =>
        createAsset(workspace, {
          planClientId: 'plan',
          asset: draft,
        }),
      ),
    );

    let undo!: ReviewBatchResult;
    act(() => {
      undo = current().undoReviewBatch();
    });
    expect(undo).toEqual({ changedIds: [], skippedIds: [target.id] });
    expect(result.current.workspace.plansByClientId.plan.assets[0]).toBe(draft);
    expect(
      asset('target').schemaFields?.find((field) => field.key === 'secret.apiKey')?.sourceFieldId,
    ).toBe('target-1');
  });

  it('leaves an invalid copied mapping in needs-review with its canonical field error', () => {
    const { session, addNode } = importSession();
    for (const id of ['template', 'target']) addNode(id, ['username', 'password', 'extra']);
    session.fieldsById['template-2'].value = new SensitiveValue('valid@example.com');
    const { current, asset } = setup(session);
    act(() => current().mapAssetField(asset('template'), 'secret.email', 'template-2'));
    act(() => current().applyMappings(asset('template'), [asset('target')]));
    expect(
      asset('target').schemaFields?.find((field) => field.key === 'secret.email'),
    ).toMatchObject({
      sourceFieldId: 'target-2',
      validationError: 'Invalid email',
    });
    expect(asset('target').status).toBe('needs-review');
    let review!: ReviewBatchResult;
    act(() => {
      review = current().reviewAssets('accept', [asset('target')]);
    });
    expect(review.changedIds).toEqual([]);
  });

  it('undoes untouched fields while preserving a later manual mapping and review decision', () => {
    const { session, addNode } = importSession();
    for (const id of ['template', 'target']) addNode(id, ['token', 'other', 'alternate']);
    const { current, asset } = setup(session);
    act(() => current().mapAssetField(asset('template'), 'secret.apiKey', 'template-1'));
    act(() => current().mapAssetField(asset('template'), 'secret.app', 'template-2'));
    act(() => current().applyMappings(asset('template'), [asset('target')]));
    expect(
      asset('target').schemaFields?.find((field) => field.key === 'secret.app')?.sourceFieldId,
    ).toBe('target-2');
    act(() => current().mapAssetField(asset('target'), 'secret.apiKey', 'target-2'));
    act(() => current().undoReviewBatch());
    expect(
      asset('target').schemaFields?.find((field) => field.key === 'secret.apiKey')?.sourceFieldId,
    ).toBe('target-2');
    expect(
      asset('target').schemaFields?.find((field) => field.key === 'secret.app')?.sourceFieldId,
    ).toBeUndefined();
    expect(asset('target').status).toBe('needs-review');
  });
});
