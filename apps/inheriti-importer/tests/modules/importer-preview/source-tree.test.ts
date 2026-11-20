import { describe, expect, it } from 'vitest';
import type { GroupingAsset } from '@modules/importer-preview/PlanGroupingSurface';
import { buildSourceTree } from '@modules/importer-preview/PlanGroupingSurface/components/SourceAssetTree/source-tree';

const asset = (id: string, source: string, folderPath?: string[], sourceId?: string): GroupingAsset => ({
  id,
  name: id,
  type: 'USER-PSWD',
  source,
  sourceId,
  folderPath,
  valid: true,
});

describe('buildSourceTree', () => {
  it('returns no roots for an empty asset list', () => {
    expect(buildSourceTree([])).toEqual([]);
  });

  it('keeps root assets and nested descendants counts separate', () => {
    const [root, nested] = buildSourceTree([
      asset('root', 'vault.json'),
      asset('nested', 'vault.json', ['payments', 'prod']),
    ]);

    expect(root).toMatchObject({ name: 'vault.json', source: true, assets: [{ id: 'root' }] });
    expect(root.descendants).toHaveLength(2);
    expect(root.children).toHaveLength(1);
    expect(root.children[0]).toMatchObject({
      name: 'payments',
      descendants: [{ id: 'nested' }],
      assets: [],
    });
    expect(root.children[0]!.children[0]).toMatchObject({
      name: 'prod',
      descendants: [{ id: 'nested' }],
      assets: [{ id: 'nested' }],
      children: [],
    });
    expect(nested).toBeUndefined();
  });

  it('does not merge literal slash segments into the same path', () => {
    const [root] = buildSourceTree([
      asset('literal-slash', 'vault.json', ['payments/prod']),
      asset('segmented', 'vault.json', ['payments', 'prod']),
    ]);

    expect(root.children).toHaveLength(2);
    expect(root.children.map((node) => node.name)).toEqual(['payments/prod', 'payments']);
    expect(root.children[0]!.descendants.map(({ id }) => id)).toEqual(['literal-slash']);
    expect(root.children[1]!.children[0]!.descendants.map(({ id }) => id)).toEqual(['segmented']);
  });

  it('keeps identical source filenames separate when source IDs differ', () => {
    const roots = buildSourceTree([
      asset('first', 'export.json', ['shared'], 'source-a'),
      asset('second', 'export.json', ['shared'], 'source-b'),
    ]);

    expect(roots).toHaveLength(2);
    expect(roots.map((node) => node.name)).toEqual(['export.json', 'export.json']);
    expect(roots.map((node) => node.key)).not.toEqual([roots[0]!.key, roots[0]!.key]);
    expect(roots.map((node) => node.descendants.map(({ id }) => id))).toEqual([
      ['first'],
      ['second'],
    ]);
  });
});
