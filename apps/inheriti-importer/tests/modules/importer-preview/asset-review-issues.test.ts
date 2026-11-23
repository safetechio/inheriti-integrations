import { describe, expect, it } from 'vitest';
import { createEmptyImportSession, SensitiveValue } from '@modules/import/domain/import-model';
import { getAssetReviewIssues } from '@modules/importer-preview/AssetReviewQueue/asset-review-issues';
import { projectImporterWorkspace } from '@modules/importer-preview/ImporterFlow/application/importer-workspace-projection';
import { createEmptyWorkspace } from '@modules/plans/domain/workspace-model';

describe('asset review issue ownership', () => {
  it('keeps entry issues on the original asset when Notes and other fields are split out', () => {
    const session = createEmptyImportSession('synthetic');
    session.sources.push({
      id: 'source',
      kind: 'onepassword',
      name: '1Password',
      fileName: 'synthetic.export',
      importedAt: '',
      warnings: [],
      diagnostics: [
        {
          code: 'unsupported-field',
          kind: 'unsupported',
          message: 'A source field could not be imported.',
          count: 1,
          entryId: 'entry',
        },
      ],
    });
    session.rootNodeIds.push('entry');
    const fields = {
      password: 'SYNTHETIC_PASSWORD',
      notes: 'SYNTHETIC_NOTE',
      custom: 'SYNTHETIC_VALUE',
      organized: 'SYNTHETIC_EXTRA',
    };
    for (const [id, value] of Object.entries(fields)) {
      session.fieldsById[id] = {
        id,
        name: id,
        value: new SensitiveValue(value),
        sourceId: 'source',
        parentNodeId: 'entry',
        sourcePath: ['entry', id],
        metadata: {},
      };
    }
    session.nodesById.entry = {
      id: 'entry',
      name: 'entry',
      sourceId: 'source',
      kind: 'entry',
      fieldIds: Object.keys(fields),
      parentNodeId: null,
      path: [],
      childNodeIds: [],
    };
    const organized = {
      id: 'entry:ASSET-operation-0',
      fromNodeId: 'entry',
      name: 'Organized',
      type: 'PLAIN-TEXT',
      confidence: 0,
      rationale: '',
      fieldBindings: {
        'secret.text': { kind: 'source' as const, sourceFieldId: 'organized' },
      },
    };

    const { assets, coverage, executionCoverage } = projectImporterWorkspace(
      session,
      createEmptyWorkspace(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { entryNotes: { entry: 'protected' } },
      { assets: { [organized.id]: organized }, owners: { organized: organized.id } },
    );
    const notes = assets.find(({ id }) => id === 'entry:PLAIN-TEXT-RESCUED')!;
    const additional = assets.find(({ id }) => id === organized.id)!;
    const primary = assets.find(({ id }) => id !== organized.id && id !== notes.id)!;
    const issuesFor = (asset: (typeof assets)[number]) =>
      getAssetReviewIssues(
        asset,
        coverage.fields,
        assets.filter(({ id }) => id !== asset.id),
        coverage.diagnostics,
      );

    expect(notes.schemaFields?.find(({ key }) => key === 'secret.text')?.sourceFieldId).toBe(
      'notes',
    );
    expect(notes.status).not.toBe('needs-review');
    expect(issuesFor(notes).issueCount).toBe(0);
    expect(issuesFor(additional).issueCount).toBe(0);
    const primaryIssues = issuesFor(primary);
    expect(primaryIssues).toMatchObject({
      unresolved: [{ id: 'custom' }],
      issueCount: 1,
    });
    expect(primaryIssues.diagnostics.map(([, warning]) => warning.code)).toEqual([
      'unsupported-field',
    ]);
    expect(coverage.diagnostics).toHaveLength(1);
    expect(coverage.ready).toBe(false);
    expect(executionCoverage.ready).toBe(false);

    const resolvedLayout = {
      ...organized,
      fieldBindings: {
        'secret.text': { kind: 'sources' as const, sources: ['organized', 'custom'].map((id) => ({ sourceFieldId: id, name: id })) },
      },
    };
    const resolved = projectImporterWorkspace(
      session, createEmptyWorkspace(), undefined, undefined, undefined, undefined, undefined,
      { entryNotes: { entry: 'protected' } },
      { assets: { [organized.id]: resolvedLayout }, owners: { organized: organized.id, custom: organized.id } },
    );
    const resolvedPrimary = resolved.assets.find(({ id }) => id === primary.id)!;
    expect(resolvedPrimary.status).toBe('suggested');
    expect(getAssetReviewIssues(
      resolvedPrimary, resolved.coverage.fields,
      resolved.assets.filter(({ id }) => id !== primary.id), resolved.coverage.diagnostics,
    )).toMatchObject({ issueCount: 0, unresolved: [] });
    expect(resolved.coverage.diagnostics).toHaveLength(1);

    const invalidNotes = {
      ...notes,
      schemaFields: [
        { key: 'secret.text', label: 'Text', sourceFieldId: 'notes', validationError: 'Invalid.' },
      ],
    };
    const invalidIssues = issuesFor(invalidNotes);
    expect(invalidIssues.issueCount).toBe(1);
    expect(invalidIssues.bindingIssues.get('secret.text')?.sourceId).toBe('notes');
  });
});
