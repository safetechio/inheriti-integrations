import { Box, Button, Icon, Text } from '@main-components';
import { FolderPendingStatus } from '../FolderPendingStatus';
import { SelectionHelpPopover } from '../../../SelectionHelpPopover';

export function FolderTreeHeader({
  onNewFolder,
  canNewFolder,
  refreshing = false,
  query,
  onQueryChange,
  targetPath,
  onRootTarget,
  destinationWarning,
}: {
  onNewFolder: () => void;
  canNewFolder: boolean;
  refreshing?: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  targetPath: string;
  onRootTarget: () => void;
  destinationWarning: boolean;
}) {
  return (
    <Box className="folder-tree-header" gap="m">
      <Box className="folder-tree-heading" flexDirection="row" justifyContent="space-between" alignItems="flex-start" gap="s">
        <Box flexDirection="row" alignItems="center" gap="xs"><Text variant="heading3" className="folder-tree-title">Your organisation</Text><SelectionHelpPopover kind="organisation" /><FolderPendingStatus active={refreshing} label="Refreshing…" /></Box>
        <Button
          title="New folder"
          size="sm"
          variant="outlined"
          color="gray"
          startIcon={<Icon name="folder-plus" size={14} color="#1f2937" />}
          disabled={!canNewFolder}
          onPress={onNewFolder}
        />
      </Box>
      <Box className="folder-tree-controls" flexDirection="row" alignItems="center" gap="s">
        <Box className="folder-tree-search" flexDirection="row" alignItems="center" gap="s">
          <Icon name="magnifying-glass" size={15} color="#6b7280" />
          <input
            aria-label="Search folders or plans"
            placeholder="Search folders or plans…"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </Box>
      </Box>
      <Box className="folder-tree-destination" flexDirection="row" alignItems="center" gap="s">
        <Text variant="bodySmall">New plans go to</Text>
        <Box className="folder-tree-destination-pill" flexDirection="row" alignItems="center" gap="xs"
          role="button" tabIndex={0} aria-label="Use organisation root" onClick={onRootTarget}
          onKeyDown={(event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onRootTarget(); } }}
        >
          <Icon name="folder" size={12} color="#1d4ed8" />
          <Text variant="bodySmall">{targetPath}</Text>
        </Box>
        <Text variant="bodySmall" color="gray">· click a folder to change</Text>
      </Box>
      {destinationWarning ? (
        <Text variant="bodySmall" color="warning120">
          Set folder permissions before creating plans here.
        </Text>
      ) : null}
    </Box>
  );
}
