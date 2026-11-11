import { Box, Icon, FilterChip, NoItemsPlaceholder, Stack, Text, theme } from '@main-components';
import { useEffect, useState } from 'react';
import { AssetRow } from './components/AssetRow';
import { Inspector } from './components/Inspector';
import { hasIncludedSchemaField, type AssetReviewQueueProps } from './types';
import './styles.css';

export type {
  AssetReviewQueueProps,
  AssetReviewStatus,
  ReviewAsset,
  ReviewAssetField,
  ReviewAssetSourceCandidate,
} from './types';

export function AssetReviewQueue({
  assets,
  selectedId,
  onSelect,
  onAction,
  showKeyboardHints = true,
  resolveSourceValue,
  onMapField,
  onEditPlainText,
}: AssetReviewQueueProps) {
  const [filter, setFilter] = useState<'all' | 'review' | 'accepted' | 'excluded'>(() =>
    assets.some((asset) => !['accepted', 'excluded'].includes(asset.status)) ? 'review' : 'all',
  );
  const [source, setSource] = useState('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'list' | 'tree'>('list');
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set());
  const sourceKey = (asset: (typeof assets)[number]) =>
    asset.sourceId ?? asset.sourceFileName ?? asset.source.split(' · ')[0];
  const sources = [
    ...new Map(
      assets.map((asset) => [
        sourceKey(asset),
        asset.sourceFileName ?? asset.source.split(' · ')[0],
      ]),
    ).entries(),
  ];
  const reviewed = assets.filter((asset) => ['accepted', 'excluded'].includes(asset.status)).length;
  const counts = {
    all: assets.length,
    review: assets.length - reviewed,
    accepted: assets.filter((asset) => asset.status === 'accepted').length,
    excluded: assets.filter((asset) => asset.status === 'excluded').length,
  };
  const visible = assets.filter(
    (asset) =>
      (source === 'all' || sourceKey(asset) === source) &&
      (!search.trim() ||
        asset.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) &&
      (filter === 'all' ||
        (filter === 'review' && !['accepted', 'excluded'].includes(asset.status)) ||
        filter === asset.status),
  );
  const selected = visible.find((asset) => asset.id === selectedId) ?? visible[0];
  const canShowTree =
    source !== 'all' &&
    assets.some((asset) => sourceKey(asset) === source && Boolean(asset.folderPath?.length));
  const folderCounts = new Map<string, number>();
  for (const asset of visible) {
    const parts = asset.folderPath ?? [];
    for (let index = 0; index < parts.length; index++) {
      const path = parts.slice(0, index + 1).join('/');
      folderCounts.set(path, (folderCounts.get(path) ?? 0) + 1);
    }
  }
  const rows =
    view === 'tree' && canShowTree
      ? visible.flatMap((asset) => {
          const parts = asset.folderPath ?? [];
          const entries: {
            key: string;
            label?: string;
            count?: number;
            depth: number;
            asset?: typeof asset;
          }[] = [];
          for (let index = 0; index < parts.length; index++) {
            const key = parts.slice(0, index + 1).join('/');
            if (
              !visible
                .slice(0, visible.indexOf(asset))
                .some((prior) => prior.folderPath?.slice(0, index + 1).join('/') === key)
            )
              entries.push({
                key: `folder:${key}`,
                label: parts[index],
                count: folderCounts.get(key),
                depth: index,
              });
          }
          if (parts.every((_, index) => openFolders.has(parts.slice(0, index + 1).join('/'))))
            entries.push({ key: asset.id, asset, depth: parts.length });
          return entries;
        })
      : visible.map((asset) => ({
          key: asset.id,
          asset,
          depth: 0,
          label: undefined,
          count: undefined,
        }));

  useEffect(() => {
    if (filter === 'review' && counts.review === 0) setFilter('all');
  }, [counts.review, filter]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!selected || !onAction) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing || event.repeat)
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.matches("input, textarea, select, [contenteditable='true']")
      )
        return;
      if (
        event.key.toLowerCase() === 'a' &&
        selected.status !== 'accepted' &&
        hasIncludedSchemaField(selected)
      )
        onAction('accept', selected);
      if (event.key.toLowerCase() === 'x' && selected.status !== 'excluded')
        onAction('exclude', selected);
      if (!['ArrowUp', 'ArrowDown'].includes(event.key) || !onSelect) return;
      event.preventDefault();
      const currentIndex = visible.findIndex((asset) => asset.id === selected.id);
      const offset = event.key === 'ArrowUp' ? -1 : 1;
      const nextIndex = Math.min(visible.length - 1, Math.max(0, currentIndex + offset));
      if (visible[nextIndex]) onSelect(visible[nextIndex]);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onAction, onSelect, selected, visible]);
  return (
    <Stack gap="m" className="asset-review-surface" style={{ gap: 12 }}>
      <Box flexDirection="row" alignItems="flex-end" gap="s" className="asset-review-toolbar">
        <label className="asset-review-source-label">
          Source
          <select
            aria-label="Filter by source"
            value={source}
            onChange={(event) => setSource(event.target.value)}
          >
            <option value="all">All sources</option>
            {sources.map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </label>
        {searchOpen ? (
          <Box flexDirection="row" alignItems="center" className="asset-review-search">
            <Icon name="magnifying-glass" size={14} color="gray" />
            <input
              autoFocus
              aria-label="Search assets"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search assets"
            />
            {search ? (
              <button type="button" aria-label="Clear asset search" onClick={() => setSearch('')}>
                ×
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Close asset search"
              onClick={() => {
                setSearchOpen(false);
                setSearch('');
              }}
            >
              Close
            </button>
          </Box>
        ) : (
          <button
            type="button"
            className="asset-review-search-toggle"
            aria-label="Search assets"
            onClick={() => setSearchOpen(true)}
          >
            <Icon name="magnifying-glass" size={16} color="gray" />
          </button>
        )}
      </Box>
      <Box flexDirection="row" alignItems="center" gap="s" style={{ flexWrap: 'wrap' }}>
        <Box flexDirection="row" gap="s" style={{ flexWrap: 'wrap' }}>
          {(
            [
              ['all', 'All'],
              ['review', 'To review'],
              ['accepted', 'Accepted'],
              ['excluded', 'Excluded'],
            ] as const
          ).map(([value, label]) => (
            <FilterChip
              key={value}
              variant="tab"
              count={counts[value]}
              selected={filter === value}
              onPress={() => setFilter(value)}
            >
              {label}
            </FilterChip>
          ))}
        </Box>
        {showKeyboardHints ? (
          <Text
            variant="bodySmall"
            color="gray"
            style={{ fontSize: 12, lineHeight: 16, marginLeft: 'auto' }}
          >
            Shortcuts: A accept · X exclude · ↑↓ move
          </Text>
        ) : null}
      </Box>
      {canShowTree ? (
        <Box flexDirection="row" gap="s" className="asset-review-view-picker">
          <FilterChip
            selected={view === 'list'}
            onPress={() => setView('list')}
            accessibilityLabel="List"
            icon={
              <Icon
                name="list"
                size={16}
                color={view === 'list' ? theme.colors.primary120 : theme.colors.gray}
              />
            }
          >
            List
          </FilterChip>
          <FilterChip
            selected={view === 'tree'}
            onPress={() => setView('tree')}
            accessibilityLabel="Tree"
            icon={
              <Icon
                name="sitemap"
                size={16}
                color={view === 'tree' ? theme.colors.primary120 : theme.colors.gray}
              />
            }
          >
            Tree
          </FilterChip>
        </Box>
      ) : null}
      <Box
        flexDirection="row"
        gap="m"
        className="asset-review-columns"
        style={{ flexWrap: 'wrap' }}
      >
        <Stack gap="s" className="asset-review-queue">
          {!assets.length ? (
            <NoItemsPlaceholder description="No Assets were detected. Add another source containing value-bearing entries." />
          ) : !visible.length ? (
            <NoItemsPlaceholder description="No Assets match this filter." />
          ) : null}
          {rows.map((row) =>
            row.asset ? (
              <Box key={row.key} style={{ paddingLeft: row.depth * 16 }}>
                <AssetRow
                  asset={row.asset}
                  selected={row.asset.id === selected?.id}
                  onSelect={onSelect}
                />
              </Box>
            ) : (
              <button
                key={row.key}
                type="button"
                className="asset-review-folder"
                style={{ paddingLeft: row.depth * 16 + 8 }}
                onClick={() =>
                  setOpenFolders((current) => {
                    const next = new Set(current);
                    const path = row.key.slice(7);
                    if (next.has(path)) next.delete(path);
                    else next.add(path);
                    return next;
                  })
                }
              >
                {openFolders.has(row.key.slice(7)) ? '⌄' : '›'} {row.label} ({row.count})
              </button>
            ),
          )}
        </Stack>
        <Box className="asset-review-inspector">
          <Inspector
            asset={selected}
            onAction={onAction}
            resolveSourceValue={resolveSourceValue}
            onMapField={onMapField}
            onEditPlainText={onEditPlainText}
          />
        </Box>
      </Box>
    </Stack>
  );
}

export default AssetReviewQueue;
