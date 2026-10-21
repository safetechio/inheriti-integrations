import { describe, expect, it } from 'vitest';
import { SensitiveValue, type ImportSession } from '@modules/import/domain/import-model';
import { createEmptyWorkspace, makePlanDraft } from '@modules/plans/domain/workspace-model';
import { createAsset, createPlan } from '@modules/plans/domain/workspace-commands';
import {
  projectImporterWorkspace,
  removeSourceFromWorkspace,
} from '@modules/importer-preview/ImporterFlow/application/importer-workspace';

function session(): ImportSession {
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
        name: 'Stripe',
        path: [],
        childNodeIds: [],
        fieldIds: ['entry-1:token'],
      },
    },
    fieldsById: {
      'entry-1:token': {
        id: 'entry-1:token',
        sourceId: 'source-1',
        parentNodeId: 'entry-1',
        sourcePath: ['entry-1', 'token'],
        name: 'token',
        value: new SensitiveValue('secret'),
        metadata: {},
      },
    },
  };
}

function usernamePasswordSession(): ImportSession {
  const imported = session();
  imported.nodesById['entry-1'].fieldIds = ['entry-1:username', 'entry-1:password'];
  imported.fieldsById = {
    'entry-1:username': {
      id: 'entry-1:username',
      sourceId: 'source-1',
      parentNodeId: 'entry-1',
      sourcePath: ['entry-1', 'username'],
      name: 'username',
      value: new SensitiveValue('not-an-email'),
      metadata: {},
    },
    'entry-1:password': {
      id: 'entry-1:password',
      sourceId: 'source-1',
      parentNodeId: 'entry-1',
      sourcePath: ['entry-1', 'password'],
      name: 'password',
      value: new SensitiveValue('secret'),
      metadata: {},
    },
  };
  return imported;
}

describe('projectImporterWorkspace', () => {
  it('reviews a 1Password structured asset and unmatched Plain Text independently', () => {
    const imported = usernamePasswordSession();
    imported.sources[0]!.kind = 'onepassword';
    imported.nodesById['entry-1']!.fieldIds.push('entry-1:notes');
    imported.fieldsById['entry-1:notes'] = {
      id: 'entry-1:notes',
      sourceId: 'source-1',
      parentNodeId: 'entry-1',
      sourcePath: ['entry-1', 'notes'],
      name: 'extra:notes',
      value: new SensitiveValue('Private recovery details'),
      metadata: {},
    };
    let workspace = createPlan(createEmptyWorkspace(), {
      clientId: 'plan-1',
      name: 'Imported Plan',
    });
    workspace = createAsset(workspace, {
      planClientId: 'plan-1',
      asset: {
        id: 'entry-1:USER-PSWD',
        type: 'USER-PSWD',
        name: 'Stripe',
        fieldBindings: { 'secret.password': { kind: 'source', sourceFieldId: 'entry-1:password' } },
      },
    });

    const result = projectImporterWorkspace(imported, workspace);
    expect(result.assets.map((asset) => [asset.type, asset.status])).toEqual([
      ['USER-PSWD', 'accepted'],
      ['PLAIN-TEXT', 'fallback'],
    ]);
    expect(result.suggestions[1]?.fieldBindings['secret.text']).toEqual({
      kind: 'source',
      sourceFieldId: 'entry-1:notes',
    });
    expect(result.assets[1]?.mapped).toEqual(['extra:notes']);
    expect(result.assets[1]?.unmapped).toEqual([]);
  });

  it('matches 1Password suggestions by ID even when Plain Text bindings overlap', () => {
    const imported = usernamePasswordSession();
    imported.sources[0]!.kind = 'onepassword';
    imported.nodesById['entry-1']!.fieldIds.push('entry-1:notes');
    imported.fieldsById['entry-1:notes'] = {
      id: 'entry-1:notes',
      sourceId: 'source-1',
      parentNodeId: 'entry-1',
      sourcePath: ['entry-1', 'notes'],
      name: 'extra:notes',
      value: new SensitiveValue('Private notes'),
      metadata: {},
    };
    let workspace = createPlan(createEmptyWorkspace(), {
      clientId: 'plan-1',
      name: 'Imported Plan',
    });
    workspace = createAsset(workspace, {
      planClientId: 'plan-1',
      asset: {
        id: 'entry-1:PLAIN-TEXT',
        type: 'PLAIN-TEXT',
        name: 'Converted',
        fieldBindings: { 'secret.text': { kind: 'source', sourceFieldId: 'entry-1:notes' } },
      },
    });

    const result = projectImporterWorkspace(imported, workspace);
    expect(
      result.assets.find((asset) => asset.id === 'entry-1:PLAIN-TEXT-ADDITIONAL')?.status,
    ).toBe('fallback');
  });
  it('initializes single-field entries as Plain Text fallbacks', () => {
    const result = projectImporterWorkspace(session(), createEmptyWorkspace());

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({
      status: 'fallback',
      type: 'PLAIN-TEXT',
      name: 'Stripe',
    });
    expect(result.unassigned).toHaveLength(0);
  });

  it('projects accepted decisions as unassigned until assigned to a production Plan', () => {
    const result = projectImporterWorkspace(session(), createEmptyWorkspace(), {
      'entry-1:PLAIN-TEXT': 'accepted',
    });

    expect(result.assets[0]?.status).toBe('accepted');
    expect(result.unassigned).toEqual([
      { id: 'entry-1:PLAIN-TEXT', name: 'Stripe', type: 'PLAIN-TEXT', valid: true },
    ]);
  });

  it('uses production workspace plans and validation as the plan projection', () => {
    let workspace = createEmptyWorkspace();
    workspace = createPlan(workspace, { clientId: 'plan-1', name: 'Imported Plan' });
    workspace.plansByClientId['plan-1'] = {
      ...workspace.plansByClientId['plan-1'],
      description: 'Existing description',
    };
    workspace = createAsset(workspace, {
      planClientId: 'plan-1',
      asset: {
        id: 'asset-1',
        type: 'API-KEY',
        name: 'Stripe',
        fieldBindings: { 'secret.apiKey': { kind: 'source', sourceFieldId: 'entry-1:token' } },
      },
    });
    const result = projectImporterWorkspace(session(), workspace);

    expect(result.plans).toEqual([
      expect.objectContaining({
        id: 'plan-1',
        assets: 1,
        valid: true,
        description: 'Existing description',
      }),
    ]);
    expect(result.assets[0]?.status).toBe('accepted');
    expect(result.unassigned).toEqual([]);
  });

  it('keeps literal fallback Assets distinct when source entries share a title', () => {
    const imported = session();
    imported.nodesById['entry-1'].name = 'Duplicate';
    imported.nodesById['entry-1'].fieldIds = ['entry-1:custom'];
    imported.fieldsById = {
      'entry-1:custom': {
        id: 'entry-1:custom',
        sourceId: 'source-1',
        parentNodeId: 'entry-1',
        sourcePath: ['entry-1', 'custom'],
        name: 'custom',
        value: new SensitiveValue('one'),
        metadata: {},
      },
      'entry-2:custom': {
        id: 'entry-2:custom',
        sourceId: 'source-1',
        parentNodeId: 'entry-2',
        sourcePath: ['entry-2', 'custom'],
        name: 'custom',
        value: new SensitiveValue('two'),
        metadata: {},
      },
    };
    imported.rootNodeIds.push('entry-2');
    imported.nodesById['entry-2'] = {
      id: 'entry-2',
      sourceId: 'source-1',
      parentNodeId: null,
      kind: 'entry',
      name: 'Duplicate',
      path: [],
      childNodeIds: [],
      fieldIds: ['entry-2:custom'],
    };
    let workspace = createPlan(createEmptyWorkspace(), {
      clientId: 'plan-1',
      name: 'Imported Plan',
    });
    workspace = createAsset(workspace, {
      planClientId: 'plan-1',
      asset: {
        id: 'entry-1:PLAIN-TEXT',
        type: 'PLAIN-TEXT',
        name: 'Duplicate',
        fieldBindings: {
          'secret.text': { kind: 'literal', value: new SensitiveValue('custom: one') },
        },
      },
    });

    const result = projectImporterWorkspace(imported, workspace, {
      'entry-1:PLAIN-TEXT': 'accepted',
      'entry-2:PLAIN-TEXT': 'accepted',
    });

    expect(result.unassigned.map((asset) => asset.id)).toEqual(['entry-2:PLAIN-TEXT']);
  });

  it('marks a Plan and its Asset invalid when a source binding is stale', () => {
    let workspace = createPlan(createEmptyWorkspace(), {
      clientId: 'plan-1',
      name: 'Imported Plan',
    });
    workspace = createAsset(workspace, {
      planClientId: 'plan-1',
      asset: {
        id: 'stale-asset',
        type: 'API-KEY',
        name: 'Stale',
        fieldBindings: { 'secret.apiKey': { kind: 'source', sourceFieldId: 'missing-field' } },
      },
    });

    const result = projectImporterWorkspace(session(), workspace);

    expect(result.plans[0]).toMatchObject({ valid: false });
    expect(result.plans[0]?.assignedAssets?.[0]).toMatchObject({ valid: false });
  });

  it('projects schema targets and masked source candidates without values', () => {
    const result = projectImporterWorkspace(session(), createEmptyWorkspace());

    expect(result.assets[0]?.schemaFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'secret.text',
          label: 'Text',
          sourceFieldId: 'entry-1:token',
          candidates: [{ id: 'entry-1:token', name: 'token', length: 6 }],
        }),
      ]),
    );
    expect(JSON.stringify(result.assets[0]?.schemaFields)).not.toContain('"value"');
  });

  it('projects canonical validation errors and clears them after a valid remapping', () => {
    const imported = usernamePasswordSession();
    const invalid = projectImporterWorkspace(
      imported,
      createEmptyWorkspace(),
      {},
      {
        'entry-1:USER-PSWD': { 'secret.email': 'entry-1:username' },
      },
    );
    expect(
      invalid.assets[0]?.schemaFields?.find((field) => field.key === 'secret.email')
        ?.validationError,
    ).toBe('Invalid email');

    imported.fieldsById['entry-1:username'].value = new SensitiveValue('person@example.test');
    const valid = projectImporterWorkspace(
      imported,
      createEmptyWorkspace(),
      {},
      {
        'entry-1:USER-PSWD': { 'secret.email': 'entry-1:username' },
      },
    );
    expect(
      valid.assets[0]?.schemaFields?.find((field) => field.key === 'secret.email')?.validationError,
    ).toBeUndefined();
  });
});

describe('removeSourceFromWorkspace', () => {
  it('removes only Assets and ignored fields derived from the selected source', () => {
    const imported = session();
    imported.sources.push({
      id: 'source-2',
      kind: 'dotenv',
      name: 'second.env',
      fileName: 'second.env',
      importedAt: '2026-01-01',
      warnings: [],
    });
    imported.rootNodeIds.push('entry-2');
    imported.nodesById['entry-2'] = {
      id: 'entry-2',
      sourceId: 'source-2',
      parentNodeId: null,
      kind: 'entry',
      name: 'Second',
      path: [],
      childNodeIds: [],
      fieldIds: ['entry-2:token'],
    };
    imported.fieldsById['entry-2:token'] = {
      id: 'entry-2:token',
      sourceId: 'source-2',
      parentNodeId: 'entry-2',
      sourcePath: ['entry-2', 'token'],
      name: 'token',
      value: new SensitiveValue('second'),
      metadata: {},
    };
    let workspace = createPlan(createEmptyWorkspace(), {
      clientId: 'plan-1',
      name: 'Imported Plan',
    });
    workspace = createAsset(workspace, {
      planClientId: 'plan-1',
      asset: {
        id: 'entry-1:PLAIN-TEXT',
        type: 'PLAIN-TEXT',
        name: 'First',
        fieldBindings: {},
      },
    });
    workspace = createPlan(workspace, { clientId: 'plan-2', name: 'Surviving Plan' });
    workspace = createAsset(workspace, {
      planClientId: 'plan-2',
      asset: {
        id: 'asset-2',
        type: 'API-KEY',
        name: 'Second',
        fieldBindings: { 'secret.apiKey': { kind: 'source', sourceFieldId: 'entry-2:token' } },
      },
    });
    workspace = { ...workspace, ignoredSourceFieldIds: ['entry-1:token', 'entry-2:token'] };

    const next = removeSourceFromWorkspace(imported, workspace, 'source-1');

    expect(next.planOrder).toEqual(['plan-2']);
    expect(next.plansByClientId['plan-1']).toBeUndefined();
    expect(next.plansByClientId['plan-2'].assets.map((asset) => asset.id)).toEqual(['asset-2']);
    expect(next.ignoredSourceFieldIds).toEqual(['entry-2:token']);
    expect(next.revision).toBe(workspace.revision + 1);
  });
});
