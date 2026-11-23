// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { SensitiveValue, type ImportSession } from '@modules/import/domain/import-model';
import type { FieldOperationRequest } from '@modules/importer-preview/AssetReviewQueue/field-operations';
import { useImporterWorkspace } from '@modules/importer-preview/ImporterFlow/application/importer-workspace';
import { createPlan } from '@modules/plans/domain/workspace-commands';
import { createEmptyWorkspace } from '@modules/plans/domain/workspace-model';
import { getPlanAssetFormFields } from '@modules/plans/domain/asset-metadata';
import { materialiseAsset } from '@modules/plans/domain/asset-materializer';

function createSession(entries: string[][], kind = 'dotenv'): ImportSession {
  const session: ImportSession = {
    id: 'session',
    sources: [{ id: 'file', kind, name: 'File', fileName: 'File', importedAt: '', warnings: [] }],
    rootNodeIds: [],
    nodesById: {},
    fieldsById: {},
  };
  entries.forEach((names, row) => {
    const id = `entry-${row}`;
    const fieldIds = names.map((name, col) => {
      const fieldId = `${id}-field-${col}`;
      session.fieldsById[fieldId] = {
        id: fieldId,
        name,
        sourceId: 'file',
        parentNodeId: id,
        sourcePath: [],
        metadata: {},
        value: new SensitiveValue(`test-${row}-${col}`),
      };
      return fieldId;
    });
    session.rootNodeIds.push(id);
    session.nodesById[id] = {
      id,
      name: `Entry ${row}`,
      kind: 'entry',
      sourceId: 'file',
      parentNodeId: null,
      path: [],
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
        createPlan(createEmptyWorkspace(), {
          clientId: 'plan',
          name: 'Plan',
        }),
      );
      return {
        workspace,
        importer: useImporterWorkspace(importSession, workspace, setWorkspace),
      };
    },
    { initialProps: { importSession: session } },
  );
}

describe('source field operations', () => {
  it.each(['DOCUMENT', 'IMAGE', 'VIDEO'])('rejects file asset creation for %s', (type) => {
    const session = createSession([['alpha']]);
    const { result } = mount(session);
    const { importer } = result.current;
    const [original] = importer.assets;
    const fieldIds = session.nodesById['entry-0'].fieldIds;
    const request = { sourceAssetId: original.id, action: 'create' as const, fieldIds };
    const [group] = importer.fieldOperations.preview(request).groups;
    const target = getPlanAssetFormFields(type).find((field) =>
      field.source.startsWith('secret.'),
    )!;
    const preview = importer.fieldOperations.preview({
      ...request,
      groups: [{ ...group, type, fieldBindings: { [target.source]: fieldIds[0] } }],
    });

    expect(importer.fieldOperations.assetTypes).not.toContain(type);
    expect(preview.canConfirm).toBe(false);
    act(() => expect(importer.fieldOperations.commit(preview).success).toBe(false));
    expect(result.current.importer.assets).toEqual([original]);
  });

  it('numbers derived names across existing assets and preview groups', () => {
    const session = createSession([['alpha', 'beta', 'gamma', 'delta']]);
    const { result } = mount(session);
    const original = result.current.importer.assets[0];
    act(() => result.current.importer.renameAsset(original, 'Renamed entry'));
    const [alpha, beta, gamma, delta] = session.nodesById['entry-0'].fieldIds;
    const first = result.current.importer.fieldOperations.preview({
      sourceAssetId: original.id,
      action: 'create',
      fieldIds: [alpha, beta],
    });
    expect(first.groups[0].name).toBe('Renamed entry — Additional 1');
    act(() => expect(result.current.importer.fieldOperations.commit(first).success).toBe(true));

    const second = result.current.importer.fieldOperations.preview({
      sourceAssetId: first.groups[0].id,
      action: 'suggest',
      fieldIds: [alpha, beta],
    });
    expect(second.groups[0].name).toBe('Renamed entry — Additional 2');
    const third = result.current.importer.fieldOperations.preview({
      sourceAssetId: original.id,
      action: 'suggest',
      fieldIds: [gamma, delta],
    });
    const [group] = third.groups;
    const edited = result.current.importer.fieldOperations.preview({
      ...third.request,
      groups: [
        { ...group, fieldBindings: { 'secret.text': gamma } },
        {
          ...group,
          id: `${group.id}-extra-1`,
          name: 'RENAMED ENTRY — ADDITIONAL 2',
          automaticName: false,
          fieldBindings: { 'secret.text': delta },
        },
      ],
    });
    expect(edited.canConfirm).toBe(true);
    expect(edited.groups.map(({ name }) => name)).toEqual([
      'Renamed entry — Additional 3',
      'RENAMED ENTRY — ADDITIONAL 2',
    ]);
  });

  it('keeps the numbered suffix when the source name is long', () => {
    const session = createSession([['alpha']]);
    session.nodesById['entry-0'].name = '😀'.repeat(90);
    const { result } = mount(session);
    const preview = result.current.importer.fieldOperations.preview({
      sourceAssetId: result.current.importer.assets[0].id,
      action: 'create',
      fieldIds: session.nodesById['entry-0'].fieldIds,
    });
    expect(preview.groups[0].name).toBe('😀'.repeat(72) + ' — Additional 1');
    expect(preview.groups[0].name.length).toBeLessThanOrEqual(160);
  });

  it.each([false, true])(
    'seeds typed assets and Plain Text for one entry (explicit: %s)',
    (explicit) => {
      const session = createSession([['username', 'password', 'token', 'other']]);
      const { result } = mount(session);
      const { importer, workspace } = result.current;
      const [source] = importer.assets;
      const [, , token, other] = session.nodesById['entry-0'].fieldIds;
      const entry = { sourceAssetId: source.id, fieldIds: [token, other] };
      const request = explicit ? { ...entry, entries: [entry] } : entry;
      const preview = importer.fieldOperations.preview({ ...request, action: 'create' });
      expect(preview.canConfirm).toBe(true);
      expect(preview.groups).toMatchObject([
        { type: 'API-KEY', fieldBindings: { 'secret.apiKey': token } },
        { type: 'PLAIN-TEXT', fieldBindings: { 'secret.text': [other] } },
      ]);
      expect(
        importer.fieldOperations.preview({ ...request, action: 'create', type: 'PLAIN-TEXT' })
          .groups,
      ).toMatchObject([{ type: 'PLAIN-TEXT', fieldBindings: { 'secret.text': [token, other] } }]);

      const several = importer.fieldOperations.preview({ ...request, action: 'suggest' });
      expect(several.canConfirm).toBe(false);
      expect(several.groups).toEqual([
        expect.objectContaining({ type: 'PLAIN-TEXT', fieldBindings: {} }),
      ]);
      expect(result.current.importer.suggestions).toBe(importer.suggestions);
      expect(result.current.workspace).toBe(workspace);

      for (const groups of [[], several.groups]) {
        const empty = importer.fieldOperations.preview({ ...several.request, groups });
        expect(empty.canConfirm).toBe(false);
        act(() => expect(importer.fieldOperations.commit(empty).success).toBe(false));
      }
      expect(result.current.importer.suggestions).toBe(importer.suggestions);
      expect(result.current.workspace).toBe(workspace);
      expect(result.current.importer.assets[0].unmappedSourceFieldIds).toEqual([token, other]);
      expect(result.current.importer.fieldOperations.canUndo).toBe(false);
    },
  );

  it('materializes two independently named assets of the same type and retains an unmapped selection', () => {
    const session = createSession([['alpha', 'beta', 'gamma']]);
    const { result } = mount(session);
    const prior = result.current.importer;
    const [a, b, c] = session.nodesById['entry-0'].fieldIds;
    const request: FieldOperationRequest = {
      sourceAssetId: prior.assets[0].id,
      action: 'suggest',
      fieldIds: [a, b, c],
    };
    const initial = prior.fieldOperations.preview(request);
    const first = {
      ...initial.groups[0],
      type: 'API-KEY',
      name: 'First',
      automaticName: false,
      fieldBindings: { 'secret.apiKey': a },
    };
    const second = { ...first, id: `${first.id}-second`, name: 'Second' };
    for (const assignSameField of [false, true]) {
      const invalid = prior.fieldOperations.preview({
        ...initial.request,
        groups: [first, { ...second, fieldBindings: assignSameField ? first.fieldBindings : {} }],
      });
      expect(invalid.canConfirm).toBe(false);
      act(() => expect(prior.fieldOperations.commit(invalid).success).toBe(false));
      expect(result.current.importer.suggestions).toBe(prior.suggestions);
    }
    const preview = prior.fieldOperations.preview({
      ...initial.request,
      groups: [first, { ...second, fieldBindings: { 'secret.apiKey': b } }],
    });
    expect(result.current.importer.suggestions).toBe(prior.suggestions);
    expect(preview).toMatchObject({ canConfirm: true, movedFieldCount: 2, remainingFieldCount: 1 });
    act(() => expect(result.current.importer.fieldOperations.commit(preview).success).toBe(true));
    expect(
      result.current.importer.assets.find((asset) => asset.id === request.sourceAssetId)?.mapped,
    ).toEqual(['gamma']);
    act(() => result.current.importer.acceptAllEligible());
    const typed = result.current.importer.unassigned.filter((asset) => asset.type === 'API-KEY');
    expect(typed).toHaveLength(2);
    act(() => result.current.importer.assignAssets(typed, result.current.importer.plans[0]));
    const drafts = result.current.workspace.plansByClientId.plan.assets;
    expect(
      drafts.map((draft) => [draft.name, materialiseAsset(draft, session).asset.secret]),
    ).toEqual([
      ['First', { apiKey: 'test-0-0' }],
      ['Second', { apiKey: 'test-0-1' }],
    ]);
  });

  it('releases an incompatible manual binding when an assigned generated asset changes type', () => {
    const session = createSession([['token', 'alpha', 'beta']]);
    const { result } = mount(session);
    const current = () => result.current.importer;
    const [, alpha, beta] = session.nodesById['entry-0'].fieldIds;
    const initial = current().fieldOperations.preview({
      sourceAssetId: current().assets[0].id,
      action: 'suggest',
      fieldIds: [alpha, beta],
    });
    const group = initial.groups[0];
    const preview = current().fieldOperations.preview({
      ...initial.request,
      groups: [{ ...group, type: 'API-KEY', fieldBindings: { 'secret.apiKey': alpha } }],
    });
    act(() => expect(current().fieldOperations.commit(preview).success).toBe(true));
    const generated = () => current().assets.find(({ id }) => id === group.id)!;
    const suggestion = () => current().suggestions.find(({ id }) => id === group.id)!;
    const draft = () =>
      result.current.workspace.plansByClientId.plan.assets.find(({ id }) => id === group.id)!;

    act(() => current().mapAssetField(generated(), 'secret.apiKey', beta));
    act(() => current().reviewAsset('accept', generated()));
    act(() => current().assignAsset(current().unassigned[0], current().plans[0]));
    expect(draft().fieldBindings['secret.apiKey']).toEqual({
      kind: 'source',
      sourceFieldId: beta,
    });

    act(() => current().reviewAsset('alternate:USER-PSWD', generated()));
    expect(generated().type).toBe('USER-PSWD');
    expect(suggestion().fieldBindings).not.toHaveProperty(['secret.apiKey']);
    expect(draft().fieldBindings).not.toHaveProperty(['secret.apiKey']);
    expect(
      generated().schemaFields?.find(({ key }) => key === 'secret.password')?.candidates,
    ).toContainEqual(expect.objectContaining({ id: beta }));

    act(() => current().mapAssetField(generated(), 'secret.password', alpha));
    act(() => current().reviewAsset('accept', generated()));
    expect(generated().status).toBe('accepted');
    expect(current().coverage.fields.find(({ id }) => id === beta)).toMatchObject({
      status: 'pending',
      destinations: [],
    });
    const materialised = materialiseAsset(draft(), session);
    expect(materialised.errors).toEqual([]);
    expect(materialised.asset.secret).toEqual({ password: 'test-0-1' });
  });

  it('rejects foreign fields, public notes and stale previews', () => {
    const session = createSession(
      [
        ['alpha', 'notes'],
        ['alpha', 'other'],
      ],
      'onepassword',
    );
    const { result, rerender } = mount(session);
    const source = result.current.importer.assets[0];
    const [a, notes] = session.nodesById['entry-0'].fieldIds;
    const [foreign] = session.nodesById['entry-1'].fieldIds;
    const request: FieldOperationRequest = {
      sourceAssetId: source.id,
      action: 'plain-text',
      fieldIds: [a, notes],
    };
    expect(result.current.importer.fieldOperations.preview(request).canConfirm).toBe(false);
    act(() => result.current.importer.setAssetNoteDestination(source, 'protected'));
    const preview = result.current.importer.fieldOperations.preview(request);
    const group = preview.groups[0];
    expect(
      result.current.importer.fieldOperations.preview({ ...request, fieldIds: [foreign] })
        .canConfirm,
    ).toBe(false);
    expect(
      result.current.importer.fieldOperations.preview({
        ...preview.request,
        groups: [{ ...group, fieldBindings: { 'meta.notes': notes } }],
      }).canConfirm,
    ).toBe(false);
    const current = result.current.importer.fieldOperations.preview(request);
    expect(current.canConfirm).toBe(true);
    act(() => result.current.importer.reviewAsset('accept', source));
    expect(result.current.importer.fieldOperations.commit(current).success).toBe(false);
    const previousControls = result.current.importer.fieldOperations;
    const removed = previousControls.preview(request);
    rerender({ importSession: createSession([]) });
    expect(previousControls.commit(removed).success).toBe(false);
  });

  it('repeats using per-entry IDs, skips ambiguous matches and atomically restores assigned originals', () => {
    const session = createSession([
      ['alpha', 'beta'],
      ['alpha', 'beta'],
      ['alpha', 'alpha'],
    ]);
    const { result } = mount(session);
    act(() => result.current.importer.acceptAllEligible());
    const source = result.current.importer.assets[0];
    act(() =>
      result.current.importer.assignAsset(
        result.current.importer.unassigned.find((asset) => asset.id === source.id)!,
        result.current.importer.plans[0],
      ),
    );
    const [a] = session.nodesById['entry-0'].fieldIds;
    const preview = result.current.importer.fieldOperations.preview({
      sourceAssetId: source.id,
      action: 'plain-text',
      fieldIds: [a],
      repeatCompatible: true,
    });
    expect(preview).toMatchObject({
      canConfirm: true,
      affectedEntryCount: 2,
      skippedEntryCount: 1,
      movedFieldCount: 2,
    });
    const manual = result.current.importer.fieldOperations.preview({
      ...preview.request,
      groups: [{ ...preview.groups[0], name: 'Custom name', automaticName: false }],
    });
    act(() => expect(result.current.importer.fieldOperations.commit(manual).success).toBe(true));
    expect(
      result.current.importer.assets.filter(({ name }) => name === 'Custom name'),
    ).toHaveLength(2);
    act(() => expect(result.current.importer.fieldOperations.undo().success).toBe(true));
    const automatic = result.current.importer.fieldOperations.preview(preview.request);
    act(() => expect(result.current.importer.fieldOperations.commit(automatic).success).toBe(true));
    expect(result.current.workspace.plansByClientId.plan.assets).toHaveLength(0);
    const created = result.current.importer.suggestions.filter((asset) => asset.id);
    expect(created.map(({ name }) => name)).toEqual([
      'Entry 0 — Additional 1',
      'Entry 1 — Additional 1',
    ]);
    expect(created.map((asset) => asset.fieldBindings['secret.text'])).toEqual([
      { kind: 'source', sourceFieldId: 'entry-0-field-0' },
      { kind: 'source', sourceFieldId: 'entry-1-field-0' },
    ]);
    expect(result.current.importer.fieldOperations.canUndo).toBe(true);
    act(() => expect(result.current.importer.fieldOperations.undo().success).toBe(true));
    expect(result.current.workspace.plansByClientId.plan.assets[0]?.id).toBe(source.id);
    expect(result.current.importer.assets.every((asset) => asset.status === 'accepted')).toBe(true);
    expect(result.current.importer.suggestions.filter((asset) => asset.id)).toHaveLength(0);
  });

  it('blocks text splitting for edited values and preserves the original when undoing a whole copy', () => {
    const session = createSession([['alpha', 'beta']]);
    const { result } = mount(session);
    const source = result.current.importer.assets[0];
    act(() => result.current.importer.editPlainText(source, 'whole edited value'));
    const [a] = session.nodesById['entry-0'].fieldIds;
    const request: FieldOperationRequest = {
      sourceAssetId: source.id,
      action: 'plain-text',
      fieldIds: [a],
    };
    expect(result.current.importer.fieldOperations.preview(request).canConfirm).toBe(false);
    const preview = result.current.importer.fieldOperations.preview({
      ...request,
      action: 'duplicate-text',
      fieldIds: [],
    });
    expect(preview.canConfirm).toBe(true);
    expect(preview.assets[0].plainTextValue).toBeUndefined();
    preview.request.action = 'create';
    act(() => expect(result.current.importer.fieldOperations.commit(preview).success).toBe(true));
    const copy = result.current.importer.assets.find(
      (asset) => asset.id === preview.groups[0].id,
    )?.plainTextValue;
    expect(copy?.reveal()).toBe('whole edited value');
    act(() => expect(result.current.importer.fieldOperations.undo().success).toBe(true));
    expect(copy?.isEmpty).toBe(true);
    expect(
      result.current.importer.assets
        .find((asset) => asset.id === source.id)
        ?.plainTextValue?.reveal(),
    ).toBe('whole edited value');
  });

  it.each([false, true])(
    'does not repeat explicitly excluded source fields (active sibling: %s)',
    (activeSibling) => {
      const session = createSession([['alpha'], activeSibling ? ['token', 'alpha'] : ['alpha']]);
      const { result } = mount(session);
      const [first] = result.current.importer.assets;
      const [from] = session.nodesById['entry-0'].fieldIds;
      const excludedFieldId = session.nodesById['entry-1'].fieldIds.at(-1)!;
      if (activeSibling) act(() => result.current.importer.preserveFields([excludedFieldId]));
      const excludedAsset = result.current.importer.assets.find(
        (asset) => asset.sourceNodeId === 'entry-1' && asset.type === 'PLAIN-TEXT',
      )!;
      act(() => result.current.importer.reviewAsset('exclude', excludedAsset));
      const invalid = result.current.importer.fieldOperations.preview({
        sourceAssetId: excludedAsset.id,
        action: 'plain-text',
        fieldIds: [excludedFieldId],
      });
      expect(invalid.canConfirm).toBe(false);
      const preview = result.current.importer.fieldOperations.preview({
        sourceAssetId: first.id,
        action: 'plain-text',
        fieldIds: [from],
        repeatCompatible: true,
      });
      expect(preview).toMatchObject({
        canConfirm: true,
        affectedEntryCount: 1,
        compatibleEntryCount: 1,
        skippedEntryCount: 1,
      });
      act(() => expect(result.current.importer.fieldOperations.commit(preview).success).toBe(true));
      act(() => result.current.importer.acceptAllEligible());
      expect(
        result.current.importer.assets.find((asset) => asset.id === excludedAsset.id)?.status,
      ).toBe('excluded');
      expect(
        result.current.importer.coverage.fields.find(({ id }) => id === excludedFieldId),
      ).toMatchObject({ status: 'excluded', destinations: [] });
      expect(result.current.importer.coverage.ready).toBe(true);
    },
  );

  it('counts only unresolved fields across typed siblings and explicit text proposals', () => {
    const session = createSession([['username', 'password', 'first_api_key', 'region']]);
    const { result } = mount(session);
    const [login, key] = result.current.importer.assets;
    const region = session.nodesById['entry-0'].fieldIds[3];
    expect(result.current.importer.assets.map(({ type }) => type).sort()).toEqual([
      'API-KEY',
      'USER-PSWD',
    ]);
    expect(login.unmappedSourceFieldIds).toEqual([region]);
    expect(key.unmappedSourceFieldIds).toEqual([region]);
    const preview = result.current.importer.fieldOperations.preview({
      sourceAssetId: login.id,
      action: 'plain-text',
      fieldIds: [region],
    });
    act(() => expect(result.current.importer.fieldOperations.commit(preview).success).toBe(true));
    expect(result.current.importer.assets).toHaveLength(3);
    expect(
      result.current.importer.assets.flatMap((asset) => asset.unmappedSourceFieldIds ?? []),
    ).toEqual([]);
    expect(result.current.importer.coverage.ready).toBe(false);
    act(() => result.current.importer.acceptAllEligible());
    expect(result.current.importer.coverage.ready).toBe(true);
  });

  it('maps only available fields after a type change and accepts consecutive Plain Text edits', () => {
    const session = createSession([['username', 'password', 'region', 'owner']]);
    const { result } = mount(session);
    const [username, password, region, owner] = session.nodesById['entry-0'].fieldIds;
    const primary = () =>
      result.current.importer.assets.find((asset) => !asset.id.endsWith('RESCUED'))!;
    act(() => result.current.importer.excludeFields([username, password]));
    act(() => result.current.importer.preserveFields([region]));
    expect(
      result.current.importer.assets.find(({ id }) => id.endsWith('RESCUED'))?.plainTextEditable,
    ).toBe(false);
    act(() => result.current.importer.reviewAsset('alternate:PIN-CODE', primary()));
    expect(primary().type).toBe('PIN-CODE');
    const device = () => primary().schemaFields?.find(({ label }) => /device/i.test(label))!;
    expect(device().candidates?.map(({ id }) => id)).toEqual([owner]);
    act(() => result.current.importer.mapAssetField(primary(), device().key, region));
    expect(device().sourceFieldId).toBeUndefined();
    act(() => result.current.importer.mapAssetField(primary(), device().key, owner));
    expect(device().sourceFieldId).toBe(owner);
    act(() => result.current.importer.mapAssetField(primary(), device().key, undefined));
    act(() => result.current.importer.reviewAsset('alternate:PLAIN-TEXT', primary()));
    expect(primary().type).toBe('PLAIN-TEXT');
    expect(primary().plainTextValue).toBeUndefined();
    act(() => result.current.importer.editPlainText(primary(), 'first'));
    const priorValue = primary().plainTextValue;
    act(() => result.current.importer.editPlainText(primary(), 'first second'));
    expect(priorValue?.isEmpty).toBe(true);
    expect(primary().plainTextValue?.reveal()).toBe('first second');
    expect(result.current.importer.coverage.fields.find(({ id }) => id === username)?.status).toBe(
      'excluded',
    );
    expect(result.current.importer.coverage.fields.find(({ id }) => id === region)?.status).toBe(
      'protected',
    );
  });

  it('renames an assigned asset while retaining its mapping and invalidating a pending preview', () => {
    const session = createSession([['token', 'alpha']]);
    const { result } = mount(session);
    const [asset] = result.current.importer.assets;
    act(() => result.current.importer.reviewAsset('accept', asset));
    act(() =>
      result.current.importer.assignAsset(
        result.current.importer.unassigned[0],
        result.current.importer.plans[0],
      ),
    );
    const [before] = result.current.workspace.plansByClientId.plan.assets;
    const preview = result.current.importer.fieldOperations.preview({
      sourceAssetId: asset.id,
      action: 'plain-text',
      fieldIds: ['entry-0-field-1'],
    });
    expect(preview.canConfirm).toBe(true);
    expect(result.current.importer.renameAsset(asset, '  ')).toBe(false);
    expect(result.current.importer.renameAsset(asset, 'a'.repeat(161))).toBe(false);
    act(() => expect(result.current.importer.renameAsset(asset, '  Renamed asset  ')).toBe(true));
    const [after] = result.current.workspace.plansByClientId.plan.assets;
    expect(after).toEqual({ ...before, name: 'Renamed asset' });
    expect(after.fieldBindings).toBe(before.fieldBindings);
    expect(result.current.importer.assets[0]).toMatchObject({
      id: asset.id,
      name: 'Renamed asset',
      status: 'accepted',
    });
    expect(result.current.importer.fieldOperations.commit(preview).success).toBe(false);
    act(() =>
      result.current.importer.reviewAsset(
        'alternate:PLAIN-TEXT',
        result.current.importer.assets[0],
      ),
    );
    expect(result.current.importer.assets[0].name).toBe('Renamed asset');
    expect(result.current.workspace.plansByClientId.plan.assets[0].name).toBe('Renamed asset');
  });

  it('moves a remaining field into an available canonical slot without overwriting another binding', () => {
    const session = createSession([['token', 'alpha', 'beta']]);
    const { result } = mount(session);
    const [typed] = result.current.importer.assets;
    expect(typed.type).toBe('API-KEY');
    const [, a, b] = session.nodesById['entry-0'].fieldIds;
    const initial = result.current.importer.fieldOperations.preview({
      sourceAssetId: typed.id,
      targetAssetId: typed.id,
      action: 'move',
      fieldIds: [a, b],
    });
    const group = initial.groups[0];
    const invalid = result.current.importer.fieldOperations.preview({
      ...initial.request,
      groups: [{ ...group, fieldBindings: { 'secret.apiKey': a } }],
    });
    expect(invalid.canConfirm).toBe(false);
    const valid = result.current.importer.fieldOperations.preview({
      ...initial.request,
      groups: [{ ...group, fieldBindings: { 'secret.app': a } }],
    });
    expect(valid).toMatchObject({ canConfirm: true, remainingFieldCount: 1 });
    act(() => expect(result.current.importer.fieldOperations.commit(valid).success).toBe(true));
    expect(result.current.importer.assets.find((asset) => asset.id === typed.id)?.unmapped).toEqual(
      ['beta'],
    );
    expect(result.current.importer.assets.find((asset) => asset.id === typed.id)?.mapped).toEqual([
      'token',
      'alpha',
    ]);
  });
  it('returns a changed derived mapping to the fallback and claims only its new reference', () => {
    const session = createSession([['alpha', 'beta']]);
    const { result } = mount(session);
    const source = result.current.importer.assets[0];
    const [a, b] = session.nodesById['entry-0'].fieldIds;
    const initial = result.current.importer.fieldOperations.preview({
      sourceAssetId: source.id,
      action: 'create',
      type: 'API-KEY',
      fieldIds: [a],
    });
    const preview = result.current.importer.fieldOperations.preview({
      ...initial.request,
      groups: [{ ...initial.groups[0], fieldBindings: { 'secret.apiKey': a } }],
    });
    act(() => expect(result.current.importer.fieldOperations.commit(preview).success).toBe(true));
    const derived = result.current.importer.assets.find(
      (asset) => asset.id === preview.groups[0].id,
    )!;
    act(() => result.current.importer.mapAssetField(derived, 'secret.apiKey', b));
    expect(result.current.importer.fieldOperations.canUndo).toBe(false);
    expect(result.current.importer.assets.find((asset) => asset.id === source.id)?.mapped).toEqual([
      'alpha',
    ]);
    expect(result.current.importer.assets.find((asset) => asset.id === derived.id)?.mapped).toEqual(
      ['beta'],
    );
  });

  it('keeps one native Notes destination for multiple suggestions from a single entry', () => {
    const session = createSession(
      [['username', 'password', 'first_api_key', 'second_api_key', 'notes']],
      'onepassword',
    );
    const { result } = mount(session);
    expect(result.current.importer.assets.filter((asset) => asset.type === 'API-KEY')).toHaveLength(
      2,
    );
    expect(result.current.importer.assets.filter((asset) => asset.note)).toHaveLength(1);
    act(() => result.current.importer.setSourceNoteDestination('file', 'asset-notes'));
    act(() => result.current.importer.acceptAllEligible());
    act(() =>
      result.current.importer.assignAssets(
        result.current.importer.unassigned,
        result.current.importer.plans[0],
      ),
    );
    const drafts = result.current.workspace.plansByClientId.plan.assets;
    expect(
      drafts.flatMap((draft) => {
        const value = materialiseAsset(draft, session).asset.meta.notes;
        return value ? [value] : [];
      }),
    ).toEqual(['test-0-4']);
    act(() => result.current.importer.setSourceNoteDestination('file', 'protected'));
    expect(
      result.current.importer.suggestions.filter((asset) => asset.fieldBindings['meta.notes']),
    ).toHaveLength(0);
    expect(
      result.current.importer.assets.filter((asset) => asset.mapped.includes('notes')),
    ).toHaveLength(1);
  });

  it('unassigns and restores an affected rescue and clears only discarded derived literals', () => {
    const session = createSession([['token', 'alpha', 'beta'], ['other']]);
    session.sources.push({ ...session.sources[0], id: 'other-file' });
    session.nodesById['entry-1'].sourceId = 'other-file';
    session.fieldsById['entry-1-field-0'].sourceId = 'other-file';
    const { result, rerender } = mount(session);
    const [, a] = session.nodesById['entry-0'].fieldIds;
    act(() => result.current.importer.preserveFields([a]));
    const rescue = result.current.importer.assets.find((asset) => asset.id.endsWith('RESCUED'))!;
    act(() =>
      result.current.importer.assignAsset(
        result.current.importer.unassigned.find((asset) => asset.id === rescue.id)!,
        result.current.importer.plans[0],
      ),
    );
    const preview = result.current.importer.fieldOperations.preview({
      sourceAssetId: rescue.id,
      action: 'plain-text',
      fieldIds: [a],
    });
    act(() => expect(result.current.importer.fieldOperations.commit(preview).success).toBe(true));
    expect(result.current.workspace.plansByClientId.plan.assets).toHaveLength(0);
    act(() => expect(result.current.importer.fieldOperations.undo().success).toBe(true));
    expect(result.current.workspace.plansByClientId.plan.assets[0]?.id).toBe(rescue.id);

    const separate = result.current.importer.fieldOperations.preview({
      sourceAssetId: 'entry-0:API-KEY',
      action: 'plain-text',
      fieldIds: ['entry-0-field-2'],
    });
    act(() => expect(result.current.importer.fieldOperations.commit(separate).success).toBe(true));
    const original = result.current.importer.assets.find(
      (asset) => asset.id === separate.groups[0].id,
    )!;
    const other = result.current.importer.assets.find((asset) => asset.sourceId === 'other-file')!;
    act(() => result.current.importer.editPlainText(original, 'discarded literal'));
    act(() => result.current.importer.editPlainText(other, 'retained literal'));
    const duplicate = result.current.importer.fieldOperations.preview({
      sourceAssetId: original.id,
      action: 'duplicate-text',
      fieldIds: [],
    });
    act(() => expect(result.current.importer.fieldOperations.commit(duplicate).success).toBe(true));
    const copy = result.current.importer.assets.find(
      (asset) => asset.id === duplicate.groups[0].id,
    )?.plainTextValue;
    expect(copy?.reveal()).toBe('discarded literal');
    act(() => result.current.importer.removeSource('file'));
    const retained = createSession([]);
    retained.sources = [session.sources[1]];
    retained.rootNodeIds = ['entry-1'];
    retained.nodesById['entry-1'] = session.nodesById['entry-1'];
    retained.fieldsById['entry-1-field-0'] = session.fieldsById['entry-1-field-0'];
    rerender({ importSession: retained });
    expect(result.current.importer.fieldOperations.canUndo).toBe(false);
    expect(copy?.isEmpty).toBe(true);
    expect(result.current.importer.assets.map((asset) => asset.plainTextValue?.reveal())).toEqual([
      'retained literal',
    ]);
  });
  it('repeats against released field claims after a peer mapping changes', () => {
    const session = createSession([
      ['alpha', 'beta'],
      ['alpha', 'beta'],
    ]);
    const { result } = mount(session);
    const [template, peer] = result.current.importer.assets;
    const [a, b] = session.nodesById['entry-1'].fieldIds;
    const initial = result.current.importer.fieldOperations.preview({
      sourceAssetId: peer.id,
      action: 'create',
      type: 'API-KEY',
      fieldIds: [a],
    });
    const preview = result.current.importer.fieldOperations.preview({
      ...initial.request,
      groups: [{ ...initial.groups[0], fieldBindings: { 'secret.apiKey': a } }],
    });
    act(() => expect(result.current.importer.fieldOperations.commit(preview).success).toBe(true));
    const derived = result.current.importer.assets.find(
      (asset) => asset.id === preview.groups[0].id,
    )!;
    act(() => result.current.importer.mapAssetField(derived, 'secret.apiKey', b));
    const repeat = result.current.importer.fieldOperations.preview({
      sourceAssetId: template.id,
      action: 'plain-text',
      fieldIds: [session.nodesById['entry-0'].fieldIds[0]],
      repeatCompatible: true,
    });
    expect(repeat).toMatchObject({ canConfirm: true, affectedEntryCount: 2, skippedEntryCount: 0 });
  });
  it('creates an explicitly mapped typed group and leaves unmatched extras pending', () => {
    const session = createSession([['username', 'password', 'token', 'other']]);
    const { result } = mount(session);
    const [primary] = result.current.importer.assets;
    const [, , token, other] = session.nodesById['entry-0'].fieldIds;
    expect(primary.type).toBe('USER-PSWD');
    const initial = result.current.importer.fieldOperations.preview({
      sourceAssetId: primary.id,
      action: 'suggest',
      fieldIds: [token, other],
    });
    const preview = result.current.importer.fieldOperations.preview({
      ...initial.request,
      groups: [
        { ...initial.groups[0], type: 'API-KEY', fieldBindings: { 'secret.apiKey': token } },
      ],
    });
    expect(preview).toMatchObject({
      canConfirm: true,
      movedFieldCount: 1,
      remainingFieldCount: 1,
      groups: [
        {
          name: 'Entry 0 — Additional 1',
          type: 'API-KEY',
          fieldBindings: { 'secret.apiKey': token },
        },
      ],
    });
    act(() => expect(result.current.importer.fieldOperations.commit(preview).success).toBe(true));
    expect(result.current.importer.assets.find((asset) => asset.id === primary.id)?.mapped).toEqual(
      ['username', 'password'],
    );
    expect(result.current.importer.coverage.fields.find(({ id }) => id === other)?.status).toBe(
      'pending',
    );
    expect(result.current.importer.assets).toHaveLength(2);
    act(() => expect(result.current.importer.fieldOperations.undo().success).toBe(true));
    expect(result.current.importer.assets).toHaveLength(1);
    expect(result.current.importer.assets[0].unmappedSourceFieldIds).toEqual([token, other]);
  });
  it('returns resolved split assets to Suggested while keeping acceptance explicit', () => {
    const session = createSession([['username', 'password', 'region', 'owner']]);
    const { result } = mount(session);
    const [primary] = result.current.importer.assets;
    const [username, , region, owner] = session.nodesById['entry-0'].fieldIds;
    const current = () => result.current.importer;
    const source = () => current().assets.find(({ id }) => id === primary.id)!;
    act(() => current().mapAssetField(primary, 'secret.username', username));
    expect(source().status).toBe('needs-review');

    const preview = current().fieldOperations.preview({
      sourceAssetId: primary.id,
      action: 'plain-text',
      fieldIds: [region, owner],
    });
    expect(preview.canConfirm).toBe(true);
    act(() => expect(current().fieldOperations.commit(preview).success).toBe(true));
    expect(current().assets.map(({ status }) => status)).toEqual(['suggested', 'suggested']);
    expect(current().unassigned).toHaveLength(0);
    expect(result.current.workspace.plansByClientId.plan.assets).toHaveLength(0);
    expect(current().executionCoverage.ready).toBe(false);

    act(() => expect(current().fieldOperations.undo().success).toBe(true));
    expect(current().assets).toHaveLength(1);
    expect(source().status).toBe('needs-review');

    act(() => current().excludeFields([region, owner]));
    expect(source().status).toBe('suggested');
    act(() => current().mapAssetField(source(), 'secret.username', undefined));
    expect(source().status).toBe('needs-review');
    act(() => current().reviewAsset('exclude', source()));
    expect(source().status).toBe('excluded');
  });

  it('appends pending fields to an existing rescue and restores its assignment on undo', () => {
    const session = createSession([['token', 'alpha', 'beta', 'gamma']]);
    const { result } = mount(session);
    const [, alpha, beta] = session.nodesById['entry-0'].fieldIds;
    act(() => result.current.importer.preserveFields([alpha]));
    const source = result.current.importer.assets.find((asset) => asset.type === 'API-KEY')!;
    const rescue = result.current.importer.assets.find((asset) => asset.id.endsWith('RESCUED'))!;
    act(() => result.current.importer.reviewAsset('accept', source));
    const originalIds = [source.id, rescue.id];
    act(() =>
      result.current.importer.assignAssets(
        result.current.importer.unassigned.filter((asset) => originalIds.includes(asset.id)),
        result.current.importer.plans[0],
      ),
    );
    const preview = result.current.importer.fieldOperations.preview({
      sourceAssetId: source.id,
      action: 'move',
      targetAssetId: rescue.id,
      fieldIds: [beta],
    });
    expect(preview).toMatchObject({ canConfirm: true, movedFieldCount: 1 });
    act(() => expect(result.current.importer.fieldOperations.commit(preview).success).toBe(true));
    expect(result.current.workspace.plansByClientId.plan.assets.map(({ id }) => id)).toEqual([
      source.id,
    ]);
    const rescues = result.current.importer.assets.filter((asset) => asset.id.endsWith('RESCUED'));
    expect(rescues.map((asset) => asset.mapped)).toEqual([['alpha', 'beta']]);
    expect(
      result.current.importer.coverage.fields.find(({ id }) => id === 'entry-0-field-3')?.status,
    ).toBe('pending');
    act(() => expect(result.current.importer.fieldOperations.undo().success).toBe(true));
    expect(result.current.workspace.plansByClientId.plan.assets.map((asset) => asset.id)).toEqual(
      originalIds,
    );
    expect(result.current.importer.assets.find((asset) => asset.id === rescue.id)?.mapped).toEqual([
      'alpha',
    ]);
    expect(
      result.current.importer.assets.find((asset) => asset.id === source.id)?.unmapped,
    ).toEqual(['beta', 'gamma']);
  });
});

describe('explicit field operation batches', () => {
  function fromTwoSources(fields: string[]) {
    const session = createSession([fields, fields, fields]);
    session.sources.push({ ...session.sources[0], id: 'other-file', name: 'Other file' });
    const other = session.nodesById['entry-1'];
    other.sourceId = 'other-file';
    for (const id of other.fieldIds) session.fieldsById[id].sourceId = other.sourceId;
    const mounted = mount(session);
    return { session, ...mounted };
  }

  function batchRequest(
    session: ImportSession,
    assets: ReturnType<typeof mount>['result']['current']['importer']['assets'],
    action: FieldOperationRequest['action'],
    positions: number[],
  ): FieldOperationRequest {
    const entries = ['entry-0', 'entry-1'].map((nodeId) => ({
      sourceAssetId: assets.find((asset) => asset.sourceNodeId === nodeId)!.id,
      fieldIds: positions.map((index) => session.nodesById[nodeId].fieldIds[index]),
    }));
    return {
      action,
      sourceAssetId: entries[0].sourceAssetId,
      fieldIds: entries.flatMap(({ fieldIds }) => fieldIds),
      entries,
    };
  }

  it.each(['create', 'plain-text'] as const)(
    'applies %s to the exact selected entries and undoes both together',
    (action) => {
      const { session, result } = fromTwoSources(['alpha', 'beta']);
      const before = result.current.importer;
      const request = batchRequest(session, before.assets, action, [0]);
      const preview = before.fieldOperations.preview(request);
      expect(preview).toMatchObject({
        canConfirm: true,
        compatibleEntryCount: 2,
        affectedEntryCount: 2,
        movedFieldCount: 2,
        remainingFieldCount: 0,
        entries: [
          { nodeId: 'entry-0', sourceId: 'file', name: 'Entry 0' },
          { nodeId: 'entry-1', sourceId: 'other-file', name: 'Entry 1' },
        ],
      });
      expect(
        preview.groups.map(({ nodeId, name, fieldBindings }) => [nodeId, name, fieldBindings]),
      ).toEqual([
        ['entry-0', 'Entry 0 — Additional 1', { 'secret.text': ['entry-0-field-0'] }],
        ['entry-1', 'Entry 1 — Additional 1', { 'secret.text': ['entry-1-field-0'] }],
      ]);
      act(() =>
        expect(before.fieldOperations.commit(preview).createdAssetIds).toEqual(
          preview.groups.map(({ id }) => id),
        ),
      );
      expect(
        result.current.importer.suggestions
          .filter((asset) => preview.groups.some(({ id }) => id === asset.id))
          .map((asset) => materialiseAsset(asset, session).asset.secret.text),
      ).toEqual(['test-0-0', 'test-1-0']);
      act(() => expect(result.current.importer.fieldOperations.undo().success).toBe(true));
      expect(result.current.importer.assets).toEqual(before.assets);
      expect(result.current.importer.fieldOperations.canUndo).toBe(false);
    },
  );

  it('starts Create several with one populated Plain Text asset per selected entry', () => {
    const { session, result } = fromTwoSources(['alpha', 'beta', 'gamma']);
    const before = result.current.importer;
    const request = batchRequest(session, before.assets, 'suggest', [0, 1]);
    const preview = before.fieldOperations.preview(request);
    expect(preview).toMatchObject({ canConfirm: true, movedFieldCount: 4, remainingFieldCount: 0 });
    expect(preview.groups).toMatchObject(
      request.entries!.map(({ fieldIds }, index) => ({
        nodeId: `entry-${index}`,
        name: `Entry ${index} — Additional 1`,
        type: 'PLAIN-TEXT',
        fieldBindings: { 'secret.text': fieldIds },
      })),
    );
    act(() => expect(before.fieldOperations.commit(preview).success).toBe(true));
    expect(
      result.current.importer.suggestions
        .filter((asset) => preview.groups.some(({ id }) => id === asset.id))
        .map((asset) => materialiseAsset(asset, session).asset.secret.text),
    ).toEqual(['alpha: test-0-0\nbeta: test-0-1', 'alpha: test-1-0\nbeta: test-1-1']);
    act(() => expect(result.current.importer.fieldOperations.undo().success).toBe(true));
    expect(result.current.importer.assets).toEqual(before.assets);
    expect(result.current.importer.fieldOperations.canUndo).toBe(false);
  });

  it('creates independently typed and named groups using only their entry selections', () => {
    const { session, result } = fromTwoSources(['alpha', 'beta', 'gamma']);
    const { assets, fieldOperations } = result.current.importer;
    const request = batchRequest(session, assets, 'suggest', [0, 1]);
    const initial = fieldOperations.preview(request);
    const [first, second] = initial.groups;
    const emptyGroup = { ...second, id: `${second.id}-extra-1`, fieldBindings: {} };
    const withEmptyGroup = fieldOperations.preview({
      ...initial.request,
      groups: [first, second, emptyGroup],
    });
    expect(withEmptyGroup.groups[2].fieldBindings).toEqual({});
    expect(withEmptyGroup.canConfirm).toBe(false);
    expect(withEmptyGroup.groupErrors).toEqual({
      [emptyGroup.id]: 'Entry 1: Map valid source fields in destination 2.',
    });
    const groups = [
      {
        ...first,
        name: 'Custom API key',
        automaticName: false,
        type: 'API-KEY',
        fieldBindings: { 'secret.apiKey': request.entries![0].fieldIds[0] },
      },
      { ...second, fieldBindings: { 'secret.text': request.entries![1].fieldIds } },
    ];
    const invalid = fieldOperations.preview({
      ...initial.request,
      groups: [
        { ...groups[0], fieldBindings: { 'secret.apiKey': request.entries![1].fieldIds[0] } },
        groups[1],
      ],
    });
    expect(invalid.errors[0]).toContain('Entry 0');
    expect(invalid.canConfirm).toBe(false);
    const preview = fieldOperations.preview({ ...initial.request, groups });
    expect(preview).toMatchObject({ canConfirm: true, movedFieldCount: 3, remainingFieldCount: 1 });
    expect(preview.groups.map(({ name, type }) => [name, type])).toEqual([
      ['Custom API key', 'API-KEY'],
      ['Entry 1 — Additional 1', 'PLAIN-TEXT'],
    ]);
    act(() => expect(fieldOperations.commit(preview).success).toBe(true));
    expect(
      result.current.importer.assets.filter(({ id }) => groups.some((group) => group.id === id)),
    ).toHaveLength(2);
  });

  it('identifies the destination that fails the projected schema validation', () => {
    const { session, result } = fromTwoSources(['alpha', 'beta']);
    const { assets, fieldOperations } = result.current.importer;
    const request = batchRequest(session, assets, 'suggest', [0]);
    const initial = fieldOperations.preview(request);
    const [first, second] = initial.groups;
    const preview = fieldOperations.preview({
      ...initial.request,
      groups: [
        first,
        {
          ...second,
          type: 'USER-PSWD',
          fieldBindings: { 'secret.email': request.entries![1].fieldIds[0] },
        },
      ],
    });
    const message = 'Entry 1: Complete each destination’s field mapping before confirming.';
    expect(preview).toMatchObject({
      canConfirm: false,
      errors: [message],
      groupErrors: { [second.id]: message },
    });
    act(() => expect(fieldOperations.commit(preview).success).toBe(false));
    expect(result.current.importer.assets).toEqual(assets);
  });

  it('requires per-entry targets and preserves occupied destination fields', () => {
    const { session, result } = fromTwoSources(['token', 'alpha', 'beta']);
    const { assets, fieldOperations } = result.current.importer;
    const request = batchRequest(session, assets, 'move', [1]);
    const missing = fieldOperations.preview(request);
    expect(missing).toMatchObject({ canConfirm: false });
    expect(missing.entries).toHaveLength(2);
    expect(missing.groups).toHaveLength(2);
    const entries = request.entries!.map((entry) => ({
      ...entry,
      targetAssetId: entry.sourceAssetId,
    }));
    expect(
      fieldOperations.preview({
        ...missing.request,
        entries: [entries[0], { ...entries[1], targetAssetId: entries[0].sourceAssetId }],
      }).errors[0],
    ).toContain('Entry 1');
    const targeted = fieldOperations.preview({ ...missing.request, entries });
    const groups = targeted.groups.map((group, i) => ({
      ...group,
      fieldBindings: { 'secret.app': entries[i].fieldIds[0] },
    }));
    expect(
      fieldOperations.preview({
        ...targeted.request,
        groups: [
          groups[0],
          { ...groups[1], fieldBindings: { 'secret.apiKey': entries[1].fieldIds[0] } },
        ],
      }).canConfirm,
    ).toBe(false);
    const preview = fieldOperations.preview({ ...targeted.request, groups });
    expect(preview).toMatchObject({ canConfirm: true, movedFieldCount: 2 });
    act(() => expect(fieldOperations.commit(preview).createdAssetIds).toEqual([]));
    expect(
      result.current.importer.assets
        .filter(({ id }) => entries.some(({ targetAssetId }) => targetAssetId === id))
        .map(({ mapped }) => mapped),
    ).toEqual([
      ['token', 'alpha'],
      ['token', 'alpha'],
    ]);
    act(() => expect(result.current.importer.fieldOperations.undo().success).toBe(true));
    expect(result.current.importer.assets).toEqual(assets);
  });

  it('blocks mapped or excluded selections, malformed scope, and stale batches without changes', () => {
    const { session, result } = fromTwoSources(['token', 'alpha', 'beta']);
    const { assets, fieldOperations } = result.current.importer;
    const canonical = batchRequest(session, assets, 'plain-text', [0]);
    const invalid = fieldOperations.preview(canonical);
    expect(invalid.canConfirm).toBe(false);
    expect(invalid.errors).toEqual([
      expect.stringContaining('Entry 0'),
      expect.stringContaining('Entry 1'),
    ]);
    const request = batchRequest(session, assets, 'create', [1]);
    for (const invalidRequest of [
      { ...request, repeatCompatible: true },
      { ...request, fieldIds: request.fieldIds.slice(1) },
      { ...request, entries: [request.entries![1], request.entries![0]] },
    ]) {
      expect(fieldOperations.preview(invalidRequest).canConfirm).toBe(false);
    }
    const stale = fieldOperations.preview(request);
    expect(stale.canConfirm).toBe(true);
    act(() => result.current.importer.excludeFields(request.entries![1].fieldIds));
    expect(fieldOperations.commit(stale).success).toBe(false);
    const excluded = result.current.importer.fieldOperations.preview(request);
    expect(excluded.canConfirm).toBe(false);
    expect(excluded.errors[0]).toContain('Entry 1');
    expect(result.current.importer.fieldOperations.commit(excluded).success).toBe(false);
    expect(result.current.importer.assets.map(({ id }) => id)).toEqual(assets.map(({ id }) => id));
    expect(result.current.importer.fieldOperations.canUndo).toBe(true);
    act(() => expect(result.current.importer.fieldOperations.undo().success).toBe(true));
    expect(result.current.importer.coverage.fields).toEqual(
      expect.arrayContaining(
        request.entries![1].fieldIds.map((id) =>
          expect.objectContaining({ id, status: 'pending' }),
        ),
      ),
    );
  });

  it('rejects an entry backed by edited literal text', () => {
    const { session, result } = fromTwoSources(['alpha', 'beta']);
    const { assets } = result.current.importer;
    const request = batchRequest(session, assets, 'plain-text', [1]);
    act(() => result.current.importer.editPlainText(assets[1], 'Edited'));
    const operations = result.current.importer.fieldOperations;
    const preview = operations.preview(request);
    expect(preview.canConfirm).toBe(false);
    expect(preview.errors[0]).toContain('Entry 1: Edited Plain Text');
    expect(operations.commit(preview).success).toBe(false);
  });
});

describe('explicit batch coverage safeguards', () => {
  it.each(['fallback', 'sibling'] as const)(
    'does not reclaim protected Plain Text fields from a staged %s',
    (kind) => {
      const session = createSession(
        kind === 'fallback'
          ? [
              ['alpha', 'beta'],
              ['gamma', 'delta'],
            ]
          : [
              ['token', 'alpha', 'beta'],
              ['gamma', 'delta'],
            ],
      );
      const { result } = mount(session);
      const [fieldId] = session.nodesById['entry-0'].fieldIds.slice(kind === 'fallback' ? 0 : 1);
      const [otherFieldId] = session.nodesById['entry-1'].fieldIds;
      const original = result.current.importer.assets.find(
        (asset) => asset.sourceNodeId === 'entry-0',
      )!;
      if (kind === 'fallback') {
        act(() => result.current.importer.reviewAsset('accept', original));
      } else {
        act(() => result.current.importer.preserveFields([fieldId]));
      }
      act(() =>
        result.current.importer.assignAssets(
          result.current.importer.unassigned.filter((asset) => asset.type === 'PLAIN-TEXT'),
          result.current.importer.plans[0],
        ),
      );
      const { workspace, importer } = result.current;
      expect(workspace.plansByClientId.plan.assets).toHaveLength(1);
      expect(importer.coverage.fields.find(({ id }) => id === fieldId)?.status).toBe('protected');
      const entries = [
        { sourceAssetId: original.id, fieldIds: [fieldId] },
        {
          sourceAssetId: importer.assets.find((asset) => asset.sourceNodeId === 'entry-1')!.id,
          fieldIds: [otherFieldId],
        },
      ];
      const preview = importer.fieldOperations.preview({
        action: 'create',
        sourceAssetId: original.id,
        fieldIds: [fieldId, otherFieldId],
        entries,
      });
      expect(preview.canConfirm).toBe(false);
      expect(preview.errors[0]).toContain('Entry 0');
      expect(importer.fieldOperations.commit(preview).success).toBe(false);
      expect(result.current.workspace).toBe(workspace);
      expect(result.current.importer.assets).toBe(importer.assets);
      expect(result.current.importer.fieldOperations.canUndo).toBe(false);
    },
  );
});

describe('generated draft removal', () => {
  it('removes the exact assigned draft and restores its assignment, name and manual text on undo', () => {
    const session = createSession([['token', 'alpha']]);
    const { result } = mount(session);
    const current = () => result.current.importer;
    const [original] = current().assets;
    const [, alpha] = session.nodesById['entry-0'].fieldIds;
    const preview = current().fieldOperations.preview({
      sourceAssetId: original.id,
      action: 'plain-text',
      fieldIds: [alpha],
    });
    act(() => expect(current().fieldOperations.commit(preview).success).toBe(true));
    const [group] = preview.groups;
    const generated = () => current().assets.find(({ id }) => id === group.id)!;
    expect(generated().canRemoveDraft).toBe(true);
    act(() => current().renameAsset(generated(), 'Generated credential'));
    act(() => current().editPlainText(generated(), 'Manual text'));
    act(() => current().reviewAsset('accept', original));
    act(() => current().reviewAsset('accept', generated()));
    act(() => current().assignAssets(current().unassigned, current().plans[0]));
    const assigned = result.current.workspace.plansByClientId.plan.assets;
    expect(assigned.map(({ id }) => id)).toEqual([original.id, group.id]);

    act(() =>
      expect(current().fieldOperations.remove!([group.id])).toMatchObject({
        success: true,
        message: '1 draft removed · 1 field returned to Unassigned.',
        removedAssetIds: [group.id],
        changedAssetIds: [original.id],
      }),
    );
    expect(current().assets.map(({ id }) => id)).toEqual([original.id]);
    expect(result.current.workspace.plansByClientId.plan.assets).toEqual([assigned[0]]);
    expect(result.current.workspace.ignoredSourceFieldIds).toEqual([]);
    expect(current().coverage.fields.find(({ id }) => id === alpha)?.status).toBe('pending');

    act(() => expect(current().fieldOperations.undo().success).toBe(true));
    expect(result.current.workspace.plansByClientId.plan.assets).toEqual(assigned);
    expect(generated()).toMatchObject({
      name: 'Generated credential',
      status: 'accepted',
      canRemoveDraft: true,
    });
    expect(generated().plainTextValue?.reveal()).toBe('Manual text');
  });

  it.each(['removeSource', 'resetReview', 'replace-undo', 'unmount'] as const)(
    'clears removed draft literals when %s discards undo',
    (discard) => {
      const session = createSession([['token', 'alpha', 'beta']]);
      const { result, unmount } = mount(session);
      const current = () => result.current.importer;
      const [source] = current().assets;
      const [, alpha, beta] = session.nodesById['entry-0'].fieldIds;
      const createText = (fieldId: string) =>
        current().fieldOperations.preview({
          sourceAssetId: source.id,
          action: 'plain-text',
          fieldIds: [fieldId],
        });
      const initial = createText(alpha);
      act(() => expect(current().fieldOperations.commit(initial).success).toBe(true));
      const [{ id }] = initial.groups;
      const generated = () => current().assets.find((asset) => asset.id === id)!;
      act(() => current().editPlainText(generated(), 'Manual text'));
      const editedValue = generated().plainTextValue!;
      act(() => current().reviewAsset('accept', generated()));
      act(() => current().assignAssets(current().unassigned, current().plans[0]));
      const assigned = result.current.workspace.plansByClientId.plan.assets[0];
      const assignedText = assigned.fieldBindings['secret.text'];
      expect(assignedText.kind).toBe('literal');
      act(() => expect(current().fieldOperations.remove!([id]).success).toBe(true));
      expect(editedValue.reveal()).toBe('Manual text');
      if (discard === 'unmount') unmount();
      else if (discard === 'replace-undo') {
        const replacement = createText(beta);
        act(() => expect(current().fieldOperations.commit(replacement).success).toBe(true));
      } else {
        act(() =>
          discard === 'removeSource' ? current().removeSource('file') : current().resetReview(),
        );
      }
      expect(editedValue.isEmpty).toBe(true);
      expect(assignedText.kind === 'literal' && assignedText.value.isEmpty).toBe(true);
    },
  );

  it('keeps released fields available instead of expanding an accepted Plain Text fallback', () => {
    const session = createSession([['alpha', 'beta']]);
    const { result } = mount(session);
    const current = () => result.current.importer;
    const [source] = current().assets;
    const [alpha, beta] = session.nodesById['entry-0'].fieldIds;
    const request = {
      sourceAssetId: source.id,
      action: 'plain-text' as const,
      fieldIds: [alpha],
    };
    const preview = current().fieldOperations.preview(request);
    act(() => expect(current().fieldOperations.commit(preview).success).toBe(true));
    const [generated] = current().assets.filter(({ canRemoveDraft }) => canRemoveDraft);
    act(() => current().reviewAsset('accept', source));
    act(() => current().reviewAsset('accept', generated));
    act(() => current().assignAssets(current().unassigned, current().plans[0]));
    const [originalDraft] = result.current.workspace.plansByClientId.plan.assets;

    act(() => expect(current().fieldOperations.remove!([generated.id]).success).toBe(true));
    const [original] = current().assets;
    expect(original).toMatchObject({
      id: source.id,
      status: 'accepted',
      unmappedSourceFieldIds: [alpha],
      plainTextSources: [{ id: beta }],
    });
    expect(result.current.workspace.plansByClientId.plan.assets[0]).toBe(originalDraft);
    expect(current().coverage.fields.map(({ status }) => status)).toEqual(['pending', 'protected']);
    expect(current().fieldOperations.preview(request).canConfirm).toBe(true);
    act(() => expect(current().fieldOperations.undo().success).toBe(true));
    expect(result.current.workspace.plansByClientId.plan.assets[0]).toBe(originalDraft);
    expect(current().coverage.fields.map(({ status }) => status)).toEqual([
      'protected',
      'protected',
    ]);
  });

  it('validates bulk selection and invalidates removal undo after a later edit', () => {
    const session = createSession([
      ['token', 'alpha', 'beta'],
      ['token', 'alpha', 'beta'],
    ]);
    const { result } = mount(session);
    const current = () => result.current.importer;
    const [source] = current().assets;
    const [, alpha] = session.nodesById['entry-0'].fieldIds;
    const preview = current().fieldOperations.preview({
      sourceAssetId: source.id,
      action: 'plain-text',
      fieldIds: [alpha],
      repeatCompatible: true,
    });
    act(() => expect(current().fieldOperations.commit(preview).success).toBe(true));
    const generated = current().assets.filter(({ canRemoveDraft }) => canRemoveDraft);
    expect(generated).toHaveLength(2);
    const ids = generated.map(({ id }) => id);
    const before = result.current.workspace;
    expect(current().fieldOperations.remove!([source.id]).success).toBe(false);
    expect(current().fieldOperations.remove!([ids[0], ids[0]]).success).toBe(false);
    expect(current().fieldOperations.remove!([ids[0], 'stale']).success).toBe(false);
    expect(result.current.workspace).toBe(before);

    act(() =>
      expect(current().fieldOperations.remove!([source.id, ...ids])).toMatchObject({
        success: true,
        message: '2 drafts removed · 2 fields returned to Unassigned. 1 selected asset skipped.',
        removedAssetIds: ids,
      }),
    );
    expect(current().assets.every(({ canRemoveDraft }) => !canRemoveDraft)).toBe(true);
    const previousControls = current().fieldOperations;
    act(() => current().renameAsset(source, 'Later edit'));
    expect(previousControls.undo().success).toBe(false);
    expect(current().fieldOperations.canUndo).toBe(false);
    expect(current().assets[0].name).toBe('Later edit');
  });

  it('keeps original move targets ineligible and generated move targets removable', () => {
    const session = createSession([['token', 'alpha', 'beta', 'gamma']]);
    const { result } = mount(session);
    const current = () => result.current.importer;
    const [source] = current().assets;
    const [, alpha, beta, gamma] = session.nodesById['entry-0'].fieldIds;
    const move = {
      sourceAssetId: source.id,
      targetAssetId: source.id,
      action: 'move',
      fieldIds: [alpha],
    } as const;
    const request = { ...move, fieldIds: [...move.fieldIds] };
    const [initial] = current().fieldOperations.preview(request).groups;
    const originalMove = current().fieldOperations.preview({
      ...request,
      groups: [{ ...initial, fieldBindings: { 'secret.app': alpha } }],
    });
    act(() => expect(current().fieldOperations.commit(originalMove).success).toBe(true));
    expect(current().assets[0].canRemoveDraft).toBeUndefined();
    const create = current().fieldOperations.preview({
      sourceAssetId: source.id,
      action: 'plain-text',
      fieldIds: [beta],
    });
    act(() => expect(current().fieldOperations.commit(create).success).toBe(true));
    const id = create.groups[0].id;
    const generatedMove = current().fieldOperations.preview({
      ...request,
      targetAssetId: id,
      fieldIds: [gamma],
    });
    act(() => expect(current().fieldOperations.commit(generatedMove).success).toBe(true));
    expect(current().assets.find((asset) => asset.id === id)?.canRemoveDraft).toBe(true);
    act(() => expect(current().fieldOperations.undo().success).toBe(true));
    expect(current().assets.find((asset) => asset.id === id)?.canRemoveDraft).toBe(true);
    expect(
      current().assets.find((asset) => asset.id === source.id)?.canRemoveDraft,
    ).toBeUndefined();
  });

  it('retains the primary fallback to review a pending note when another draft owns its other field', () => {
    const session = createSession([['alpha', 'notes']], 'onepassword');
    const { result } = mount(session);
    const current = () => result.current.importer;
    const [source] = current().assets;
    expect(source.type).toBe('PLAIN-TEXT');
    const [alpha, note] = session.nodesById['entry-0'].fieldIds;
    function createDraft(fieldId: string) {
      const preview = current().fieldOperations.preview({
        sourceAssetId: source.id,
        action: 'plain-text',
        fieldIds: [fieldId],
      });
      act(() => expect(current().fieldOperations.commit(preview).success).toBe(true));
      return preview.groups[0].id;
    }
    const remaining = createDraft(alpha);
    const removed = createDraft(note);
    expect(current().assets.some(({ id }) => id === source.id)).toBe(false);

    act(() =>
      expect(current().fieldOperations.remove!([removed])).toMatchObject({
        success: true,
        removedAssetIds: [removed],
        changedAssetIds: [source.id],
      }),
    );
    expect(current().assets.find(({ id }) => id === source.id)?.note).toMatchObject({
      sourceFieldId: note,
      explicit: false,
    });
    expect(current().assets.find(({ id }) => id === remaining)?.canRemoveDraft).toBe(true);
    expect(current().coverage.fields.find(({ id }) => id === note)?.status).toBe('pending');
  });

  it('returns a protected note to pending without recreating a rescue or changing other notes', () => {
    const session = createSession(
      [
        ['username', 'password', 'notes'],
        ['username', 'password', 'notes'],
      ],
      'onepassword',
    );
    const { result } = mount(session);
    const current = () => result.current.importer;
    const [source] = current().assets;
    const [, , note] = session.nodesById['entry-0'].fieldIds;
    act(() => current().setAssetNoteDestination(source, 'protected'));
    const rescue = current().assets.find(({ id }) => id === 'entry-0:PLAIN-TEXT-RESCUED')!;
    const preview = current().fieldOperations.preview({
      sourceAssetId: rescue.id,
      action: 'plain-text',
      fieldIds: [note],
    });
    act(() => expect(current().fieldOperations.commit(preview).success).toBe(true));
    act(() => current().setSourceNoteDestination('file', 'protected'));
    const id = preview.groups[0].id;
    expect(
      current().assets.find(({ sourceNodeId }) => sourceNodeId === 'entry-1')?.note,
    ).toMatchObject({
      explicit: true,
      inherited: true,
    });
    const automaticRescue = current().assets.find(({ id }) => id.endsWith('RESCUED'));
    expect(automaticRescue?.canRemoveDraft).toBeUndefined();
    act(() => expect(current().fieldOperations.remove!([id]).success).toBe(true));
    expect(current().coverage.fields.find(({ id }) => id === note)?.status).toBe('pending');
    expect(current().assets.some(({ id }) => id === 'entry-0:PLAIN-TEXT-RESCUED')).toBe(false);
    expect(current().assets.find(({ id }) => id === source.id)?.note?.explicit).toBe(false);
    expect(current().noteSources[0].destination).toBe('protected');
    expect(
      current().assets.find(({ sourceNodeId }) => sourceNodeId === 'entry-1')?.note?.explicit,
    ).toBe(true);
    act(() => expect(current().fieldOperations.undo().success).toBe(true));
    expect(current().assets.find((asset) => asset.id === id)?.canRemoveDraft).toBe(true);
    expect(current().assets.find(({ id }) => id === source.id)?.note).toBeUndefined();
  });
});
