import { useMemo, useState } from 'react';
import {
  hasIncludedSchemaField,
  type ReviewAsset,
  type AssetReviewQueueProps,
  type ImportCoverage,
} from '../types';
import { sourceKey, sourceName } from '../review-tree';
import { indexAssetReviewIssues } from '../asset-review-issues';
import { isUndecided } from '../review-blockers';

export const statusFilters = [
  ['all', 'All'],
  ['review', 'To review'],
  ['accepted', 'Accepted'],
  ['excluded', 'Excluded'],
] as const;

export const exceptionFilters = [
  ['invalid', 'Invalid'],
  ['missing', 'Missing mappings'],
  ['omitted', 'Unmapped fields'],
] as const;

export const isPending = isUndecided;
const exceptions = {
  invalid: (asset: ReviewAsset) => !hasIncludedSchemaField(asset),
  missing: (asset: ReviewAsset) => {
    const secrets = asset.schemaFields?.filter((field) => field.key.startsWith('secret.'));
    if (!secrets?.length) return false;
    if (asset.type === 'PLAIN-TEXT') {
      return (
        !asset.plainTextValue &&
        !asset.plainTextSources?.length &&
        !secrets.some((field) => field.sourceFieldId)
      );
    }
    return (
      !secrets.some((field) => field.sourceFieldId) ||
      secrets.some((field) => !field.sourceFieldId && (field.required || field.validationError))
    );
  },
};

export function useReviewList(
  assets: ReviewAsset[],
  sourceFiles: AssetReviewQueueProps['sourceFiles'],
  coverage?: ImportCoverage,
) {
  const [filter, setFilter] = useState<(typeof statusFilters)[number][0]>(() =>
    assets.some(isPending) ? 'review' : 'all',
  );
  const [exception, setException] = useState<(typeof exceptionFilters)[number][0] | undefined>();
  const [source, setSource] = useState('all');
  const [search, setSearch] = useState('');
  const sources = useMemo(() => {
    const result = new Map((sourceFiles ?? []).map((file) => [file.id ?? file.name, file.name]));
    for (const asset of assets) {
      const id = sourceKey(asset);
      if (!result.has(id)) result.set(id, sourceName(asset));
    }
    return result;
  }, [assets, sourceFiles]);
  const { counts, eligibleCount } = useMemo(() => {
    const counts = { all: assets.length, review: 0, accepted: 0, excluded: 0 };
    let eligibleCount = 0;
    for (const asset of assets) {
      if (isPending(asset)) {
        counts.review++;
        if (hasIncludedSchemaField(asset)) eligibleCount++;
      } else if (asset.status === 'accepted') counts.accepted++;
      else counts.excluded++;
    }
    return { counts, eligibleCount };
  }, [assets]);
  const entries = useMemo(() => {
    const getIssues = indexAssetReviewIssues(assets, coverage);
    return assets.map((asset) => {
      const assetIssues = asset.status === 'excluded' ? undefined : getIssues(asset);
      return {
        asset,
        source: sourceKey(asset),
        searchName: asset.name.toLocaleLowerCase(),
        status: isPending(asset) ? 'review' : asset.status,
        issueCount: assetIssues?.issueCount ?? 0,
        exceptions: {
          invalid: exceptions.invalid(asset),
          missing: exceptions.missing(asset),
          omitted: Boolean(coverage ? assetIssues?.unresolved.length : asset.unmapped.length),
        },
      };
    });
  }, [assets, coverage]);
  const result = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const exceptionCounts = { invalid: 0, missing: 0, omitted: 0 };
    const visible: ReviewAsset[] = [];
    const issues = new Map<string, number>();
    let issueCount = 0;
    for (const entry of entries) {
      if (
        (source !== 'all' && entry.source !== source) ||
        !entry.searchName.includes(query) ||
        (filter !== 'all' && filter !== entry.status)
      )
        continue;
      for (const [key] of exceptionFilters) {
        if (entry.exceptions[key]) exceptionCounts[key]++;
      }
      if (exception && !entry.exceptions[exception]) continue;
      visible.push(entry.asset);
      if (entry.issueCount) {
        issues.set(entry.asset.id, entry.issueCount);
        issueCount += entry.issueCount;
      }
    }
    return { visible, issues, issueCount, exceptionCounts };
  }, [entries, exception, filter, search, source]);
  const canShowTree = useMemo(
    () =>
      source === 'all'
        ? sources.size > 1 || assets.some((asset) => asset.folderPath?.length)
        : assets.some((asset) => sourceKey(asset) === source && asset.folderPath?.length),
    [assets, source, sources],
  );
  return {
    source,
    setSource,
    search,
    setSearch,
    filter,
    setFilter,
    exception,
    setException,
    sources,
    counts,
    eligibleCount,
    canShowTree,
    ...result,
  };
}
