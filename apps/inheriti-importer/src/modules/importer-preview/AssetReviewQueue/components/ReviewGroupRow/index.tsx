import { Box, Checkbox, Icon, Text, theme } from '@main-components';
import type { ReviewRow } from '../../review-tree';

export function ReviewGroupRow({
  row,
  expanded,
  selection,
  onExpand,
  onToggle,
}: {
  row: Extract<ReviewRow, { group: unknown }>;
  expanded: boolean;
  selection: ReadonlySet<string>;
  onExpand: () => void;
  onToggle?: () => void;
}) {
  const { label, assetIds } = row.group;
  const selectedCount = assetIds.reduce((count, id) => count + Number(selection.has(id)), 0);
  return (
    <Box
      className="asset-review-group"
      flexDirection="row"
      alignItems="center"
      gap="s"
      style={{ paddingLeft: row.depth * 16 }}
    >
      {onToggle ? (
        <Checkbox
          aria-label={`Select assets in ${label}`}
          checked={selectedCount === assetIds.length}
          mixed={selectedCount > 0 && selectedCount < assetIds.length}
          readOnly
          onClick={onToggle}
        />
      ) : null}
      <button
        type="button"
        className="asset-review-folder"
        aria-label={`${label} (${assetIds.length})`}
        aria-expanded={expanded}
        onClick={onExpand}
      >
        <Text className="asset-review-folder-chevron" color="gray50" aria-hidden="true">
          {expanded ? '⌄' : '›'}
        </Text>
        <Icon name="folder" type="font-awesome-6" size={18} color={theme.colors.gray} />
        <Text className="asset-review-folder-name" color="gray120" semibold>
          {label}
        </Text>
        <Text className="asset-review-folder-count" color="gray50">
          {assetIds.length} {assetIds.length === 1 ? 'asset' : 'assets'}
        </Text>
      </button>
    </Box>
  );
}
