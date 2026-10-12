import {
  Box,
  FilterChip,
  NoItemsPlaceholder,
  PanelHeader,
  ProgressBar,
  Stack,
  Text,
} from '@main-components';
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
  description = 'Accept or exclude every detected Asset before continuing.',
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
  const reviewed = assets.filter((asset) => ['accepted', 'excluded'].includes(asset.status)).length;
  const counts = {
    all: assets.length,
    review: assets.length - reviewed,
    accepted: assets.filter((asset) => asset.status === 'accepted').length,
    excluded: assets.filter((asset) => asset.status === 'excluded').length,
  };
  const visible = assets.filter(
    (asset) =>
      filter === 'all' ||
      (filter === 'review' && !['accepted', 'excluded'].includes(asset.status)) ||
      filter === asset.status,
  );
  const selected = visible.find((asset) => asset.id === selectedId) ?? visible[0];

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
      if (event.key.toLowerCase() === 'a' && hasIncludedSchemaField(selected))
        onAction('accept', selected);
      if (event.key.toLowerCase() === 'x') onAction('exclude', selected);
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
    <Stack gap="m" style={{ gap: 12 }}>
      <PanelHeader
        title="Detected Assets"
        actions={
          <Text variant="bodySmall" color="gray">
            {reviewed} of {assets.length} decided
          </Text>
        }
      >
        {description ? (
          <Text variant="bodySmall" color="gray" style={{ fontSize: 13, opacity: 0.8 }}>
            {description}
          </Text>
        ) : null}
      </PanelHeader>
      <ProgressBar value={reviewed} max={assets.length || 1} label="Assets reviewed" />
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
            <FilterChip key={value} selected={filter === value} onPress={() => setFilter(value)}>
              {label} · {counts[value]}
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
          {visible.map((asset) => (
            <AssetRow
              key={asset.id}
              asset={asset}
              selected={asset.id === selected?.id}
              onSelect={onSelect}
            />
          ))}
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
