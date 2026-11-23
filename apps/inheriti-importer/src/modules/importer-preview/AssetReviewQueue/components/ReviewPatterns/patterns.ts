import { sourceName } from '../../review-tree';
import type { ReviewAsset } from '../../types';

function sourceFieldNames(asset: ReviewAsset): string[] {
  const names = new Set(asset.unmapped);
  for (const field of asset.schemaFields ?? []) {
    if (field.sourceFieldName) names.add(field.sourceFieldName);
    for (const { name } of field.candidates ?? []) names.add(name);
  }
  for (const { name } of asset.plainTextSources ?? []) names.add(name);
  return [...names].sort();
}

export interface ReviewPattern {
  key: string;
  source: string;
  fieldNames: string[];
  representative: ReviewAsset;
  assetIds: string[];
  issueCount: number;
}

export function reviewPatterns(
  assets: ReviewAsset[],
  issues: ReadonlyMap<string, number>,
): ReviewPattern[] {
  const groups = new Map<string, Map<string, ReviewAsset | null>>();
  for (const asset of assets) {
    const key = JSON.stringify([
      asset.sourceId ?? asset.source,
      asset.type,
      asset.sourcePatternKey ?? [
        sourceFieldNames(asset),
        asset.schemaFields?.map(({ key, required }) => [key, Boolean(required)]).sort(),
      ],
    ]);
    let entries = groups.get(key);
    if (!entries) {
      entries = new Map();
      groups.set(key, entries);
    }
    const entry =
      asset.sourceNodeId === undefined ? `asset:${asset.id}` : `entry:${asset.sourceNodeId}`;
    const previous = entries.get(entry);
    // When the entry proposes multiple matching assets, leave its selection to the user.
    entries.set(entry, previous === undefined || previous?.id === asset.id ? asset : null);
  }

  const patterns: ReviewPattern[] = [];
  for (const [key, entries] of groups) {
    const members = new Map<string, ReviewAsset>();
    for (const asset of entries.values()) {
      if (asset) members.set(asset.id, asset);
    }
    const representative = members.values().next().value;
    if (members.size < 2 || !representative) continue;
    const assetIds = [...members.keys()];
    patterns.push({
      key,
      source: sourceName(representative),
      fieldNames: sourceFieldNames(representative),
      representative,
      assetIds,
      issueCount: assetIds.reduce((count, id) => count + (issues.get(id) ?? 0), 0),
    });
  }
  return patterns;
}
