import { Box, Button, Icon, Stack, Text, theme } from '@main-components';
import { getAssetTypeDisplayName } from '@modules/_shared/domain/asset-type-display-name';
import { keyboardActivation } from '@modules/_shared/ui/keyboard-activation';
import { getPlanAssetIconName } from '@modules/plans/domain/asset-metadata';
import { useId, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredPopover } from '@modules/_shared/ui/hooks/use-anchored-popover';
import './styles.css';
import type { ReviewAsset } from '../../types';
import { reviewPatterns, type ReviewPattern } from './patterns';

const pageSize = 20;

export function ReviewPatterns({
  assets,
  issues,
  onSelect,
}: {
  assets: ReviewAsset[];
  issues: ReadonlyMap<string, number>;
  onSelect: (pattern: ReviewPattern) => void;
}) {
  const { open, setOpen, triggerRef, panelRef, position } = useAnchoredPopover();
  const panelId = useId();
  useLayoutEffect(() => {
    if (open) panelRef.current?.focus({ preventScroll: true });
  }, [open, panelRef]);
  const select = (pattern: ReviewPattern) => {
    setOpen(false);
    onSelect(pattern);
  };
  const patterns = useMemo(
    () => (open ? reviewPatterns(assets, issues) : []),
    [open, assets, issues],
  );
  const [page, setPage] = useState(0);
  const lastPage = Math.max(0, Math.ceil(patterns.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const start = currentPage * pageSize;
  const end = Math.min(start + pageSize, patterns.length);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="asset-review-pattern-trigger"
        aria-label="Group similar entries"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
      >
        <Text variant="buttonSmall" color="primary120">
          Group similar entries
        </Text>
        <Box aria-hidden={true}>
          <Icon name="chevron-down" size={10} color="primary120" label="" />
        </Box>
      </button>
      {open
        ? createPortal(
            <Box
              ref={panelRef}
              nativeID={panelId}
              tabIndex={-1}
              role="region"
              aria-label="Group similar entries"
              className="asset-review-pattern-popover"
              backgroundColor="white"
              borderWidth={1}
              borderColor="gray10"
              borderRadius="m"
              padding="m"
              gap="s"
              style={{ ...position }}
            >
              <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap="s">
                <Text variant="bodySmall" semibold>
                  Group similar entries
                </Text>
                <Button
                  title="Close"
                  accessibilityLabel="Close similar entries"
                  variant="plain"
                  size="sm"
                  onPress={() => {
                    setOpen(false);
                    triggerRef.current?.focus({ preventScroll: true });
                  }}
                />
              </Box>
              {!patterns.length ? (
                <Text variant="bodySmall" color="gray" role="status">
                  No similar entries in this view. A group needs at least two entries with the same
                  source, asset type, and source fields.
                </Text>
              ) : (
                <Text variant="bodySmall" color="gray">
                  Groups share the same source, asset type and source fields. Select a group to
                  inspect one entry and select its matching assets.
                </Text>
              )}
              <Stack gap="xs" className="asset-review-pattern-list">
                {patterns.slice(start, end).map((pattern) => {
                  const type = getAssetTypeDisplayName(pattern.representative.type);
                  const icon = getPlanAssetIconName(pattern.representative.type);
                  const entries = `${pattern.assetIds.length} entries`;
                  const remaining = pattern.fieldNames.length - 3;
                  const fields = pattern.fieldNames.slice(0, 3).join(', ');
                  return (
                    <Box
                      key={pattern.key}
                      role="button"
                      className="asset-review-row"
                      aria-label={`Select ${type} group, ${entries}, ${pattern.source}${fields ? `, ${fields}` : ''}`}
                      flexDirection="row"
                      alignItems="center"
                      gap="s"
                      onClick={() => select(pattern)}
                      {...keyboardActivation(() => select(pattern))}
                    >
                      {icon ? (
                        <Icon name={icon} size={14} color={theme.colors.gray} label="" />
                      ) : null}
                      <Box flex={1} minWidth={0} gap="xxs">
                        <Text variant="bodySmall" semibold numberOfLines={1}>
                          {type} · {entries}
                        </Text>
                        <Text variant="bodySmall" color="gray" numberOfLines={1}>
                          {pattern.source}
                          {fields ? ` · ${fields}` : ''}
                          {remaining > 0 ? ` +${remaining}` : ''}
                        </Text>
                      </Box>
                      {pattern.issueCount ? (
                        <Text variant="bodySmall" color="gray">
                          {pattern.issueCount} {pattern.issueCount === 1 ? 'issue' : 'issues'}
                        </Text>
                      ) : null}
                    </Box>
                  );
                })}
              </Stack>
              {lastPage > 0 ? (
                <Box flexDirection="row" alignItems="center" gap="s" flexWrap="wrap">
                  <Text variant="bodySmall" color="gray">
                    Showing {start + 1}–{end} of {patterns.length} groups
                  </Text>
                  <Button
                    title="Previous groups"
                    variant="plain"
                    size="sm"
                    disabled={currentPage === 0}
                    onPress={() => setPage(currentPage - 1)}
                  />
                  <Button
                    title="More groups"
                    variant="plain"
                    size="sm"
                    disabled={currentPage === lastPage}
                    onPress={() => setPage(currentPage + 1)}
                  />
                </Box>
              ) : null}
            </Box>,
            document.body,
          )
        : null}
    </>
  );
}
