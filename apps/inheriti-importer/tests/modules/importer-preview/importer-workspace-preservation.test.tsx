// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, renderHook, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImportSession, SensitiveValue } from '@modules/import/domain/import-model';
import { noteForAsset } from '@modules/importer-preview/ImporterFlow/application/importer-workspace-notes';
import { projectImporterWorkspace } from '@modules/importer-preview/ImporterFlow/application/importer-workspace-projection';
import { useImporterWorkspace } from '@modules/importer-preview/ImporterFlow/application/use-importer-workspace';
import { ImporterFlow } from '@modules/importer-preview/ImporterFlow';
import { getReviewBlockers } from '@modules/importer-preview/AssetReviewQueue/review-blockers';
import { NotesField } from '@modules/importer-preview/AssetReviewQueue/components/NotesField';
import { AssetReviewQueue } from '@modules/importer-preview/AssetReviewQueue';
import { suggestedAssetToDraft } from '@modules/mapping/application/suggestion-engine';
import { statusKey } from '@modules/importer-preview/ImporterFlow/application/importer-workspace-suggestions';
import { materialiseAsset } from '@modules/plans/domain/asset-materializer';
import { createAsset, createPlan } from '@modules/plans/domain/workspace-commands';
import { createEmptyWorkspace, type AssetDraft } from '@modules/plans/domain/workspace-model';

afterEach(cleanup);

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

function setup(session: ReturnType<typeof fixture>, initialAsset?: AssetDraft) {
  const onReviewChange = vi.fn();
  const { result } = renderHook(() => {
    const [workspace, setWorkspace] = useState(() => {
      const initial = createPlan(createEmptyWorkspace(), {
        clientId: 'plan',
        name: 'Synthetic plan',
      });
      return initialAsset
        ? createAsset(initial, { planClientId: 'plan', asset: initialAsset })
        : initial;
    });
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
    'keeps every uncovered occurrence from %s pending until explicitly preserved',
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
      expect(current().assets.map(({ type }) => type)).toEqual(['API-KEY']);
      const pending = ['entry:field:1', 'entry:field:2', 'entry:field:3'];
      expect(primary.unmappedSourceFieldIds).toEqual(pending);
      accept();
      expect(current().coverage.ready).toBe(false);
      expect(
        current()
          .coverage.fields.filter(({ status }) => status === 'pending')
          .map(({ id }) => id),
      ).toEqual(pending);
      act(() => expect(current().preserveFields(pending).changedIds).toEqual(pending));
      const companion = current().suggestions.find((asset) => asset.variant === 'rescued-fields')!;
      expect(companion.name).toBe('entry — preserved fields');
      expect(companion.fieldBindings['secret.text']).toEqual({
        kind: 'sources',
        sources: [
          { name: 'custom', sourceFieldId: 'entry:field:1' },
          { name: 'custom', sourceFieldId: 'entry:field:2' },
          { name: 'whitespace', sourceFieldId: 'entry:field:3' },
        ],
      });
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

  it.each(['onepassword', 'keepass', 'passbolt'])(
    'defaults native %s notes, preserves entry overrides, and keeps notes-only entries protected',
    (kind) => {
      const session = fixture(kind, [
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
          fieldIds: ['structured:field:1', 'override:field:1', 'notes-only:field:0'],
          destination: 'asset-notes',
        },
      ]);
      const noteRow = (nodeId: string) =>
        current().assets.find((asset) => asset.sourceNodeId === nodeId && asset.note)!;
      expect(noteRow('structured').note).toMatchObject({ destination: 'asset-notes' });
      expect(noteRow('notes-only').note).toMatchObject({
        destination: 'protected',
        publicAllowed: false,
      });
      accept();
      expect(getReviewBlockers(current().assets, current().coverage).pendingNoteCount).toBe(0);
      assign();
      expect(current().executionCoverage.ready).toBe(true);
      act(() => current().setSourceNoteDestination(null, 'protected'));
      expect(noteRow('structured').note?.destination).toBe('protected');
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
      expect(noteRow('override').note).toMatchObject({
        destination: 'protected',
        inherited: false,
      });
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
      const rescue = current().assets.find((asset) => asset.name === 'structured — Notes')!;
      expect(rescue.type).toBe('PLAIN-TEXT');
      act(() => expect(current().renameAsset(rescue, 'Protected notes')).toBe(true));
      expect(current().assets.find((asset) => asset.id === rescue.id)?.name).toBe(
        'Protected notes',
      );
      expect(current().executionCoverage.ready).toBe(false);
      accept();
      assign();
      expect(current().executionCoverage.ready).toBe(true);
      expect(onReviewChange).toHaveBeenCalled();
    },
  );

  it('pins the checked per-asset default before changing the source policy', () => {
    const { current } = setup(
      fixture('onepassword', [
        [
          'first',
          [
            ['password', 'SYNTHETIC_PASSWORD'],
            ['notes', 'SYNTHETIC_FIRST'],
          ],
        ],
        [
          'second',
          [
            ['password', 'SYNTHETIC_PASSWORD'],
            ['notes', 'SYNTHETIC_SECOND'],
          ],
        ],
      ]),
    );
    const noteRow = (nodeId: string) =>
      current().assets.find((asset) => asset.sourceNodeId === nodeId && asset.note)!;
    const onSetNoteDestination = vi.fn(current().setAssetNoteDestination);
    const view = render(
      <NotesField asset={noteRow('first')} onSetNoteDestination={onSetNoteDestination} />,
    );
    const radio = view.getByRole('radio', { name: 'Asset notes' }) as HTMLInputElement;
    expect(radio.checked).toBe(true);
    fireEvent.click(radio);
    expect(onSetNoteDestination).toHaveBeenCalledTimes(1);
    act(() => current().setSourceNoteDestination(null, 'protected'));
    expect(noteRow('first').note).toMatchObject({ destination: 'asset-notes', inherited: false });
    expect(noteRow('second').note).toMatchObject({ destination: 'protected', inherited: true });
  });

  it('applies the checked source default to an eligible note in an assigned legacy companion', () => {
    const { current, accept, assign } = setup(
      fixture('onepassword', [
        [
          'entry',
          [
            ['password', 'SYNTHETIC_PASSWORD'],
            ['notes', 'SYNTHETIC_NOTE'],
          ],
        ],
      ]),
      {
        id: 'entry:PLAIN-TEXT-ADDITIONAL',
        name: 'Entry — additional fields',
        type: 'PLAIN-TEXT',
        fieldBindings: { 'secret.text': { kind: 'source', sourceFieldId: 'entry:field:1' } },
      },
    );
    expect(current().assets.find(({ note }) => note)?.note?.destination).toBe('protected');
    const onSetSourceNoteDestination = vi.fn(current().setSourceNoteDestination);
    const view = render(
      <AssetReviewQueue
        assets={current().assets}
        preservation={{
          coverage: current().coverage,
          noteSources: current().noteSources,
          onSetSourceNoteDestination,
        }}
      />,
    );
    fireEvent.click(view.getByRole('button', { name: 'Notes destination' }));
    const chooser = view.getByRole('dialog', { name: 'Choose notes destination' });
    const radio = within(chooser).getByRole('radio', { name: 'Asset notes' }) as HTMLInputElement;
    expect(radio.checked).toBe(true);
    fireEvent.click(radio);
    expect(onSetSourceNoteDestination).toHaveBeenCalledExactlyOnceWith(null, 'asset-notes');
    expect(current().assets.find(({ note }) => note)?.note?.destination).toBe('asset-notes');
    accept();
    assign();
    expect(
      current().executionCoverage.fields.find(({ id }) => id === 'entry:field:1')?.destinations,
    ).toEqual([expect.objectContaining({ fieldId: 'meta.notes' })]);
  });

  it.each(['reserved', 'owned'])(
    'keeps default notes protected when the only other binding is %s',
    (mode) => {
      const session = fixture('onepassword', [
        [
          'entry',
          [
            ['password', 'SYNTHETIC_PASSWORD'],
            ['notes', 'SYNTHETIC_NOTE'],
          ],
        ],
      ]);
      const ownerId = 'entry:ASSET-separate';
      const project = (workspace: ReturnType<typeof createEmptyWorkspace>) =>
        projectImporterWorkspace(
          session,
          workspace,
          { 'entry:PLAIN-TEXT-RESCUED': 'accepted', [ownerId]: 'accepted' },
          {},
          {},
          new Set(),
          {},
          mode === 'reserved' ? { rescued: new Set(['entry:field:0']) } : {},
          mode === 'owned'
            ? {
                owners: { 'entry:field:0': ownerId },
                assets: {
                  [ownerId]: {
                    id: ownerId,
                    type: 'PLAIN-TEXT',
                    fromNodeId: 'entry',
                    name: 'Separate protected asset',
                    confidence: 1,
                    rationale: '',
                    fieldBindings: {
                      'secret.text': { kind: 'source', sourceFieldId: 'entry:field:0' },
                    },
                  },
                },
              }
            : undefined,
        );
      const empty = createPlan(createEmptyWorkspace(), {
        clientId: 'plan',
        name: 'Synthetic plan',
      });
      const projection = project(empty);
      expect(projection.suggestions.map(({ fieldBindings }) => Object.keys(fieldBindings))).toEqual(
        mode === 'owned' ? [['secret.text'], ['secret.text']] : [['secret.text']],
      );
      expect(projection.coverage.ready).toBe(true);
      expect(projection.coverage.fields.map(({ status }) => status)).toEqual([
        'protected',
        'protected',
      ]);
      expect(projection.coverage.fields[1].destinations).toEqual([
        expect.objectContaining({ assetId: 'entry:PLAIN-TEXT-RESCUED', fieldId: 'secret.text' }),
      ]);
      expect(projection.assets.every(({ note }) => !note)).toBe(true);
      const assigned = projection.suggestions.reduce(
        (workspace, asset) =>
          createAsset(workspace, {
            planClientId: 'plan',
            asset: suggestedAssetToDraft(asset, statusKey(asset)),
          }),
        empty,
      );
      expect(project(assigned).executionCoverage.ready).toBe(true);
    },
  );

  it('reports a generated protected Notes binding before its draft is accepted', () => {
    const { current } = setup(fixture('onepassword', [['entry', [['notes', 'SYNTHETIC_NOTE']]]]));
    const source = current().assets[0];
    const preview = current().fieldOperations.preview({
      sourceAssetId: source.id,
      action: 'plain-text',
      fieldIds: ['entry:field:0'],
    });
    act(() => expect(current().fieldOperations.commit(preview).success).toBe(true));
    expect(current().assets.find(({ id }) => id === preview.groups[0].id)).toMatchObject({
      note: undefined,
      canRemoveDraft: true,
    });
    expect(current().coverage.fields[0].destinations).toEqual([]);
    expect(current().noteSources[0].destination).toBe('asset-notes');
    const view = render(
      <AssetReviewQueue
        assets={current().assets}
        preservation={{
          coverage: current().coverage,
          noteSources: current().noteSources,
          onSetSourceNoteDestination: current().setSourceNoteDestination,
        }}
      />,
    );
    expect(view.getByRole('button', { name: 'Notes destination' }).textContent).toContain(
      'As secret',
    );
  });

  it('keeps native notes protected when the only other protected value is invalid', () => {
    const session = fixture('onepassword', [
      [
        'entry',
        [
          ['email', 'SYNTHETIC_INVALID_EMAIL'],
          ['notes', 'SYNTHETIC_NOTE'],
        ],
      ],
    ]);
    const note = noteForAsset(
      session,
      {
        type: 'USER-PSWD',
        fromNodeId: 'entry',
        name: 'entry',
        confidence: 1,
        rationale: '',
        fieldBindings: { 'secret.email': { kind: 'source', sourceFieldId: 'entry:field:0' } },
      },
      {},
    );
    expect(note).toMatchObject({ destination: 'protected', publicAllowed: false });
  });

  it.each(['source', 'asset'] as const)(
    'keeps an independently assigned split draft when changing notes by %s',
    (scope) => {
      const session = fixture('onepassword', [
        [
          'entry',
          [
            ['password', 'SYNTHETIC_PASSWORD'],
            ['notes', 'SYNTHETIC_NOTE'],
            ['custom', 'SYNTHETIC_CUSTOM'],
          ],
        ],
      ]);
      const { current, result, accept, assign } = setup(session);
      const primary = () => current().assets.find((asset) => asset.note)!;
      const preview = current().fieldOperations.preview({
        sourceAssetId: primary().id,
        action: 'plain-text',
        fieldIds: ['entry:field:2'],
      });
      act(() => expect(current().fieldOperations.commit(preview).success).toBe(true));
      const [{ id }] = preview.groups;
      const split = () => current().assets.find((asset) => asset.id === id)!;
      act(() => expect(current().renameAsset(split(), 'Split credential')).toBe(true));
      act(() => current().editPlainText(split(), 'SYNTHETIC_EDIT'));
      const setDestination = (destination: 'protected' | 'asset-notes') => {
        act(() => {
          if (scope === 'source') current().setSourceNoteDestination('source', destination);
          else current().setAssetNoteDestination(primary(), destination);
        });
      };
      setDestination('protected');
      accept();
      assign();
      const sibling = result.current.workspace.plansByClientId.plan.assets.find(
        (asset) => asset.id === id,
      )!;
      expect(sibling.name).toBe('Split credential');
      expect(materialiseAsset(sibling, session).asset.secret.text).toBe('SYNTHETIC_EDIT');

      const assigned = result.current.workspace.plansByClientId.plan.assets;
      setDestination('protected');
      expect(result.current.workspace.plansByClientId.plan.assets).toEqual(assigned);

      for (const destination of ['asset-notes', 'protected'] as const) {
        setDestination(destination);
        expect(result.current.workspace.plansByClientId.plan.assets).toEqual([sibling]);
        expect(split().status).toBe('accepted');
        expect(primary().status).toBe('needs-review');
        accept();
        assign();
      }
    },
  );

  it.each(['asset-protected', 'source-asset-notes'] as const)(
    'reopens an assigned preserved-fields asset when %s adds a protected note',
    (choice) => {
      const session = fixture('onepassword', [
        [
          'entry',
          [
            ['password', 'SYNTHETIC_PASSWORD'],
            ['notes', 'SYNTHETIC_NOTE'],
            ['custom', 'SYNTHETIC_CUSTOM'],
          ],
        ],
      ]);
      const { current, result, accept, assign } = setup(session);
      const primary = () => current().assets.find((asset) => asset.note)!;
      if (choice === 'source-asset-notes') act(() => current().reviewAsset('exclude', primary()));
      act(() => current().preserveFields(['entry:field:2']));
      accept();
      assign();
      const before = result.current.workspace.plansByClientId.plan.assets;
      expect(before.some((asset) => asset.id === primary().id)).toBe(choice === 'asset-protected');
      const companion = before.find((asset) => asset.id !== primary().id)!;
      expect(companion).toBeDefined();

      act(() => {
        if (choice === 'asset-protected') current().setAssetNoteDestination(primary(), 'protected');
        else {
          expect(current().setSourceNoteDestination('source', 'asset-notes')).toEqual({
            changedIds: [],
            skippedIds: [primary().id],
          });
        }
      });

      expect(result.current.workspace.plansByClientId.plan.assets).toEqual([]);
      expect(current().assets.find((asset) => asset.id === companion.id)?.status).toBe('suggested');
      accept();
      assign();
      expect(current().executionCoverage.ready).toBe(true);
    },
  );

  it.each(['protected', 'asset-notes'] as const)(
    'resolves included companion notes for an excluded primary with the %s source choice',
    (destination) => {
      const { current } = setup(
        fixture('onepassword', [
          [
            'entry',
            [
              ['password', 'SYNTHETIC_PASSWORD'],
              ['notes', 'SYNTHETIC_NOTE'],
            ],
          ],
        ]),
        {
          id: 'entry:PLAIN-TEXT-ADDITIONAL',
          name: 'Entry — additional fields',
          type: 'PLAIN-TEXT',
          fieldBindings: { 'secret.text': { kind: 'source', sourceFieldId: 'entry:field:1' } },
        },
      );
      const primary = current().assets.find((asset) => asset.note)!;
      const noteId = primary.note!.sourceFieldId;
      act(() => current().reviewAsset('exclude', primary));

      const workspace = current();
      expect(workspace.assets.find(({ id }) => id === primary.id)).toMatchObject({
        status: 'excluded',
        note: { destination: 'protected', publicAllowed: false },
      });
      expect(workspace.coverage.fields.find(({ id }) => id === noteId)?.status).toBe('protected');
      expect(workspace.coverage.ready).toBe(true);
      expect(getReviewBlockers(workspace.assets, workspace.coverage)).toEqual({
        pendingFieldCount: 0,
        invalidFieldCount: 0,
        pendingNoteCount: 0,
        undecidedCount: 0,
      });

      const onSetSourceNoteDestination = vi.fn(workspace.setSourceNoteDestination);
      const renderFlow = () => {
        const importer = current();
        return (
          <ImporterFlow
            initialStage="assets"
            files={[
              { id: 'source', name: 'synthetic.export', format: '1Password', status: 'imported' },
            ]}
            assets={importer.assets}
            unassigned={importer.unassigned}
            plans={importer.plans}
            checklist={[]}
            callbacks={{}}
            preservation={{
              coverage: importer.coverage,
              noteSources: importer.noteSources,
              onSetSourceNoteDestination,
            }}
          />
        );
      };
      const view = render(renderFlow());
      const ui = within(view.container);
      expect(ui.getByRole('button', { name: 'Continue' }).getAttribute('aria-disabled')).not.toBe(
        'true',
      );
      expect(ui.queryByRole('button', { name: 'Resolve notes' })).toBeNull();
      const notesControl = ui.getByRole('button', { name: 'Notes destination' });
      expect(notesControl.textContent).toContain('As secret');
      fireEvent.click(notesControl);
      const chooser = within(view.baseElement).getByRole('dialog', {
        name: 'Choose notes destination',
      });
      expect(onSetSourceNoteDestination).not.toHaveBeenCalled();
      fireEvent.click(
        within(chooser).getByRole('radio', {
          name: destination === 'protected' ? 'As secret' : 'Asset notes',
        }),
      );
      expect(onSetSourceNoteDestination).toHaveBeenCalledExactlyOnceWith(null, destination);
      if (destination === 'asset-notes')
        expect(onSetSourceNoteDestination.mock.results[0].value.skippedIds).toEqual([primary.id]);
      expect(current().coverage.fields.find(({ id }) => id === noteId)?.status).toBe('protected');
      expect(current().coverage.ready).toBe(true);
      expect(current().executionCoverage.ready).toBe(true);
      view.rerender(renderFlow());
      expect(ui.getByRole('button', { name: 'Continue' }).getAttribute('aria-disabled')).not.toBe(
        'true',
      );
      view.unmount();
    },
  );

  it('uses the preserved fields name when native notes share a rescue asset with a custom field', () => {
    const session = fixture('onepassword', [
      [
        'entry',
        [
          ['password', 'SYNTHETIC_PASSWORD'],
          ['notes', 'SYNTHETIC_NOTE'],
          ['custom', 'SYNTHETIC_VALUE'],
        ],
      ],
    ]);
    const { current } = setup(session);
    const primary = current().assets.find((asset) => asset.note)!;
    act(() => current().setAssetNoteDestination(primary, 'protected'));
    act(() => current().preserveFields(['entry:field:2']));
    const rescue = current().suggestions.find((asset) => asset.variant === 'rescued-fields');
    expect(rescue?.name).toBe('entry — preserved fields');
    expect(rescue?.fieldBindings['secret.text']).toEqual({
      kind: 'sources',
      sources: [
        { name: 'notes', sourceFieldId: 'entry:field:1' },
        { name: 'custom', sourceFieldId: 'entry:field:2' },
      ],
    });
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

  it('undoes pending field exclusions and preserves undo after a skipped exclusion', () => {
    const { current, result } = setup(
      fixture('cloud', [
        [
          'entry',
          [
            ['token', 'SYNTHETIC_TOKEN'],
            ['region', 'SYNTHETIC_REGION'],
            ['owner', 'SYNTHETIC_OWNER'],
          ],
        ],
      ]),
    );
    const selected = ['entry:field:1', 'entry:field:2'];
    const before = current();
    act(() =>
      expect(current().excludeFields(selected)).toEqual({
        changedIds: selected,
        skippedIds: [],
      }),
    );
    expect(result.current.workspace.ignoredSourceFieldIds).toEqual(selected);
    expect(
      current()
        .coverage.fields.slice(1)
        .map(({ status }) => status),
    ).toEqual(['excluded', 'excluded']);
    expect(current().fieldOperations.canUndo).toBe(true);
    act(() =>
      expect(current().excludeFields(selected)).toEqual({
        changedIds: [],
        skippedIds: selected,
      }),
    );
    act(() => expect(current().fieldOperations.undo().success).toBe(true));
    expect(result.current.workspace.ignoredSourceFieldIds).toEqual([]);
    expect(current().coverage).toEqual(before.coverage);
    expect(getReviewBlockers(current().assets, current().coverage)).toEqual(
      getReviewBlockers(before.assets, before.coverage),
    );

    act(() => current().excludeFields(selected));
    act(() => expect(current().renameAsset(current().assets[0], 'Renamed API key')).toBe(true));
    expect(current().fieldOperations.canUndo).toBe(false);
    expect(current().fieldOperations.undo().success).toBe(false);
    expect(result.current.workspace.ignoredSourceFieldIds).toEqual(selected);
  });

  it.each([false, true])(
    'preserves unrelated Accept All history after field exclusion (undo field first: %s)',
    (undoFieldFirst) => {
      const { current, result } = setup(
        fixture('cloud', [
          [
            'first',
            [
              ['token', 'SYNTHETIC_FIRST'],
              ['region', 'SYNTHETIC_REGION'],
            ],
          ],
          ['second', [['token', 'SYNTHETIC_SECOND']]],
        ]),
      );
      act(() => expect(current().acceptAllEligible()).toBe(2));
      expect(current().assets.map(({ status }) => status)).toEqual(['accepted', 'accepted']);

      const fieldId = 'first:field:1';
      act(() => expect(current().excludeFields([fieldId]).changedIds).toEqual([fieldId]));
      expect(current().fieldOperations.canUndo).toBe(true);
      if (undoFieldFirst) {
        act(() => expect(current().fieldOperations.undo().success).toBe(true));
        expect(current().assets.map(({ status }) => status)).toEqual(['accepted', 'accepted']);
      }
      act(() => current().undoAcceptAll());
      expect(current().assets.map(({ status }) => status)).not.toContain('accepted');
      expect(current().fieldOperations.canUndo).toBe(false);
      expect(result.current.workspace.ignoredSourceFieldIds).toEqual(
        undoFieldFirst ? [] : [fieldId],
      );
    },
  );

  it('restores an assigned draft and its mappings when undoing an invalid field exclusion', () => {
    const { current, result } = setup(
      fixture('onepassword', [
        [
          'entry',
          [
            ['password', 'SYNTHETIC_PASSWORD'],
            ['email', 'SYNTHETIC_INVALID_EMAIL'],
          ],
        ],
      ]),
      {
        id: 'entry:USER-PSWD',
        name: 'Assigned login',
        type: 'USER-PSWD',
        fieldBindings: {
          'secret.password': { kind: 'source', sourceFieldId: 'entry:field:0' },
          'secret.email': { kind: 'source', sourceFieldId: 'entry:field:1' },
        },
      },
    );
    const { assets, coverage, executionCoverage } = current();
    const assigned = result.current.workspace.plansByClientId.plan.assets;
    const fieldId = 'entry:field:1';
    expect(coverage.fields.find(({ id }) => id === fieldId)?.status).toBe('invalid');
    act(() => current().excludeFields([fieldId]));
    expect(result.current.workspace.plansByClientId.plan.assets).toEqual([]);
    expect(current().assets[0].status).toBe('suggested');
    act(() => expect(current().fieldOperations.undo().success).toBe(true));
    expect(result.current.workspace.plansByClientId.plan.assets).toEqual(assigned);
    expect(current().assets[0].status).toBe(assets[0].status);
    expect(current().coverage).toEqual(coverage);
    expect(current().executionCoverage).toEqual(executionCoverage);
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
    act(() => current().setSourceNoteDestination('source', 'protected'));
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

  it.each(['all at once', 'one at a time'])(
    'includes unmapped fields %s in a single protected Plain Text asset',
    (mode) => {
      const session = fixture('cloud', [
        [
          'entry',
          [
            ['token', 'SYNTHETIC_TOKEN'],
            ['region', 'SYNTHETIC_REGION'],
            ['owner', 'SYNTHETIC_OWNER'],
          ],
        ],
      ]);
      const { current, result, accept, assign } = setup(session);
      const primary = current().assets.find((asset) => asset.type === 'API-KEY')!;
      const queue = () => (
        <AssetReviewQueue
          assets={current().assets}
          selectedId={primary.id}
          preservation={{
            coverage: current().coverage,
            noteSources: current().noteSources,
            onPreserveFields: current().preserveFields,
          }}
        />
      );
      const view = render(queue());
      const fields = within(view.getByRole('region', { name: 'Source fields' }));
      expect(fields.getByText('Proposed mapping · API key')).toBeTruthy();
      expect(fields.queryByRole('button', { name: 'Include in protected text: token' })).toBeNull();
      fireEvent.click(view.getByRole('button', { name: 'View asset issues' }));
      const details = within(view.getByRole('dialog'));
      expect(details.getByText('region')).toBeTruthy();
      expect(details.getByText('owner')).toBeTruthy();
      expect(details.queryByText('Proposed mapping · API key')).toBeNull();
      fireEvent.click(details.getByRole('button', { name: /^Close .* — Issues$/ }));
      if (mode === 'one at a time') {
        for (const name of ['region', 'owner']) {
          fireEvent.click(
            fields.getByRole('button', { name: `Include in protected text: ${name}` }),
          );
          view.rerender(queue());
        }
      } else {
        fireEvent.click(fields.getByRole('button', { name: 'Include all unmapped fields' }));
        view.rerender(queue());
      }
      const changed = mode === 'one at a time' ? 1 : 2;
      expect(fields.getByRole('status').textContent).toBe(
        `${changed} included in protected text · 0 skipped`,
      );
      expect(fields.queryByRole('button', { name: 'Include all unmapped fields' })).toBeNull();
      expect(fields.getAllByText('Preserved in an additional asset · Mapped')).toHaveLength(2);
      accept();
      assign();
      const drafts = result.current.workspace.plansByClientId.plan.assets;
      const companions = drafts.filter(({ type }) => type === 'PLAIN-TEXT');
      expect(companions).toHaveLength(1);
      const { asset } = materialiseAsset(companions[0]!, session);
      expect(asset.secret.text).toBe('region: SYNTHETIC_REGION\nowner: SYNTHETIC_OWNER');
      expect(asset.meta.notes ?? '').toBe('');
      view.unmount();
    },
  );

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
    act(() => current().preserveFields(['entry:field:1']));
    const companion = current().assets.find((asset) => asset.type === 'PLAIN-TEXT')!;
    act(() => current().reviewAsset('exclude', companion));
    expect(current().coverage.fields.map(({ status }) => status)).toEqual(['pending', 'excluded']);
  });
});
