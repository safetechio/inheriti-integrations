import type { ReviewAsset } from './types';

export const sourceKey = (asset: ReviewAsset) =>
  asset.sourceId ?? asset.sourceFileName ?? asset.source.split(' · ')[0];

export const sourceName = (asset: ReviewAsset) =>
  asset.sourceFileName ?? asset.source.split(' · ')[0];

interface Group {
  key: string;
  label: string;
  children: Map<string, Group | ReviewAsset>;
  assetIds: string[];
}

export type ReviewRow =
  { key: string; depth: number; asset: ReviewAsset } | { key: string; depth: number; group: Group };

export function indexReviewTree(
  assets: ReviewAsset[],
  allSources: boolean,
  sources: Map<string, string>,
) {
  const root: Group = { key: '', label: '', children: new Map(), assetIds: [] };
  const paths = new Map<string, string[]>();
  for (const asset of assets) {
    const source = sourceKey(asset);
    let parent = root;
    let path = JSON.stringify(source);
    const parents: string[] = [];
    const segments = [
      ...(allSources ? [[`source:${source}`, sources.get(source) ?? sourceName(asset)]] : []),
      ...(asset.folderPath ?? []).map((folder) => [`folder:${folder}`, folder]),
    ];
    for (const [segment, label] of segments) {
      path += JSON.stringify(segment);
      let group = parent.children.get(segment) as Group | undefined;
      if (!group) {
        group = { key: path, label, children: new Map(), assetIds: [] };
        parent.children.set(segment, group);
      }
      group.assetIds.push(asset.id);
      parents.push(path);
      parent = group;
    }
    parent.children.set(`asset:${asset.id}`, asset);
    paths.set(asset.id, parents);
  }
  return { root, paths };
}

export function flattenReviewTree(root: Group, open: ReadonlySet<string>): ReviewRow[] {
  const rows: ReviewRow[] = [];
  const visit = (node: Group, depth: number) => {
    for (const child of node.children.values()) {
      if ('children' in child) {
        rows.push({ key: child.key, depth, group: child });
        if (open.has(child.key)) visit(child, depth + 1);
      } else {
        rows.push({ key: child.id, depth, asset: child });
      }
    }
  };
  visit(root, 0);
  return rows;
}
