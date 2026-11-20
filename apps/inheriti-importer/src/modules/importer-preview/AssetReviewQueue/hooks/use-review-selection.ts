import { useMemo, useRef, useState } from 'react';
import type { ReviewAsset } from '../types';

export function useReviewSelection(assets: ReviewAsset[], rangeAssets: ReviewAsset[]) {
  const [ids, setIds] = useState<string[]>([]);
  const anchor = useRef<string | undefined>(undefined);
  const live = useMemo(() => new Set(assets.map((asset) => asset.id)), [assets]);
  const positions = useMemo(
    () => new Map(rangeAssets.map((asset, index) => [asset.id, index])),
    [rangeAssets],
  );
  const selectedIds = useMemo(() => ids.filter((id) => live.has(id)), [ids, live]);
  const selectedIdsSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const replace = (next: string[]) => {
    setIds(next);
    anchor.current = next[0];
  };
  const toggle = (id: string, range: boolean) => {
    const start = anchor.current === undefined ? undefined : positions.get(anchor.current);
    const end = positions.get(id);
    if (range && start !== undefined && end !== undefined) {
      setIds([
        ...new Set([
          ...selectedIds,
          ...rangeAssets
            .slice(Math.min(start, end), Math.max(start, end) + 1)
            .map((asset) => asset.id),
        ]),
      ]);
      return;
    }
    replace(
      selectedIdsSet.has(id)
        ? selectedIds.filter((selected) => selected !== id)
        : [...selectedIds, id],
    );
    anchor.current = id;
  };
  const toggleGroup = (group: string[]) => {
    const groupIds = new Set(group);
    replace(
      group.every((id) => selectedIdsSet.has(id))
        ? selectedIds.filter((id) => !groupIds.has(id))
        : [...new Set([...selectedIds, ...group])],
    );
    anchor.current = group[0];
  };
  return { selectedIds, selectedIdsSet, replace, toggle, toggleGroup };
}
