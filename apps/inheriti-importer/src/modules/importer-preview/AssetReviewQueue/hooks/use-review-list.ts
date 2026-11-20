import { useMemo, useState } from 'react';
import { hasIncludedSchemaField, type ReviewAsset, type AssetReviewQueueProps } from '../types';
import { sourceKey, sourceName } from '../review-tree';

export const statusFilters = [
  ['all', 'All'],
  ['review', 'To review'],
  ['accepted', 'Accepted'],
  ['excluded', 'Excluded'],
] as const;

export const exceptionFilters = [
  ['invalid', 'Invalid'],
  ['missing', 'Missing mappings'],
  ['omitted', 'Fields omitted'],
] as const;

export const isPending = (asset: ReviewAsset) =>
  asset.status !== 'accepted' && asset.status !== 'excluded';
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
  omitted: (asset: ReviewAsset) => asset.unmapped.length > 0,
};

export function useReviewList(
  assets: ReviewAsset[],
  sourceFiles: AssetReviewQueueProps['sourceFiles'],
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
  const result = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const exceptionCounts = { invalid: 0, missing: 0, omitted: 0 };
    const visible: ReviewAsset[] = [];
    const issues: ReviewAsset[] = [];
    for (const asset of assets) {
      if (
        (source !== 'all' && sourceKey(asset) !== source) ||
        !asset.name.toLocaleLowerCase().includes(query) ||
        (filter !== 'all' && (filter === 'review' ? !isPending(asset) : asset.status !== filter))
      )
        continue;
      let matches = true;
      let hasIssue = false;
      for (const [key] of exceptionFilters) {
        const found = Boolean(exceptions[key](asset));
        if (found) {
          exceptionCounts[key]++;
          hasIssue = true;
        }
        if (exception === key) matches = found;
      }
      if (!matches) continue;
      visible.push(asset);
      if (hasIssue) issues.push(asset);
    }
    return { visible, issues, exceptionCounts };
  }, [assets, exception, filter, search, source]);
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
