import type { GroupingAsset } from '../../types';

export interface SourceTreeNode {
  key: string;
  name: string;
  source: boolean;
  children: SourceTreeNode[];
  assets: GroupingAsset[];
  descendants: GroupingAsset[];
}

export function buildSourceTree(assets: GroupingAsset[]): SourceTreeNode[] {
  const roots: SourceTreeNode[] = [];
  const nodes = new Map<string, SourceTreeNode>();
  for (const asset of assets) {
    const sourceId = asset.sourceId ?? asset.source ?? 'Unknown source';
    const path = [sourceId, ...(asset.folderPath ?? [])];
    let siblings = roots;
    let node: SourceTreeNode | undefined;
    for (let depth = 0; depth < path.length; depth++) {
      const key = JSON.stringify(path.slice(0, depth + 1));
      node = nodes.get(key);
      if (!node) {
        node = {
          key,
          name: depth ? path[depth]! : (asset.source ?? 'Unknown source'),
          source: depth === 0,
          children: [],
          assets: [],
          descendants: [],
        };
        nodes.set(key, node);
        siblings.push(node);
      }
      node.descendants.push(asset);
      siblings = node.children;
    }
    node!.assets.push(asset);
  }
  return roots;
}
