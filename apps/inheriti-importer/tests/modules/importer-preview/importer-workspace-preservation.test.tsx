// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createEmptyImportSession, SensitiveValue } from '@modules/import/domain/import-model';
import { useImporterWorkspace } from '@modules/importer-preview/ImporterFlow/application/use-importer-workspace';
import { materialiseAsset } from '@modules/plans/domain/asset-materializer';
import { createPlan } from '@modules/plans/domain/workspace-commands';
import { createEmptyWorkspace } from '@modules/plans/domain/workspace-model';

function fixture(kind: string, entries: Array<[string, Array<[string, string]>]>) {
  const session = createEmptyImportSession('synthetic');
  session.sources.push({
    id: 'source',
    kind,
    name: kind,
    fileName: 'synthetic.export',
    importedAt: '',
    warnings: [],
  });
  for (const [entry, fields] of entries) {
    session.rootNodeIds.push(entry);
    const fieldIds = fields.map(([name, value], index) => {
      const id = `${entry}:field:${index}`;
      session.fieldsById[id] = {
        id,
        name,
        value: new SensitiveValue(value),
        sourceId: 'source',
        parentNodeId: entry,
        sourcePath: [entry, name],
        metadata: {},
      };
      return id;
    });
    session.nodesById[entry] = {
      id: entry,
      name: entry,
      sourceId: 'source',
      kind: 'entry',
      fieldIds,
      parentNodeId: null,
      path: [],
      childNodeIds: [],
    };
  }
  return session;
}

function setup(session: ReturnType<typeof fixture>) {
  const onReviewChange = vi.fn();
  const { result } = renderHook(() => {
    const [workspace, setWorkspace] = useState(() =>
      createPlan(createEmptyWorkspace(), {
        clientId: 'plan',
        name: 'Synthetic plan',
      }),
    );
    return {
      workspace,
      importer: useImporterWorkspace(session, workspace, setWorkspace, undefined, onReviewChange),
    };
  });
  const current = () => result.current.importer;
  const accept = () =>
    act(() => {
      current().acceptAllEligible();
    });
  const assign = () => {
    const ids = current().unassigned.map((asset) => asset.id);
    for (const id of ids) {
      act(() =>
        current().assignAsset(
          current().unassigned.find((asset) => asset.id === id)!,
          current().plans[0],
        ),
      );
    }
  };
  return { current, result, accept, assign, onReviewChange };
}

describe('import source preservation', () => {
  it.each(['onepassword', 'keepass', 'passbolt', 'kubernetes', 'vault', 'cloud', 'dotenv'])(
    'protects every uncovered occurrence from %s in a source-bound companion',
    (kind) => {
      const session = fixture(kind, [
        [
          'entry',
          [
            ['token', 'SYNTHETIC_TOKEN'],
            ['custom', 'SYNTHETIC_FIRST'],
            ['custom', 'SYNTHETIC_SECOND'],
            ['whitespace', '  '],
            ['empty', ''],
          ],
        ],
      ]);
      const { current, accept, assign } = setup(session);
      const primary = current().assets.find((asset) => asset.type === 'API-KEY')!;
      const companion = current().suggestions.find(
        (asset) => asset.variant === 'additional-fields',
      )!;
      expect(companion.fieldBindings['secret.text']).toEqual({
        kind: 'sources',
        sources: [
          { name: 'custom', sourceFieldId: 'entry:field:1' },
          { name: 'custom', sourceFieldId: 'entry:field:2' },
          { name: 'whitespace', sourceFieldId: 'entry:field:3' },
        ],
      });
      expect(current().coverage.ready).toBe(false);
      accept();
      expect(
        current().assets.find((asset) => asset.id === primary.id)?.preservedInCompanion,
      ).toEqual(['custom', 'custom', 'whitespace']);
      expect(current().coverage.fields.map(({ status }) => status)).toEqual([
        'mapped',
        'protected',
        'protected',
        'protected',
      ]);
      expect(current().coverage.ready).toBe(true);
      expect(current().executionCoverage.ready).toBe(false);
      assign();
      expect(current().executionCoverage.ready).toBe(true);
      expect(JSON.stringify(current().coverage)).not.toContain('SYNTHETIC_FIRST');
    },
  );

  it('moves native notes by source choice, preserves entry overrides, and keeps notes-only entries protected', () => {
    const session = fixture('onepassword', [
      [
        'structured',
        [
          ['password', 'SYNTHETIC_PASSWORD'],
          ['notes', 'SYNTHETIC_NOTE'],
        ],
      ],
      [
        'override',
        [
          ['custom', 'SYNTHETIC_VALUE'],
          ['notes', 'SYNTHETIC_OVERRIDE'],
        ],
      ],
      ['notes-only', [['notes', 'SYNTHETIC_ONLY_NOTE']]],
    ]);
    const { current, result, accept, assign, onReviewChange } = setup(session);
    expect(current().noteSources).toEqual([
      {
        sourceId: 'source',
        sourceName: 'synthetic.export',
        fieldCount: 3,
        destination: null,
      },
    ]);
    const noteRow = (nodeId: string) =>
      current().assets.find((asset) => asset.sourceNodeId === nodeId && asset.note)!;
    expect(noteRow('structured').note).toMatchObject({ destination: 'protected', explicit: false });
    expect(noteRow('notes-only').note?.publicAllowed).toBe(false);
    accept();
    assign();
    expect(current().executionCoverage.ready).toBe(false);
    act(() =>
      expect(
        current().setAssetNoteDestination(noteRow('override'), 'protected').changedIds,
      ).toEqual([noteRow('override').id]),
    );
    act(() =>
      expect(current().setSourceNoteDestination('source', 'asset-notes')).toEqual({
        changedIds: [noteRow('structured').id],
        skippedIds: [noteRow('override').id, noteRow('notes-only').id],
      }),
    );
    expect(noteRow('structured').note).toMatchObject({
      destination: 'asset-notes',
      inherited: true,
    });
    expect(noteRow('override').note).toMatchObject({ destination: 'protected', inherited: false });
    expect(noteRow('notes-only').note?.destination).toBe('protected');
    const references = () =>
      current()
        .suggestions.flatMap((asset) => Object.entries(asset.fieldBindings))
        .filter(([, binding]) =>
          binding.kind === 'source'
            ? binding.sourceFieldId === 'structured:field:1'
            : binding.kind === 'sources' &&
              binding.sources.some((source) => source.sourceFieldId === 'structured:field:1'),
        );
    expect(references()).toHaveLength(1);
    expect(references()[0][0]).toBe('meta.notes');
    expect(
      result.current.workspace.plansByClientId.plan.assets.some(
        (asset) => asset.name === 'structured',
      ),
    ).toBe(false);
    expect(current().executionCoverage.ready).toBe(false);
    accept();
    assign();
    expect(current().executionCoverage.ready).toBe(true);
    const draft = result.current.workspace.plansByClientId.plan.assets.find(
      (asset) => asset.name === 'structured',
    )!;
    expect(materialiseAsset(draft, session).asset.meta.notes).toBe('SYNTHETIC_NOTE');
    act(() => current().setSourceNoteDestination(null, 'protected'));
    expect(references()).toHaveLength(1);
    expect(references()[0][0]).toBe('secret.text');
    expect(current().executionCoverage.ready).toBe(false);
    accept();
    assign();
    expect(current().executionCoverage.ready).toBe(true);
    expect(onReviewChange).toHaveBeenCalled();
  });

  it('keeps literal edits out of coverage and resolves pending duplicate labels by exact field ID', () => {
    const session = fixture('dotenv', [
      [
        'entry',
        [
          ['duplicate', 'SYNTHETIC_FIRST'],
          ['duplicate', 'SYNTHETIC_SECOND'],
        ],
      ],
    ]);
    const { current, accept, assign } = setup(session);
    act(() => current().editPlainText(current().assets[0], 'manual literal'));
    expect(current().coverage.fields.map(({ status }) => status)).toEqual(['pending', 'pending']);
    act(() => current().preserveFields(['entry:field:1']));
    act(() => current().excludeFields(['entry:field:0']));
    expect(current().coverage.fields.map(({ status }) => status)).toEqual([
      'excluded',
      'protected',
    ]);
    const rescue = current().suggestions.find((asset) => asset.variant === 'rescued-fields');
    expect(rescue?.fieldBindings['secret.text']).toEqual({
      kind: 'source',
      sourceFieldId: 'entry:field:1',
    });
    expect(session.fieldsById['entry:field:0'].value.isEmpty).toBe(false);
    accept();
    assign();
    expect(current().executionCoverage.ready).toBe(true);
  });

  it('rejects direct native note metadata mapping on the protected companion', () => {
    const session = fixture('keepass', [
      [
        'entry',
        [
          ['password', 'SYNTHETIC_PASSWORD'],
          ['notes', 'SYNTHETIC_NOTE'],
        ],
      ],
    ]);
    const { current, accept, assign, result } = setup(session);
    const companion = current().assets.find((asset) => asset.type === 'PLAIN-TEXT')!;
    const metadata = companion.schemaFields?.find((field) => field.key === 'meta.notes');
    expect(metadata?.candidates?.map((field) => field.id)).not.toContain('entry:field:1');
    act(() => current().mapAssetField(companion, 'meta.notes', 'entry:field:1'));
    act(() => current().setSourceNoteDestination('source', 'protected'));
    accept();
    assign();
    const drafts = result.current.workspace.plansByClientId.plan.assets.map(
      (asset) => materialiseAsset(asset, session).asset,
    );
    expect(drafts.every((draft) => draft.meta.notes === undefined)).toBe(true);
    expect(drafts.find((draft) => draft.type === 'PLAIN-TEXT')?.secret.text).toBe('SYNTHETIC_NOTE');
    expect(current().executionCoverage.ready).toBe(true);
  });

  it('unassigns an existing rescue when adding another field from the same entry', () => {
    const session = fixture('dotenv', [
      [
        'entry',
        [
          ['first', 'SYNTHETIC_FIRST'],
          ['second', 'SYNTHETIC_SECOND'],
        ],
      ],
    ]);
    const { current, assign, result } = setup(session);
    act(() => current().preserveFields(['entry:field:0']));
    assign();
    const rescueId = 'entry:PLAIN-TEXT-RESCUED';
    expect(result.current.workspace.plansByClientId.plan.assets.map((asset) => asset.id)).toEqual([
      rescueId,
    ]);
    act(() => current().preserveFields(['entry:field:1']));
    expect(result.current.workspace.plansByClientId.plan.assets).toHaveLength(0);
    expect(current().unassigned.map((asset) => asset.id)).toEqual([rescueId]);
    expect(current().executionCoverage.ready).toBe(false);
    assign();
    const [draft] = result.current.workspace.plansByClientId.plan.assets;
    expect(draft.id).toBe(rescueId);
    expect(materialiseAsset(draft, session).asset.secret.text).toBe(
      'first: SYNTHETIC_FIRST\nsecond: SYNTHETIC_SECOND',
    );
    expect(current().executionCoverage.ready).toBe(true);
  });

  it('honors an explicit companion exclusion without treating unassigned entries as excluded', () => {
    const { current } = setup(
      fixture('cloud', [
        [
          'entry',
          [
            ['token', 'SYNTHETIC_TOKEN'],
            ['extra', 'SYNTHETIC_EXTRA'],
          ],
        ],
      ]),
    );
    const companion = current().assets.find((asset) => asset.type === 'PLAIN-TEXT')!;
    act(() => current().reviewAsset('exclude', companion));
    expect(current().coverage.fields.map(({ status }) => status)).toEqual(['pending', 'excluded']);
  });
});
