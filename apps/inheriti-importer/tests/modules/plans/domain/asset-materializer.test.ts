import { describe, expect, it } from 'vitest';
import { SensitiveValue, type ImportSession } from '@modules/import/domain/import-model';
import { materialiseAsset } from '@modules/plans/domain/asset-materializer';
import type { AssetDraft } from '@modules/plans/domain/workspace-model';

function session(fields: Record<string, string>): ImportSession {
  const fieldsById: ImportSession['fieldsById'] = {};
  for (const [id, value] of Object.entries(fields)) {
    fieldsById[id] = {
      id,
      sourceId: 's',
      parentNodeId: 'e',
      sourcePath: [id],
      name: id,
      value: new SensitiveValue(value),
      metadata: {},
    };
  }
  return { id: 's', sources: [], rootNodeIds: [], nodesById: {}, fieldsById };
}

describe('materialiseAsset', () => {
  it('resolves source + literal bindings into a nested secret object', () => {
    const draft: AssetDraft = {
      id: 'a1',
      type: 'USER-PSWD',
      name: 'GitHub',
      fieldBindings: {
        'secret.username': { kind: 'source', sourceFieldId: 'f-user' },
        'secret.password': { kind: 'source', sourceFieldId: 'f-pass' },
        'secret.appOrWebsite': { kind: 'literal', value: new SensitiveValue('github.com') },
      },
    };

    const { asset, errors } = materialiseAsset(
      draft,
      session({ 'f-user': 'octo', 'f-pass': 'p@ss' }),
    );

    expect(errors).toEqual([]);
    expect(asset).toEqual({
      id: 'a1',
      type: 'USER-PSWD',
      meta: { name: 'GitHub' },
      secret: { username: 'octo', password: 'p@ss', appOrWebsite: 'github.com' },
    });
  });

  it('reports MISSING_SOURCE_FIELD when a binding points at a gone field', () => {
    const draft: AssetDraft = {
      id: 'a1',
      type: 'PLAIN-TEXT',
      name: 'x',
      fieldBindings: { 'secret.text': { kind: 'source', sourceFieldId: 'nope' } },
    };
    const { errors } = materialiseAsset(draft, session({}));
    expect(errors).toEqual([
      expect.objectContaining({ assetFieldSource: 'secret.text', code: 'MISSING_SOURCE_FIELD' }),
    ]);
  });

  it('reports EMPTY_VALUE for a bound-but-empty field', () => {
    const draft: AssetDraft = {
      id: 'a1',
      type: 'PLAIN-TEXT',
      name: 'x',
      fieldBindings: { 'secret.text': { kind: 'source', sourceFieldId: 'blank' } },
    };
    const { errors } = materialiseAsset(draft, session({ blank: '' }));
    expect(errors[0]?.code).toBe('EMPTY_VALUE');
  });

  it('materialises a composite source binding as labeled lines', () => {
    const draft: AssetDraft = {
      id: 'a1',
      type: 'PLAIN-TEXT',
      name: 'Imported entry',
      fieldBindings: {
        'secret.text': {
          kind: 'sources',
          sources: [
            { sourceFieldId: 'user', name: 'username' },
            { sourceFieldId: 'pass', name: 'password' },
          ],
        },
      },
    };

    const { asset, errors } = materialiseAsset(draft, session({ user: 'octo', pass: 'secret' }));

    expect(errors).toEqual([]);
    expect(asset.secret.text).toBe('username: octo\npassword: secret');
  });
});
