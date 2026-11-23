// @vitest-environment happy-dom
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { SensitiveValue, type ImportSession } from '@modules/import/domain/import-model';
import { useImporterWorkspace } from '@modules/importer-preview/ImporterFlow/application/importer-workspace';
import { getImporterFlowReadiness } from '@modules/importer-preview/ImporterFlow/application/flow-readiness';
import { AssetReviewQueue } from '@modules/importer-preview/AssetReviewQueue';
import { createEmptyWorkspace } from '@modules/plans/domain/workspace-model';
import { createAsset, createPlan } from '@modules/plans/domain/workspace-commands';
import { materialiseAsset } from '@modules/plans/domain/asset-materializer';
import { buildStagedAssetInput } from '@modules/batch/infrastructure/importer-tool-repo';
import type { SuggestedAsset } from '@modules/mapping/domain/suggestion';
import { projectAssets } from '@modules/importer-preview/ImporterFlow/application/importer-workspace-review-projection';
import { hasIncludedSchemaField } from '@modules/importer-preview/AssetReviewQueue/types';
import {
  applyMappingOverrides,
  assetMatchesSuggestion,
  convertToCanonicalType,
  sourceSuggestions,
} from '@modules/importer-preview/ImporterFlow/application/importer-workspace-suggestions';
import {
  createHistory,
  pushHistory,
  replaceHistory,
  canUndo,
  resetHistory,
  undo,
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

function workspaceWithLegacyCompanion() {
  return createAsset(
    createPlan(createEmptyWorkspace(), { clientId: 'plan-1', name: 'Partner Plan' }),
    {
      planClientId: 'plan-1',
      asset: {
        id: 'entry-1:PLAIN-TEXT-ADDITIONAL',
        type: 'PLAIN-TEXT',
        name: 'Partner — additional fields',
        fieldBindings: { 'secret.text': { kind: 'source', sourceFieldId: 'field-other' } },
      },
    },
  );
}

it('computes a metadata-only review signature once per source node', () => {
  const session = importSession();
  const entry = session.nodesById['entry-1']!;
  const readFieldType = vi.fn(() => 'concealed');
  session.fieldsById['field-token']!.metadata = {
    get sourceFieldType() {
      return readFieldType();
    },
    sourceSection: 'Credentials',
    sourceSectionIdentity: '0',
  };
  session.nodesById['entry-2'] = {
    ...entry,
    id: 'entry-2',
    fieldIds: ['field-other-2', 'field-token-2'],
  };
  session.fieldsById['field-other-2'] = {
    ...session.fieldsById['field-other']!,
    id: 'field-other-2',
    parentNodeId: 'entry-2',
    value: new SensitiveValue('different-other-value'),
  };
  session.fieldsById['field-token-2'] = {
    ...session.fieldsById['field-token']!,
    id: 'field-token-2',
    parentNodeId: 'entry-2',
    metadata: {
      sourceFieldType: 'concealed',
      sourceSection: 'Credentials',
      sourceSectionIdentity: '0',
    },
    value: new SensitiveValue('different-token-value'),
  };
  const first: SuggestedAsset = {
    id: 'first',
    type: 'API-KEY',
    name: 'First',
    fromNodeId: entry.id,
    confidence: 1,
    rationale: '',
    fieldBindings: {},
  };
  const project = () =>
    projectAssets(
      session,
      [
        first,
        { ...first, id: 'sibling', type: 'USER-PSWD' },
        { ...first, id: 'separate', fromNodeId: 'entry-2' },
      ],
      createEmptyWorkspace(),
      {},
      new Set(),
      {},
      {},
      {},
      undefined,
      [],
    );
  const [a, b, c] = project().map(({ sourcePatternKey }) => sourcePatternKey);
  expect(readFieldType).toHaveBeenCalledOnce();
  expect(a).toBeDefined();
  expect([b, c]).toEqual([a, a]);
  expect(a).not.toContain('first-token');
  expect(a).not.toContain('different-token-value');
  session.fieldsById['field-token-2']!.metadata.sourceSectionIdentity = '1';
  expect(project()[2]?.sourcePatternKey).not.toBe(a);
});

it('clears suggestion evidence after manual canonical reclassification', () => {
  const session = importSession();
  const evidence = ['native-role'] as const;
  const original: SuggestedAsset = {
    name: 'API Key',
    fromNodeId: 'entry-1',
    type: 'API-KEY',
    confidence: 1,
    rationale: '',
    fieldBindings: { 'secret.apiKey': { kind: 'source', sourceFieldId: 'field-token' } },
    evidence,
  };

  const typed = convertToCanonicalType(session, original, 'USER-PSWD', false);
  const text = convertToCanonicalType(session, original, 'PLAIN-TEXT', false);

  expect(typed.type).toBe('USER-PSWD');
  expect(typed.evidence).toBeUndefined();
  expect(text.type).toBe('PLAIN-TEXT');
  expect(text.evidence).toBeUndefined();
  expect(original.evidence).toBe(evidence);
});

it('clears suggestion evidence only when a manual override changes a binding', () => {
  const original: SuggestedAsset = {
    id: 'manual-override',
    name: 'API Key',
    fromNodeId: 'entry-1',
    type: 'API-KEY',
    confidence: 1,
    rationale: '',
    fieldBindings: { 'secret.apiKey': { kind: 'source', sourceFieldId: 'field-token' } },
    evidence: ['native-role'],
  };
  const apply = (changes: Record<string, string | undefined>) =>
    applyMappingOverrides(original, { 'manual-override': changes });

  expect(apply({ 'secret.apiKey': 'field-token', 'meta.notes': undefined })).toBe(original);
  expect(apply({ 'secret.apiKey': 'field-other' })).toMatchObject({
    fieldBindings: { 'secret.apiKey': { kind: 'source', sourceFieldId: 'field-other' } },
    evidence: undefined,
  });
  expect(apply({ 'secret.apiKey': undefined })).toMatchObject({
    fieldBindings: {},
    evidence: undefined,
  });
  expect(original.evidence).toEqual(['native-role']);
});

describe('useImporterWorkspace schema mapping lifecycle', () => {
  it('accepts eligible pending assets in one decision update and restores them with Undo', () => {
    const session = importSession();
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(createEmptyWorkspace);
      return useImporterWorkspace(session, workspace, setWorkspace);
    });
    const eligible = result.current.assets.filter((asset) => hasIncludedSchemaField(asset));
    expect(eligible.length).toBeGreaterThan(0);
    act(() => expect(result.current.acceptAllEligible()).toBe(eligible.length));
    expect(result.current.assets.filter((asset) => asset.status === 'accepted')).toHaveLength(
      eligible.length,
    );
    act(() => result.current.undoAcceptAll());
    expect(result.current.assets.filter((asset) => asset.status === 'accepted')).toHaveLength(0);
  });

  it('preserves a later individual decision while undoing the rest of a bulk review', () => {
    const session = importSession();
    session.rootNodeIds.push('entry-2');
    session.nodesById['entry-2'] = {
      ...session.nodesById['entry-1']!,
      id: 'entry-2',
      name: 'Other',
      fieldIds: ['field-token-2', 'field-other-2'],
    };
    session.fieldsById['field-token-2'] = {
      ...session.fieldsById['field-token']!,
      id: 'field-token-2',
      parentNodeId: 'entry-2',
    };
    session.fieldsById['field-other-2'] = {
      ...session.fieldsById['field-other']!,
      id: 'field-other-2',
      parentNodeId: 'entry-2',
    };
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(createEmptyWorkspace);
      return useImporterWorkspace(session, workspace, setWorkspace);
    });
    const eligible = result.current.assets.filter(hasIncludedSchemaField);
    expect(eligible.map((asset) => asset.id)).toEqual(['entry-1:API-KEY', 'entry-2:API-KEY']);
    act(() => result.current.acceptAllEligible());
    act(() => result.current.reviewAsset('exclude', result.current.assets[0]!));
    act(() => result.current.reviewAsset('restore', result.current.assets[0]!));
    act(() => result.current.reviewAsset('accept', result.current.assets[0]!));
    act(() => result.current.undoAcceptAll());
    expect(result.current.assets[0]?.status).toBe('accepted');
    expect(result.current.assets[1]?.status).not.toBe('accepted');
  });

  it('clears plan history after excluding an assigned asset so Undo cannot restore it', () => {
    const session = importSession();
    const initial = createPlan(createEmptyWorkspace(), { clientId: 'plan-1', name: 'Plan' });
    const { result } = renderHook(() => {
      const [history, setHistory] = useState(createHistory(initial));
      const setWorkspace = (next: typeof initial | ((current: typeof initial) => typeof initial)) =>
        setHistory((current) =>
          pushHistory(current, typeof next === 'function' ? next(current.present) : next),
        );
      return {
        history,
        setHistory,
        importer: useImporterWorkspace(session, history.present, setWorkspace, undefined, () =>
          setHistory((current) => resetHistory(current)),
        ),
      };
    });
    act(() => result.current.importer.reviewAsset('accept', result.current.importer.assets[0]!));
    act(() =>
      result.current.importer.assignAsset(
        result.current.importer.unassigned[0]!,
        result.current.importer.plans[0]!,
      ),
    );
    expect(canUndo(result.current.history)).toBe(true);
    act(() => result.current.importer.reviewAsset('exclude', result.current.importer.assets[0]!));
    expect(result.current.importer.assets[0]?.status).toBe('excluded');
    expect(result.current.history.present.plansByClientId['plan-1']?.assets).toHaveLength(0);
    expect(canUndo(result.current.history)).toBe(false);
    act(() => result.current.setHistory(undo));
    expect(result.current.history.present.plansByClientId['plan-1']?.assets).toHaveLength(0);
  });
  it('refreshes revealed Plain Text after returning native Notes to protected text', () => {
    const session = importSession();
    session.sources[0]!.kind = 'onepassword';
    session.fieldsById['field-token'].name = 'extra:private key';
    session.fieldsById['field-other'].name = 'notes';
    let latest!: ReturnType<typeof useImporterWorkspace>;
    function Review() {
      const [planWorkspace, setPlanWorkspace] = useState(createEmptyWorkspace);
      const workspace = useImporterWorkspace(session, planWorkspace, setPlanWorkspace);
      latest = workspace;
      return (
        <AssetReviewQueue
          assets={workspace.assets}
          onMapField={workspace.mapAssetField}
          onEditPlainText={workspace.editPlainText}
          resolveSourceValue={workspace.resolveSourceValue}
        />
      );
    }
    render(<Review />);
    act(() => latest.setSourceNoteDestination('source-1', 'asset-notes'));
    fireEvent.click(screen.getByRole('button', { name: 'Reveal plain text' }));
    expect((screen.getByLabelText('Plain text value') as HTMLTextAreaElement).value).toBe(
      'first-token',
    );
    act(() => latest.setSourceNoteDestination('source-1', 'protected'));
    const reveal = screen.queryByRole('button', { name: 'Reveal plain text' });
    if (reveal) fireEvent.click(reveal);
    const editor = screen.getByLabelText('Plain text value') as HTMLTextAreaElement;
    expect(editor.value).toContain('notes: second-token');
    fireEvent.change(editor, { target: { value: `${editor.value}\nReviewed` } });
    expect((screen.getByLabelText('Plain text value') as HTMLTextAreaElement).value).toContain(
      'notes: second-token',
    );
    const suggestion = latest.suggestions[0]!;
    const staged = buildStagedAssetInput(
      materialiseAsset(
        {
          id: 'reviewed',
          type: suggestion.type,
          name: suggestion.name,
          fieldBindings: suggestion.fieldBindings,
        },
        session,
      ).asset,
    );
    expect(staged.fields).toContainEqual({
      fieldId: 'secret.text',
      value: 'private key: first-token\nnotes: second-token\nReviewed',
    });
  });
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
    expect(asset().note).toMatchObject({ destination: 'asset-notes', inherited: true });
    act(() => result.current.importer.setSourceNoteDestination('source-1', 'protected'));
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
    act(() => result.current.importer.setAssetNoteDestination(asset(), 'asset-notes'));
    expect(result.current.workspace.plansByClientId['plan-1']!.assets).toHaveLength(0);
    act(() => result.current.importer.reviewAsset('accept', asset()));
    act(() =>
      result.current.importer.assignAsset(
        result.current.importer.unassigned.find((item) => item.id === asset().id)!,
        result.current.importer.plans[0]!,
      ),
    );
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
    act(() => result.current.importer.setAssetNoteDestination(asset(), 'protected'));
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
    act(() => result.current.importer.setAssetNoteDestination(asset(), 'asset-notes'));
    expect(result.current.workspace.plansByClientId['plan-1']!.assets).toHaveLength(0);
    act(() => result.current.importer.reviewAsset('accept', asset()));
    act(() =>
      result.current.importer.assignAsset(
        result.current.importer.unassigned.find((item) => item.id === asset().id)!,
        result.current.importer.plans[0]!,
      ),
    );
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
  it('keeps both note occurrences protected after removing a converted asset’s manual note mapping', () => {
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
    act(() => result.current.importer.setSourceNoteDestination('source-1', 'protected'));
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
    expect(assignedValue.secret.text).toContain('notes: second-token');
    expect(result.current.importer.suggestions.some((asset) => asset.variant)).toBe(false);
  });
  it('shows the mapped destination of a legacy source-bound draft as the current asset', () => {
    const session = importSession();
    const draft = {
      id: 'legacy-asset',
      type: 'API-KEY' as const,
      name: 'Partner',
      fieldBindings: {
        'secret.apiKey': { kind: 'source' as const, sourceFieldId: 'field-token' },
      },
    };
    expect(assetMatchesSuggestion(session, draft, sourceSuggestions(session)[0]!)).toBe(true);
    const initialWorkspace = createAsset(
      createPlan(createEmptyWorkspace(), { clientId: 'plan-1', name: 'Partner Plan' }),
      { planClientId: 'plan-1', asset: draft },
    );
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(initialWorkspace);
      return useImporterWorkspace(session, workspace, setWorkspace);
    });
    const primary = result.current.assets.find((asset) => asset.type === 'API-KEY')!;
    expect(
      result.current.coverage.fields.find(({ id }) => id === 'field-token')?.destinations,
    ).toEqual([{ assetId: draft.id, fieldId: 'secret.apiKey', valid: true }]);
    const view = render(
      <AssetReviewQueue
        assets={result.current.assets}
        selectedId={primary.id}
        preservation={{
          coverage: result.current.coverage,
          noteSources: result.current.noteSources,
        }}
      />,
    );
    fireEvent.click(
      within(view.container).getByRole('button', { name: /^Accepted/, pressed: false }),
    );
    const fields = within(within(view.container).getByRole('region', { name: 'Source fields' }));
    expect(fields.getByText('Mapped · This asset · API key')).toBeTruthy();
    expect(fields.queryByText('Preserved in an additional asset · Mapped')).toBeNull();
    fireEvent.click(within(view.container).getByRole('button', { name: 'View asset issues' }));
    const details = within(view.getByRole('dialog', { name: 'Partner — Issues' }));
    expect(details.getByText('other')).toBeTruthy();
    expect(details.getByText('No destination is assigned.')).toBeTruthy();
    expect(details.queryByText('Mapped · This asset · API key')).toBeNull();
    view.unmount();
  });
  it('keeps generic notes companions independent after overlapping remaps', () => {
    const session = importSession();
    session.fieldsById['field-other'].name = 'notes';
    const initialWorkspace = workspaceWithLegacyCompanion();
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(initialWorkspace);
      return { workspace, importer: useImporterWorkspace(session, workspace, setWorkspace) };
    });
    const primaryId = 'entry-1:API-KEY';
    const companionId = 'entry-1:PLAIN-TEXT-ADDITIONAL';
    for (const id of [primaryId]) {
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
    ).toEqual([companionId, primaryId]);
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
    const initialWorkspace = workspaceWithLegacyCompanion();
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

    const draft = result.current.workspace.plansByClientId['plan-1']!.assets.find(
      (asset) => asset.id === primary().id,
    )!;
    const reviewed = result.current.importer.suggestions.find(
      (item) => item.fromNodeId === 'entry-1' && item.type === 'PLAIN-TEXT' && !item.variant,
    )!;
    expect(draft.fieldBindings['secret.text']).toEqual(reviewed.fieldBindings['secret.text']);
    expect(materialiseAsset(draft, session).asset).toMatchObject({
      secret: { text: 'first-token' },
      meta: { notes: 'Instructions' },
    });
    expect(
      result.current.importer.suggestions.find((asset) => asset.variant)?.fieldBindings[
        'secret.text'
      ],
    ).toEqual({ kind: 'source', sourceFieldId: 'field-other' });
  });
  it('resets companion mapping from structured fields after the primary becomes edited Plain Text', () => {
    const session = importSession();
    session.sources[0]!.kind = 'onepassword';
    const initialWorkspace = workspaceWithLegacyCompanion();
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
    act(() => result.current.importer.mapAssetField(companion(), 'secret.text', 'field-token'));
    act(() => result.current.importer.mapAssetField(companion(), 'secret.text', undefined));

    const reviewed = result.current.importer.suggestions.find(
      (item) => item.variant === 'additional-fields',
    )!;
    const draft = result.current.workspace.plansByClientId['plan-1']!.assets[0]!;
    expect(draft.fieldBindings['secret.text']).toEqual(reviewed.fieldBindings['secret.text']);
    expect(materialiseAsset(draft, session).asset.secret.text).toBe(
      'token: first-token\nother: second-token',
    );
  });
  it('resets an assigned companion mapping to its unmatched fields only', () => {
    const session = importSession();
    session.sources[0]!.kind = 'onepassword';
    const initialWorkspace = workspaceWithLegacyCompanion();
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(initialWorkspace);
      return { workspace, importer: useImporterWorkspace(session, workspace, setWorkspace) };
    });
    const companion = () =>
      result.current.importer.assets.find((asset) => asset.id === 'entry-1:PLAIN-TEXT-ADDITIONAL')!;
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
    const initialWorkspace = workspaceWithLegacyCompanion();
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(initialWorkspace);
      return { workspace, importer: useImporterWorkspace(session, workspace, setWorkspace) };
    });
    const companion = () =>
      result.current.importer.assets.find((asset) => asset.id === 'entry-1:PLAIN-TEXT-ADDITIONAL')!;
    act(() => result.current.importer.editPlainText(companion(), 'Reviewed additional context'));
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
  it('keeps an assigned companion aligned with the visible uncovered fields across type changes', () => {
    const session = importSession();
    session.sources[0]!.kind = 'onepassword';
    const initialWorkspace = workspaceWithLegacyCompanion();
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(initialWorkspace);
      return { workspace, importer: useImporterWorkspace(session, workspace, setWorkspace) };
    });
    const primary = () =>
      result.current.importer.assets.find(
        (asset) => asset.type === 'API-KEY' || asset.type === 'USER-PSWD',
      )!;
    const companion = () =>
      result.current.importer.assets.find((asset) => asset.id === 'entry-1:PLAIN-TEXT-ADDITIONAL')!;
    act(() => result.current.importer.reviewAsset('alternate:USER-PSWD', primary()));
    const reviewed = result.current.importer.suggestions.find(
      (item) => item.variant === 'additional-fields',
    )!;
    const draft = result.current.workspace.plansByClientId['plan-1'].assets.find(
      (item) => item.id === companion().id,
    )!;
    expect(draft.fieldBindings['secret.text']).toEqual(reviewed.fieldBindings['secret.text']);
    expect(materialiseAsset(draft, session).asset.secret.text).toContain('token: first-token');
    act(() => result.current.importer.mapAssetField(companion(), 'secret.text', 'field-token'));
    act(() => result.current.importer.mapAssetField(companion(), 'secret.text', undefined));
    const resetReview = result.current.importer.suggestions.find(
      (item) => item.variant === 'additional-fields',
    )!;
    const resetDraft = result.current.workspace.plansByClientId['plan-1'].assets.find(
      (item) => item.id === companion().id,
    )!;
    expect(resetDraft.fieldBindings['secret.text']).toEqual(
      resetReview.fieldBindings['secret.text'],
    );
    expect(materialiseAsset(resetDraft, session).asset.secret.text).toContain('token: first-token');
    act(() => result.current.importer.reviewAsset('restore-suggestion', primary()));
    const restored = result.current.importer.suggestions.find(
      (item) => item.variant === 'additional-fields',
    )!;
    const restoredDraft = result.current.workspace.plansByClientId['plan-1'].assets.find(
      (item) => item.id === companion().id,
    )!;
    expect(restoredDraft.fieldBindings['secret.text']).toEqual(
      restored.fieldBindings['secret.text'],
    );
  });
  it('preserves additional-fields identity when a companion returns to Plain Text', () => {
    const session = importSession();
    session.sources[0]!.kind = 'onepassword';
    const initialWorkspace = workspaceWithLegacyCompanion();
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(initialWorkspace);
      return { workspace, importer: useImporterWorkspace(session, workspace, setWorkspace) };
    });
    const companion = () =>
      result.current.importer.assets.find((asset) => asset.id === 'entry-1:PLAIN-TEXT-ADDITIONAL')!;
    act(() =>
      result.current.importer.reviewAsset(
        'alternate:USER-PSWD',
        result.current.importer.assets.find((asset) => asset.type === 'API-KEY')!,
      ),
    );
    act(() => result.current.importer.reviewAsset('alternate:USER-PSWD', companion()));
    expect(companion().type).toBe('USER-PSWD');
    act(() => result.current.importer.reviewAsset('restore-suggestion', companion()));
    expect(companion().type).toBe('PLAIN-TEXT');
    expect(
      result.current.importer.suggestions.find((item) => item.variant === 'additional-fields')
        ?.type,
    ).toBe('PLAIN-TEXT');
    const draft = result.current.workspace.plansByClientId['plan-1'].assets[0]!;
    expect(draft.id).toBe('entry-1:PLAIN-TEXT-ADDITIONAL');
    expect(draft.fieldBindings['secret.text']).toEqual(
      result.current.importer.suggestions.find((item) => item.variant === 'additional-fields')
        ?.fieldBindings['secret.text'],
    );
    expect(materialiseAsset(draft, session).asset.secret.text).toContain('token: first-token');
  });
  it('moves a displaced 1Password field into the reviewed and assigned companion', () => {
    const session = importSession();
    session.sources[0]!.kind = 'onepassword';
    const initialWorkspace = workspaceWithLegacyCompanion();
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
      const initialWorkspace = workspaceWithLegacyCompanion();
      const { result } = renderHook(() => {
        const [workspace, setWorkspace] = useState(initialWorkspace);
        return {
          workspace,
          setWorkspace,
          importer: useImporterWorkspace(session, workspace, setWorkspace),
        };
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
      assign('entry-1:API-KEY');
      if (!companionFirst) {
        act(() =>
          result.current.setWorkspace((workspace) => {
            const plan = workspace.plansByClientId['plan-1']!;
            return {
              ...workspace,
              plansByClientId: {
                ...workspace.plansByClientId,
                'plan-1': { ...plan, assets: [...plan.assets].reverse() },
              },
            };
          }),
        );
      }
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
    const unrelatedAsset = {
      id: 'unrelated',
      name: 'Unrelated',
      type: 'PLAIN-TEXT',
      fieldBindings: {
        'secret.text': { kind: 'literal' as const, value: new SensitiveValue('unrelated value') },
      },
    };
    const onReviewChange = vi.fn();
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(initialWorkspace);
      return {
        workspace,
        setWorkspace,
        importer: useImporterWorkspace(session, workspace, setWorkspace, undefined, onReviewChange),
      };
    });

    const readiness = () => {
      const { assets, plans, unassigned, coverage, executionCoverage } = result.current.importer;
      return getImporterFlowReadiness({
        files: [{ name: 'source.env', format: 'dotenv', status: 'imported' }],
        assets,
        plans,
        unassigned,
        preservationReady: coverage.ready,
        executionCoverageReady: executionCoverage.ready,
      });
    };

    act(() => result.current.importer.reviewAsset('accept', result.current.importer.assets[0]!));
    act(() =>
      result.current.importer.assignAsset(
        result.current.importer.unassigned[0]!,
        result.current.importer.plans[0]!,
      ),
    );
    act(() =>
      result.current.setWorkspace((current) =>
        createAsset(current, { planClientId: 'plan-1', asset: unrelatedAsset }),
      ),
    );
    expect(readiness().staging).toBe(true);
    const before = result.current.importer;
    const operation = before.fieldOperations.preview({
      sourceAssetId: before.assets[0]!.id,
      action: 'plain-text',
      fieldIds: ['field-token'],
    });
    expect(operation.canConfirm).toBe(true);
    act(() =>
      result.current.setWorkspace((current) => ({ ...current, revision: current.revision + 1 })),
    );
    expect(result.current.importer.assets).toBe(before.assets);
    expect(result.current.importer.fieldOperations.commit(operation).success).toBe(false);

    for (const [index, value] of ['e', 'edi', 'edited'].entries()) {
      const previous = result.current.importer;
      act(() => result.current.importer.editPlainText(result.current.importer.assets[0]!, value));
      const current = result.current.importer;
      const draft = result.current.workspace.plansByClientId['plan-1'].assets[0]!;
      expect(result.current.workspace.plansByClientId['plan-1'].assets[1]).toBe(unrelatedAsset);
      expect(current.assets[0]?.plainTextValue?.reveal()).toBe(value);
      expect(current.assets[0]?.plainTextValue).not.toBe(previous.assets[0]?.plainTextValue);
      if (index > 0) expect(current.executionCoverage).toBe(previous.executionCoverage);
      expect(buildStagedAssetInput(materialiseAsset(draft, session).asset).fields).toContainEqual({
        fieldId: 'secret.text',
        value,
      });
    }

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

    onReviewChange.mockClear();
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
    expect(result.current.importer.assets[0]?.status).toBe('suggested');
    expect(result.current.workspace.plansByClientId['plan-1'].assets).toHaveLength(2);
    expect(readiness()).toMatchObject({ assets: false, plans: true, staging: false });
    expect(onReviewChange).toHaveBeenCalled();

    act(() => result.current.importer.reviewAsset('accept', result.current.importer.assets[0]!));
    expect(result.current.importer.assets[0]?.status).toBe('accepted');
    expect(readiness().staging).toBe(true);
  });

  it('shares unchanged review rows until the import session changes', () => {
    const session = importSession();
    session.fieldsById['field-token'].name = 'unknown';
    session.rootNodeIds.push('entry-2');
    session.nodesById['entry-2'] = {
      ...session.nodesById['entry-1']!,
      id: 'entry-2',
      name: 'Other',
      fieldIds: ['field-other-2'],
    };
    session.fieldsById['field-other-2'] = {
      ...session.fieldsById['field-other']!,
      id: 'field-other-2',
      parentNodeId: 'entry-2',
    };
    const replacement = {
      ...session,
      nodesById: {
        ...session.nodesById,
        'entry-1': { ...session.nodesById['entry-1']!, name: 'Replacement' },
      },
    };
    const workspace = createEmptyWorkspace();
    const setWorkspace = vi.fn();
    const { result, rerender } = renderHook(
      ({ currentSession }) => useImporterWorkspace(currentSession, workspace, setWorkspace),
      { initialProps: { currentSession: session } },
    );

    expect(result.current.suggestions[0]?.name).toBe('Partner');
    const unrelated = result.current.assets[1];
    expect(unrelated?.name).toBe('Other');
    act(() => result.current.editPlainText(result.current.assets[0]!, 'edited'));
    expect(result.current.assets[1]).toBe(unrelated);
    rerender({ currentSession: replacement });
    expect(result.current.suggestions[0]?.name).toBe('Replacement');
    expect(result.current.assets[1]).not.toBe(unrelated);
  });

  it('offers canonical types and applies the structured-to-plain-text override', () => {
    const session = importSession();
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(createEmptyWorkspace());
      return useImporterWorkspace(session, workspace, setWorkspace);
    });

    expect(result.current.assets[0]?.alternatives).toContain('PLAIN-TEXT');
    expect(result.current.assets[0]?.alternatives).toContain('USER-PSWD');
    act(() => result.current.reviewAsset('alternate:PLAIN-TEXT', result.current.assets[0]!));
    expect(result.current.assets[0]?.type).toBe('PLAIN-TEXT');
    expect(result.current.assets[0]?.alternatives).toContain('API-KEY');
    expect(
      result.current.assets[0]?.schemaFields?.find((field) => field.key === 'secret.text')
        ?.sourceFieldId,
    ).toBe('field-token');
    expect(result.current.suggestions).toHaveLength(1);
    expect(result.current.assets[0]?.unmappedSourceFieldIds).toEqual(['field-other']);
    expect(JSON.stringify(result.current.assets[0])).not.toContain('first-token');
    act(() => result.current.editPlainText(result.current.assets[0]!, 'edited fallback'));
    expect(result.current.assets[0]?.plainTextValue?.reveal()).toBe('edited fallback');
    act(() => result.current.reviewAsset('accept', result.current.assets[0]!));
    expect(result.current.unassigned[0]?.id).toBe('entry-1:PLAIN-TEXT');
  });

  it('reclassifies to a canonical structured type and requires a valid mapping before acceptance', () => {
    const session = importSession();
    const onReviewChange = vi.fn();
    const { result } = renderHook(() => {
      const [workspace, setWorkspace] = useState(createEmptyWorkspace());
      return useImporterWorkspace(session, workspace, setWorkspace, undefined, onReviewChange);
    });
    const originalType = result.current.assets[0]!.type;
    for (const type of ['UNKNOWN-TYPE', 'DOCUMENT', 'IMAGE', 'VIDEO']) {
      expect(result.current.assets[0]?.alternatives).not.toContain(type);
      act(() => result.current.reviewAsset(`alternate:${type}`, result.current.assets[0]!));
      expect(result.current.assets[0]?.type).toBe(originalType);
    }
    expect(onReviewChange).not.toHaveBeenCalled();
    act(() => result.current.reviewAsset('alternate:USER-PSWD', result.current.assets[0]!));
    expect(result.current.assets[0]?.type).toBe('USER-PSWD');
    expect(
      result.current.assets[0]?.schemaFields?.some((field) => field.key === 'secret.password'),
    ).toBe(true);
    expect(hasIncludedSchemaField(result.current.assets[0]!)).toBe(false);
    act(() => result.current.reviewAsset('accept', result.current.assets[0]!));
    expect(result.current.unassigned).toEqual([]);
    act(() =>
      result.current.mapAssetField(result.current.assets[0]!, 'secret.password', 'field-other'),
    );
    expect(
      result.current.assets[0]?.schemaFields?.find((field) => field.key === 'secret.password')
        ?.sourceFieldId,
    ).toBe('field-other');
    act(() => result.current.reviewAsset(`alternate:${originalType}`, result.current.assets[0]!));
    expect(result.current.assets[0]?.type).toBe(originalType);
    act(() => result.current.reviewAsset('alternate:USER-PSWD', result.current.assets[0]!));
    expect(
      result.current.assets[0]?.schemaFields?.find((field) => field.key === 'secret.password')
        ?.sourceFieldId,
    ).toBe('field-other');
  });

  it('replaces an assigned draft when its canonical type changes and restores the original binding', () => {
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
        'alternate:USER-PSWD',
        result.current.importer.assets[0]!,
      ),
    );
    expect(result.current.workspace.plansByClientId['plan-1'].assets[0]?.type).toBe('USER-PSWD');
    expect(result.current.importer.assets[0]?.status).toBe('needs-review');
    act(() =>
      result.current.importer.mapAssetField(
        result.current.importer.assets[0]!,
        'secret.password',
        'field-other',
      ),
    );
    act(() =>
      result.current.importer.reviewAsset('restore-suggestion', result.current.importer.assets[0]!),
    );
    const restored = result.current.workspace.plansByClientId['plan-1'].assets[0]!;
    expect(restored.type).toBe('API-KEY');
    expect(restored.fieldBindings['secret.apiKey']).toEqual({
      kind: 'source',
      sourceFieldId: 'field-token',
    });
    act(() =>
      result.current.importer.reviewAsset(
        'alternate:USER-PSWD',
        result.current.importer.assets[0]!,
      ),
    );
    const remapped = result.current.workspace.plansByClientId['plan-1'].assets[0]!;
    const visiblePassword = result.current.importer.assets[0]?.schemaFields?.find(
      (field) => field.key === 'secret.password',
    )?.sourceFieldId;
    expect(visiblePassword).toBe('field-other');
    expect(remapped.fieldBindings['secret.password']).toEqual({
      kind: 'source',
      sourceFieldId: visiblePassword,
    });
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
