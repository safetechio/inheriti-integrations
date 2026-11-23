import { useMemo, useState, type ReactNode } from 'react';
import { Box, Button, Checkbox, FileTypeIcon, Icon, IconAction, Text, theme } from '@main-components';
import { TREE_ICON_NAMES } from '@/assets/file-type-icons/catalog';
import type { GroupingAsset } from '../../types';
import type { useAssetSelection } from '../../hooks/use-asset-selection';
import type { usePlanGrouping } from '../../hooks/use-plan-grouping';
import { buildSourceTree, type SourceTreeNode } from './source-tree';
import { setItemDragImage } from '@modules/_shared/ui/drag/set-item-drag-image';

export function SourceAssetTree({
  assets,
  selection,
  grouping,
  renderAsset,
}: {
  assets: GroupingAsset[];
  selection?: ReturnType<typeof useAssetSelection>;
  grouping: ReturnType<typeof usePlanGrouping>;
  renderAsset: (asset: GroupingAsset, visibleRows: GroupingAsset[]) => ReactNode;
}) {
  const roots = useMemo(() => buildSourceTree(assets), [assets]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const initialOpen = useMemo(() => {
    const open = new Set<string>();
    let first: SourceTreeNode | undefined = roots[0];
    while (first) {
      open.add(first.key);
      first = first.children[0];
    }
    return open;
  }, [roots]);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const selected = selection?.selectedIdSet;
  const toggle = (key: string, open: boolean) =>
    setExpanded((current) => ({ ...current, [key]: !open }));
  const visibleRows = useMemo(() => {
    const rows: GroupingAsset[] = [];
    const collectVisibleRows = (node: SourceTreeNode) => {
      if (!(expanded[node.key] ?? initialOpen.has(node.key))) return;
      const limit = limits[node.key] ?? 100;
      node.children.slice(0, limit).forEach(collectVisibleRows);
      rows.push(...node.assets.slice(0, limit));
    };
    roots.forEach(collectVisibleRows);
    return rows;
  }, [roots, limits, expanded, initialOpen]);
  const row = (node: SourceTreeNode, depth: number): ReactNode => {
    const open = expanded[node.key] ?? initialOpen.has(node.key);
    const checked = node.descendants.every((asset) => selected?.has(asset.id));
    const partial = !checked && node.descendants.some((asset) => selected?.has(asset.id));
    const limit = limits[node.key] ?? 100;
    const draggable = !!selection && node.descendants.every((asset) => asset.valid !== false);
    return (
      <Box key={node.key}>
        <Box
          className="plan-source-group"
          flexDirection="row"
          alignItems="center"
          gap="xs"
          style={{ paddingLeft: depth * 20 }}
          draggable={draggable}
          onClick={(event: MouseEvent) => {
            if (!(event.ctrlKey || event.metaKey)) return;
            if ((event.target as HTMLElement).closest('button, input, [role="button"], [role="checkbox"]')) return;
            event.stopPropagation();
            selection?.selectGroup(node.descendants, { ctrlKey: event.ctrlKey, metaKey: event.metaKey });
          }}
          onDragStart={(event: DragEvent) => {
            if (!draggable || !event.dataTransfer) return;
            selection.startDrag(
              node.descendants[0]!.id,
              node.descendants.map((asset) => asset.id),
            );
            grouping.startDrag(node.descendants[0]!.id);
            setItemDragImage(event.dataTransfer!, event.currentTarget as HTMLElement, node.name, node.descendants.length, `${node.descendants.length} ${node.descendants.length === 1 ? 'asset' : 'assets'}`, '[data-drag-icon]');
          }}
          onDragEnd={() => {
            selection?.endDrag();
            grouping.endDrag();
          }}
        >
          {selection ? (
            <Icon name="grip-dots-vertical" size={12} color={theme.colors.gray50} />
          ) : null}
          {selection ? (
            <Checkbox
              aria-label={`Select ${node.source ? 'source' : 'folder'} ${node.name}`}
              checked={checked}
              mixed={partial}
              readOnly
              onClick={(event) => {
                event.stopPropagation();
                selection.selectGroup(node.descendants, {
                  toggle: true,
                  ctrlKey: event.ctrlKey,
                  metaKey: event.metaKey,
                });
              }}
            />
          ) : null}
          <IconAction
            name={open ? TREE_ICON_NAMES.collapse : TREE_ICON_NAMES.expand}
            label={`${open ? 'Collapse' : 'Expand'} ${node.source ? 'source' : 'folder'} ${node.name}`}
            onPress={() => toggle(node.key, open)}
          />
          <Box dataSet={{ dragIcon: '' }}>{node.source ? (
            <FileTypeIcon extension={node.name} size={17} />
          ) : (
            <Icon name={TREE_ICON_NAMES.folder} size={16} color="gray" />
          )}</Box>
          <Text variant="bodySmall" style={{ flex: 1, minWidth: 0 }} numberOfLines={1}>
            {node.name}
          </Text>
          <Text variant="bodySmall" color="gray">
            {node.descendants.length}
          </Text>
        </Box>
        {open ? (
          <>
            {node.children.slice(0, limit).map((child) => row(child, depth + 1))}
            <Box className="plan-source-leaves" style={{ paddingLeft: (depth + 1) * 20 }}>
              {node.assets.slice(0, limit).map((asset) => renderAsset(asset, visibleRows))}
            </Box>
            {Math.max(node.children.length, node.assets.length) > limit ? (
              <Button
                title={`Load more in ${node.name}`}
                size="sm"
                variant="plain"
                onPress={() => setLimits((current) => ({ ...current, [node.key]: limit + 100 }))}
              />
            ) : null}
          </>
        ) : null}
      </Box>
    );
  };
  return <Box>{roots.map((node) => row(node, 0))}</Box>;
}
