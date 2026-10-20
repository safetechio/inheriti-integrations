// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { SensitiveValue, type ImportSession } from '@modules/import/domain/import-model';
import { useImporterWorkspace } from '@modules/importer-preview/ImporterFlow/application/importer-workspace';
import { createEmptyWorkspace } from '@modules/plans/domain/workspace-model';
import { createPlan } from '@modules/plans/domain/workspace-commands';
import { materialiseAsset } from '@modules/plans/domain/asset-materializer';
import { buildStagedAssetInput } from '@modules/batch/infrastructure/importer-tool-repo';
import { hasIncludedSchemaField } from '@modules/importer-preview/AssetReviewQueue/types';
import {
  assetMatchesSuggestion,
  sourceSuggestions,
} from '@modules/importer-preview/ImporterFlow/application/importer-workspace-suggestions';
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
  it('moves native notes between Plain Text metadata and source text in review and assigned drafts', () => {
    const session = importSession();
    session.sources[0]!.kind = 'onepassword';
    session.fieldsById['field-token'].name = 'extra:private key';
    session.fieldsById['field-other'].name = 'notes';
    const initialWorkspace = createPlan(createEmptyWorkspace(), {
      clientId: 'plan-1',
      name: 'Partner Plan',
    });
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(initialWorkspace);
      return { workspace, importer: useImporterWorkspace(session, workspace, setWorkspace) };
    });
    const asset = () => result.current.importer.assets[0]!;
    const suggested = () => result.current.importer.suggestions[0]!;
    expect(suggested().fieldBindings['meta.notes']).toEqual({
      kind: 'source',
      sourceFieldId: 'field-other',
    });
    act(() => result.current.importer.mapAssetField(asset(), 'meta.notes', undefined));
    expect(suggested().fieldBindings['meta.notes']).toBeUndefined();
    expect(
      materialiseAsset(
        {
          id: 'draft',
          type: 'PLAIN-TEXT',
          name: 'Partner',
          fieldBindings: suggested().fieldBindings,
        },
        session,
      ).asset.secret.text,
    ).toContain('notes: second-token');
    act(() => result.current.importer.reviewAsset('accept', asset()));
    act(() =>
      result.current.importer.assignAsset(
        result.current.importer.unassigned[0]!,
        result.current.importer.plans[0]!,
      ),
    );
    act(() => result.current.importer.mapAssetField(asset(), 'meta.notes', 'field-other'));
    const draft = result.current.workspace.plansByClientId['plan-1']!.assets[0]!;
    expect(materialiseAsset(draft, session).asset.secret.text).toBe('first-token');
    expect(materialiseAsset(draft, session).asset.meta.notes).toBe('second-token');
    expect(suggested().fieldBindings['secret.text']).toEqual({
      kind: 'source',
      sourceFieldId: 'field-token',
    });
  });
  it('preserves edited Plain Text while changing its note mapping', () => {
    const session = importSession();
    session.sources[0]!.kind = 'onepassword';
    session.fieldsById['field-token'].name = 'extra:private key';
    session.fieldsById['field-other'].name = 'notes';
    const initialWorkspace = createPlan(createEmptyWorkspace(), {
      clientId: 'plan-1',
      name: 'Partner Plan',
    });
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(initialWorkspace);
      return { workspace, importer: useImporterWorkspace(session, workspace, setWorkspace) };
    });
    const asset = () => result.current.importer.assets[0]!;
    act(() => result.current.importer.editPlainText(asset(), 'Edited value'));
    act(() => result.current.importer.mapAssetField(asset(), 'meta.notes', undefined));
    expect(result.current.importer.suggestions[0]!.fieldBindings['secret.text']).toMatchObject({
      kind: 'literal',
    });
    act(() => result.current.importer.reviewAsset('accept', asset()));
    act(() =>
      result.current.importer.assignAsset(
        result.current.importer.unassigned[0]!,
        result.current.importer.plans[0]!,
      ),
    );
    act(() => result.current.importer.mapAssetField(asset(), 'meta.notes', 'field-other'));
    const draft = result.current.workspace.plansByClientId['plan-1']!.assets[0]!;
    expect(materialiseAsset(draft, session).asset.secret.text).toBe('Edited value');
    expect(materialiseAsset(draft, session).asset.meta.notes).toBe('second-token');
  });
  it('returns the old note to Plain Text when replacing its note source', () => {
    const session = importSession();
    session.sources[0]!.kind = 'onepassword';
    session.fieldsById['field-token'].name = 'extra:private key';
    session.fieldsById['field-other'].name = 'notes';
    session.nodesById['entry-1']!.fieldIds.push('field-new-note');
    session.fieldsById['field-new-note'] = {
      id: 'field-new-note',
      sourceId: 'source-1',
      parentNodeId: 'entry-1',
      sourcePath: ['entry-1', 'new note'],
      name: 'extra:new note',
      value: new SensitiveValue('Replacement instructions'),
      metadata: {},
    };
    const initialWorkspace = createPlan(createEmptyWorkspace(), {
      clientId: 'plan-1',
      name: 'Partner Plan',
    });
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(initialWorkspace);
      return { workspace, importer: useImporterWorkspace(session, workspace, setWorkspace) };
    });
    const asset = () => result.current.importer.assets[0]!;
    act(() => result.current.importer.mapAssetField(asset(), 'meta.notes', 'field-new-note'));
    const reviewed = result.current.importer.suggestions[0]!;
    const reviewedAsset = materialiseAsset(
      {
        id: 'reviewed',
        type: 'PLAIN-TEXT',
        name: 'Partner',
        fieldBindings: reviewed.fieldBindings,
      },
      session,
    ).asset;
    expect(reviewedAsset.meta.notes).toBe('Replacement instructions');
    expect(reviewedAsset.secret.text).toContain('notes: second-token');
    expect(reviewedAsset.secret.text).not.toContain('Replacement instructions');
    act(() => result.current.importer.reviewAsset('accept', asset()));
    act(() =>
      result.current.importer.assignAsset(
        result.current.importer.unassigned[0]!,
        result.current.importer.plans[0]!,
      ),
    );
    const draft = result.current.workspace.plansByClientId['plan-1']!.assets[0]!;
    expect(materialiseAsset(draft, session).asset).toMatchObject({
      meta: reviewedAsset.meta,
      secret: reviewedAsset.secret,
    });
    act(() => result.current.importer.mapAssetField(asset(), 'secret.text', 'field-new-note'));
    act(() => result.current.importer.mapAssetField(asset(), 'secret.text', undefined));
    const reset = result.current.workspace.plansByClientId['plan-1']!.assets[0]!;
    const projected = result.current.importer.suggestions[0]!;
    expect(materialiseAsset(reset, session).asset).toMatchObject({
      meta: materialiseAsset({ ...reset, fieldBindings: projected.fieldBindings }, session).asset
        .meta,
      secret: materialiseAsset({ ...reset, fieldBindings: projected.fieldBindings }, session).asset
        .secret,
    });
    expect(materialiseAsset(reset, session).asset.secret.text).toContain('notes: second-token');
    expect(materialiseAsset(reset, session).asset.secret.text).not.toContain(
      'Replacement instructions',
    );
  });
  it('restores converted note source after structured remap without changing the companion', () => {
    const session = importSession();
    session.sources[0]!.kind = 'onepassword';
    session.fieldsById['field-token'].name = 'password';
    session.fieldsById['field-other'].name = 'notes';
    session.nodesById['entry-1']!.fieldIds.push('field-new-note');
    session.fieldsById['field-new-note'] = {
      id: 'field-new-note',
      sourceId: 'source-1',
      parentNodeId: 'entry-1',
      sourcePath: ['entry-1', 'new note'],
      name: 'extra:new note',
      value: new SensitiveValue('Replacement instructions'),
      metadata: {},
    };
    const initialWorkspace = createPlan(createEmptyWorkspace(), {
      clientId: 'plan-1',
      name: 'Partner Plan',
    });
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(initialWorkspace);
      return { workspace, importer: useImporterWorkspace(session, workspace, setWorkspace) };
    });
    const primary = () =>
      result.current.importer.assets.find((asset) => asset.id === 'entry-1:PLAIN-TEXT')!;
    act(() =>
      result.current.importer.mapAssetField(
        result.current.importer.assets.find((asset) => asset.type === 'USER-PSWD')!,
        'meta.notes',
        'field-new-note',
      ),
    );
    act(() =>
      result.current.importer.reviewAsset(
        'alternate:PLAIN-TEXT',
        result.current.importer.assets.find((asset) => asset.type === 'USER-PSWD')!,
      ),
    );
    act(() => result.current.importer.reviewAsset('accept', primary()));
    act(() =>
      result.current.importer.assignAsset(
        result.current.importer.unassigned.find((asset) => asset.id === primary().id)!,
        result.current.importer.plans[0]!,
      ),
    );
    act(() => result.current.importer.mapAssetField(primary(), 'meta.notes', undefined));
    const reviewed = result.current.importer.suggestions.find(
      (asset) => asset.type === 'PLAIN-TEXT' && !asset.variant,
    )!;
    const draft = result.current.workspace.plansByClientId['plan-1']!.assets[0]!;
    const reviewedValue = materialiseAsset(
      { ...draft, fieldBindings: reviewed.fieldBindings },
      session,
    ).asset;
    const assignedValue = materialiseAsset(draft, session).asset;
    expect(reviewedValue.meta.notes).toBeUndefined();
    expect(reviewedValue.secret.text).toContain('new note: Replacement instructions');
    expect(assignedValue.secret).toEqual(reviewedValue.secret);
    expect(assignedValue.meta.notes).toBeUndefined();
    const companion = result.current.importer.suggestions.find(
      (asset) => asset.variant === 'additional-fields',
    )!;
    const companionValue = materialiseAsset(
      {
        id: 'companion',
        type: 'PLAIN-TEXT',
        name: companion.name,
        fieldBindings: companion.fieldBindings,
      },
      session,
    ).asset;
    expect(companionValue.secret.text).toBe('second-token');
  });
  it('still matches a single generic suggestion to a legacy source-bound draft', () => {
    const session = importSession();
    const suggestion = sourceSuggestions(session)[0]!;
    expect(
      assetMatchesSuggestion(
        session,
        {
          id: 'legacy-asset',
          type: 'API-KEY',
          name: 'Partner',
          fieldBindings: {
            'secret.apiKey': { kind: 'source', sourceFieldId: 'field-token' },
          },
        },
        suggestion,
      ),
    ).toBe(true);
  });
  it('keeps generic notes companions independent after overlapping remaps', () => {
    const session = importSession();
    session.fieldsById['field-other'].name = 'notes';
    const initialWorkspace = createPlan(createEmptyWorkspace(), {
      clientId: 'plan-1',
      name: 'Partner Plan',
    });
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(initialWorkspace);
      return { workspace, importer: useImporterWorkspace(session, workspace, setWorkspace) };
    });
    const primaryId = 'entry-1:API-KEY';
    const companionId = 'entry-1:PLAIN-TEXT-ADDITIONAL';
    for (const id of [primaryId, companionId]) {
      const asset = result.current.importer.assets.find((item) => item.id === id)!;
      act(() => result.current.importer.reviewAsset('accept', asset));
      act(() =>
        result.current.importer.assignAsset(
          result.current.importer.unassigned.find((item) => item.id === id)!,
          result.current.importer.plans[0]!,
        ),
      );
    }
    expect(
      result.current.workspace.plansByClientId['plan-1']!.assets.map((item) => item.id),
    ).toEqual([primaryId, companionId]);
    act(() =>
      result.current.importer.mapAssetField(
        result.current.importer.assets.find((item) => item.id === primaryId)!,
        'secret.apiKey',
        'field-other',
      ),
    );
    const companion = result.current.importer.assets.find((item) => item.id === companionId)!;
    expect(companion.status).toBe('accepted');
    act(() => result.current.importer.reviewAsset('exclude', companion));
    expect(
      result.current.workspace.plansByClientId['plan-1']!.assets.map((item) => item.id),
    ).toEqual([primaryId]);
  });
  it('reviews and stages notes without treating notes as a secret field', () => {
    const session = importSession();
    const initialWorkspace = createPlan(createEmptyWorkspace(), {
      clientId: 'plan-1',
      name: 'Partner Plan',
    });
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(initialWorkspace);
      return { workspace, importer: useImporterWorkspace(session, workspace, setWorkspace) };
    });
    const asset = () => result.current.importer.assets[0]!;
    act(() => result.current.importer.mapAssetField(asset(), 'meta.notes', 'field-other'));
    expect(asset().schemaFields?.find((field) => field.key === 'meta.notes')).toEqual(
      expect.objectContaining({
        label: 'Notes or guidelines',
        sourceFieldId: 'field-other',
      }),
    );
    expect(JSON.stringify(asset())).not.toContain('second-token');
    act(() => result.current.importer.reviewAsset('accept', asset()));
    act(() =>
      result.current.importer.assignAsset(
        result.current.importer.unassigned[0]!,
        result.current.importer.plans[0]!,
      ),
    );
    const draft = result.current.workspace.plansByClientId['plan-1']!.assets[0]!;
    expect(draft.fieldBindings['meta.notes']).toEqual({
      kind: 'source',
      sourceFieldId: 'field-other',
    });
    expect(buildStagedAssetInput(materialiseAsset(draft, session).asset).fields).toContainEqual({
      fieldId: 'meta.notes',
      value: 'second-token',
    });
    const notesOnly = {
      ...asset(),
      schemaFields: asset().schemaFields?.filter((field) => field.key === 'meta.notes'),
    };
    expect(hasIncludedSchemaField(notesOnly)).toBe(false);
  });
  it('restores only primary fields after remapping converted 1Password text', () => {
    const session = importSession();
    session.sources[0]!.kind = 'onepassword';
    session.nodesById['entry-1']!.fieldIds.push('field-notes');
    session.fieldsById['field-notes'] = {
      id: 'field-notes',
      sourceId: 'source-1',
      parentNodeId: 'entry-1',
      sourcePath: ['entry-1', 'notes'],
      name: 'notes',
      value: new SensitiveValue('Instructions'),
      metadata: {},
    };
    const initialWorkspace = createPlan(createEmptyWorkspace(), {
      clientId: 'plan-1',
      name: 'Partner Plan',
    });
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(initialWorkspace);
      return { workspace, importer: useImporterWorkspace(session, workspace, setWorkspace) };
    });
    act(() =>
      result.current.importer.reviewAsset(
        'alternate:PLAIN-TEXT',
        result.current.importer.assets.find((asset) => asset.type === 'API-KEY')!,
      ),
    );
    const primary = () =>
      result.current.importer.assets.find((asset) => asset.id === 'entry-1:PLAIN-TEXT')!;
    act(() => result.current.importer.reviewAsset('accept', primary()));
    act(() =>
      result.current.importer.assignAsset(
        result.current.importer.unassigned.find((asset) => asset.id === primary().id)!,
        result.current.importer.plans[0]!,
      ),
    );
    act(() => result.current.importer.mapAssetField(primary(), 'secret.text', 'field-other'));
    act(() => result.current.importer.mapAssetField(primary(), 'secret.text', undefined));

    const draft = result.current.workspace.plansByClientId['plan-1']!.assets[0]!;
    const reviewed = result.current.importer.suggestions.find(
      (item) => item.fromNodeId === 'entry-1' && item.type === 'PLAIN-TEXT' && !item.variant,
    )!;
    expect(draft.fieldBindings['secret.text']).toEqual(reviewed.fieldBindings['secret.text']);
    expect(materialiseAsset(draft, session).asset.secret.text).toBe('first-token');
    expect(draft.fieldBindings['meta.notes']).toEqual({
      kind: 'source',
      sourceFieldId: 'field-notes',
    });
    expect(materialiseAsset(draft, session).asset.meta.notes).toBe('Instructions');
  });
  it('resets companion mapping from structured fields after the primary becomes edited Plain Text', () => {
    const session = importSession();
    session.sources[0]!.kind = 'onepassword';
    const initialWorkspace = createPlan(createEmptyWorkspace(), {
      clientId: 'plan-1',
      name: 'Partner Plan',
    });
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(initialWorkspace);
      return { workspace, importer: useImporterWorkspace(session, workspace, setWorkspace) };
    });
    const primary = () =>
      result.current.importer.assets.find((asset) => asset.id === 'entry-1:PLAIN-TEXT')!;
    const companion = () =>
      result.current.importer.assets.find((asset) => asset.id === 'entry-1:PLAIN-TEXT-ADDITIONAL')!;
    act(() =>
      result.current.importer.reviewAsset(
        'alternate:PLAIN-TEXT',
        result.current.importer.assets[0]!,
      ),
    );
    act(() => result.current.importer.editPlainText(primary(), 'Edited credential'));
    act(() => result.current.importer.reviewAsset('accept', companion()));
    act(() =>
      result.current.importer.assignAsset(
        result.current.importer.unassigned.find((asset) => asset.id === companion().id)!,
        result.current.importer.plans[0]!,
      ),
    );
    act(() => result.current.importer.mapAssetField(companion(), 'secret.text', 'field-token'));
    act(() => result.current.importer.mapAssetField(companion(), 'secret.text', undefined));

    const reviewed = result.current.importer.suggestions.find(
      (item) => item.variant === 'additional-fields',
    )!;
    const draft = result.current.workspace.plansByClientId['plan-1']!.assets[0]!;
    expect(draft.fieldBindings['secret.text']).toEqual(reviewed.fieldBindings['secret.text']);
    expect(materialiseAsset(draft, session).asset.secret.text).toBe('second-token');
  });
  it('resets an assigned companion mapping to its unmatched fields only', () => {
    const session = importSession();
    session.sources[0]!.kind = 'onepassword';
    const initialWorkspace = createPlan(createEmptyWorkspace(), {
      clientId: 'plan-1',
      name: 'Partner Plan',
    });
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(initialWorkspace);
      return { workspace, importer: useImporterWorkspace(session, workspace, setWorkspace) };
    });
    const companion = () =>
      result.current.importer.assets.find((asset) => asset.id === 'entry-1:PLAIN-TEXT-ADDITIONAL')!;
    act(() => result.current.importer.reviewAsset('accept', companion()));
    act(() =>
      result.current.importer.assignAsset(
        result.current.importer.unassigned[0]!,
        result.current.importer.plans[0]!,
      ),
    );
    act(() => result.current.importer.mapAssetField(companion(), 'secret.text', 'field-token'));
    act(() => result.current.importer.mapAssetField(companion(), 'secret.text', undefined));

    const reviewed = result.current.importer.suggestions.find(
      (item) => item.variant === 'additional-fields',
    )!;
    const draft = result.current.workspace.plansByClientId['plan-1']!.assets[0]!;
    expect(draft.fieldBindings['secret.text']).toEqual(reviewed.fieldBindings['secret.text']);
    expect(materialiseAsset(draft, session).asset.secret.text).toBe('second-token');
  });
  it('preserves an edited companion value when the structured mapping changes', () => {
    const session = importSession();
    session.sources[0]!.kind = 'onepassword';
    const initialWorkspace = createPlan(createEmptyWorkspace(), {
      clientId: 'plan-1',
      name: 'Partner Plan',
    });
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(initialWorkspace);
      return { workspace, importer: useImporterWorkspace(session, workspace, setWorkspace) };
    });
    const companion = () =>
      result.current.importer.assets.find((asset) => asset.id === 'entry-1:PLAIN-TEXT-ADDITIONAL')!;
    act(() => result.current.importer.editPlainText(companion(), 'Reviewed additional context'));
    act(() => result.current.importer.reviewAsset('accept', companion()));
    act(() =>
      result.current.importer.assignAsset(
        result.current.importer.unassigned[0]!,
        result.current.importer.plans[0]!,
      ),
    );
    act(() =>
      result.current.importer.mapAssetField(
        result.current.importer.assets.find((asset) => asset.type === 'API-KEY')!,
        'secret.apiKey',
        'field-other',
      ),
    );

    const draft = result.current.workspace.plansByClientId['plan-1']!.assets[0]!;
    expect(companion().plainTextValue?.reveal()).toBe('Reviewed additional context');
    expect(materialiseAsset(draft, session).asset.secret.text).toBe('Reviewed additional context');
  });
  it('moves a displaced 1Password field into the reviewed and assigned companion', () => {
    const session = importSession();
    session.sources[0]!.kind = 'onepassword';
    const initialWorkspace = createPlan(createEmptyWorkspace(), {
      clientId: 'plan-1',
      name: 'Partner Plan',
    });
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(initialWorkspace);
      return { workspace, importer: useImporterWorkspace(session, workspace, setWorkspace) };
    });
    for (const asset of result.current.importer.assets) {
      act(() => result.current.importer.reviewAsset('accept', asset));
    }
    for (const asset of [...result.current.importer.unassigned]) {
      act(() => result.current.importer.assignAsset(asset, result.current.importer.plans[0]!));
    }
    act(() =>
      result.current.importer.mapAssetField(
        result.current.importer.assets.find((asset) => asset.type === 'API-KEY')!,
        'secret.apiKey',
        'field-other',
      ),
    );

    const companion = result.current.importer.suggestions.find(
      (item) => item.variant === 'additional-fields',
    )!;
    expect(companion.fieldBindings['secret.text']).toEqual({
      kind: 'source',
      sourceFieldId: 'field-token',
    });
    const drafts = result.current.workspace.plansByClientId['plan-1']!.assets;
    expect(
      drafts.map((draft) => [draft.id, materialiseAsset(draft, session).asset.secret]),
    ).toEqual(
      expect.arrayContaining([
        ['entry-1:API-KEY', expect.objectContaining({ apiKey: 'second-token' })],
        ['entry-1:PLAIN-TEXT-ADDITIONAL', { text: 'first-token' }],
      ]),
    );
  });
  it('keeps a remapped 1Password conversion equal to its assigned draft', () => {
    const session = importSession();
    session.sources[0]!.kind = 'onepassword';
    const initialWorkspace = createPlan(createEmptyWorkspace(), {
      clientId: 'plan-1',
      name: 'Partner Plan',
    });
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(initialWorkspace);
      return { workspace, importer: useImporterWorkspace(session, workspace, setWorkspace) };
    });
    act(() =>
      result.current.importer.mapAssetField(
        result.current.importer.assets[0]!,
        'secret.apiKey',
        'field-other',
      ),
    );
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

    const draft = result.current.workspace.plansByClientId['plan-1']!.assets[0]!;
    const reviewed = result.current.importer.suggestions.find(
      (item) => item.fromNodeId === 'entry-1' && item.type === 'PLAIN-TEXT' && !item.variant,
    )!;
    expect(draft.fieldBindings['secret.text']).toEqual(reviewed.fieldBindings['secret.text']);
    expect(materialiseAsset(draft, session).asset.secret.text).toBe('second-token');
  });
  for (const companionFirst of [false, true]) {
    it(`keeps 1Password additional fields separate when converting with companion ${companionFirst ? 'first' : 'second'}`, () => {
      const session = importSession();
      session.sources[0]!.kind = 'onepassword';
      const initialWorkspace = createPlan(createEmptyWorkspace(), {
        clientId: 'plan-1',
        name: 'Partner Plan',
      });
      const { result } = renderHook(() => {
        const [workspace, setWorkspace] = useState(initialWorkspace);
        return { workspace, importer: useImporterWorkspace(session, workspace, setWorkspace) };
      });
      expect(result.current.importer.assets.map((asset) => asset.id)).toEqual([
        'entry-1:API-KEY',
        'entry-1:PLAIN-TEXT-ADDITIONAL',
      ]);
      const assign = (id: string) => {
        const asset = result.current.importer.assets.find((item) => item.id === id)!;
        act(() => result.current.importer.reviewAsset('accept', asset));
        const unassigned = result.current.importer.unassigned.find((item) => item.id === id)!;
        act(() =>
          result.current.importer.assignAsset(unassigned, result.current.importer.plans[0]!),
        );
      };
      const companionId = 'entry-1:PLAIN-TEXT-ADDITIONAL';
      if (companionFirst) assign(companionId);
      assign('entry-1:API-KEY');
      if (!companionFirst) assign(companionId);
      act(() =>
        result.current.importer.reviewAsset(
          'alternate:PLAIN-TEXT',
          result.current.importer.assets.find((item) => item.type === 'API-KEY')!,
        ),
      );

      const drafts = result.current.workspace.plansByClientId['plan-1']!.assets;
      expect(drafts.map((draft) => draft.id).sort()).toEqual(
        ['entry-1:PLAIN-TEXT', companionId].sort(),
      );
      expect(
        drafts.find((draft) => draft.id === 'entry-1:PLAIN-TEXT')?.fieldBindings['secret.text'],
      ).toEqual({
        kind: 'source',
        sourceFieldId: 'field-token',
      });
      expect(
        drafts.find((draft) => draft.id === companionId)?.fieldBindings['secret.text'],
      ).toEqual({
        kind: 'source',
        sourceFieldId: 'field-other',
      });
      expect(
        drafts.map((draft) => [draft.id, materialiseAsset(draft, session).asset.secret.text]),
      ).toEqual(
        expect.arrayContaining([
          ['entry-1:PLAIN-TEXT', 'first-token'],
          [companionId, 'second-token'],
        ]),
      );
      act(() =>
        result.current.importer.reviewAsset(
          'restore-suggestion',
          result.current.importer.assets.find((item) => item.id === 'entry-1:PLAIN-TEXT')!,
        ),
      );
      expect(
        result.current.workspace.plansByClientId['plan-1']!.assets.map((draft) => draft.id).sort(),
      ).toEqual(['entry-1:API-KEY', companionId].sort());
    });
  }
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
