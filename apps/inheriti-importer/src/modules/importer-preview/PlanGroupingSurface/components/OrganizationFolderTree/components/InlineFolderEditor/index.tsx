import { useState } from 'react';
import { Box, Button, Icon, Text } from '@main-components';
import { TREE_ICON_NAMES } from '@/assets/file-type-icons/catalog';
import type { Folder } from '../../../../types';
import { FolderPendingStatus } from '../FolderPendingStatus';
import './styles.css';

export function InlineFolderEditor({
  folder,
  depth = 0,
  initialName,
  onDraftChange,
  pending,
  error,
  onSave,
  onCancel,
}: {
  folder?: Folder;
  depth?: number;
  initialName: string;
  onDraftChange: (name: string) => void;
  pending: boolean;
  showTeams?: boolean;
  teams?: Array<{ id: string; name: string }>;
  selectedTeamIds?: string[];
  onTeamChange?: (ids: string[]) => void;
  error: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);

  return (
    <Box
      className="folder-inline-editor"
      style={{ paddingLeft: depth * 28 + 16 }}
      onBlur={(event: FocusEvent) => {
        if (
          !(event.currentTarget as HTMLElement | null)?.contains(event.relatedTarget as Node | null)
        )
          if (folder) onSave(name);
      }}
    >
      <Box className="folder-inline-editor-content" flexDirection="row" alignItems="center" gap="xs">
        <Icon name={TREE_ICON_NAMES.folder} size={20} color="primary" />
        <input
          autoFocus
          aria-label={folder ? `Rename ${folder.name}` : 'New folder name'}
          placeholder={folder ? undefined : 'Type a name and press Enter'}
          value={name}
          disabled={pending}
          onChange={(event) => {
            const nextName = event.target.value;
            setName(nextName);
            onDraftChange(nextName);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSave(name);
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            }
          }}
        />
        <FolderPendingStatus active={pending} label={folder ? 'Saving…' : 'Creating…'} showIndicator={!folder} />
        {folder ? <Button title="Save" size="sm" loading={pending} disabled={pending} onPress={() => onSave(name)} /> : null}
      </Box>
      {error ? (
        <Text color="danger120" variant="bodySmall">
          {error}
        </Text>
      ) : null}
    </Box>
  );
}
