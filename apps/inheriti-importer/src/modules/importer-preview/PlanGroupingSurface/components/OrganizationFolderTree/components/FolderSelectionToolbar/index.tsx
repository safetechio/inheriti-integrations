import { useRef, useState } from 'react';
import { BaseModal, Box, Button, Icon, Text, Tooltip } from '@main-components';
import type { Folder, FolderWorkspaceProps } from '../../../../types';

export function FolderSelectionToolbar({ folders, workspace, localDraftCount, onClear }: {
  folders: Folder[]; workspace: FolderWorkspaceProps; localDraftCount: number; onClear: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const deleting = useRef(false);
  const [error, setError] = useState('');
  const dismiss = () => { if (!deleting.current) setConfirm(false); };
  const remove = async () => {
    if (deleting.current) return;
    deleting.current = true;
    setPending(true); setError('');
    try { await workspace.onDeleteFolders!(folders); setConfirm(false); onClear(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete folders.'); }
    finally { deleting.current = false; setPending(false); }
  };
  return <>
    <Box flexDirection="row" alignItems="center" gap="s"><Text variant="bodySmall">{folders.length} {folders.length === 1 ? 'folder' : 'folders'} selected</Text><Button title="Clear" size="sm" variant="plain" onPress={onClear}/>{workspace.onDeleteFolders ? <Tooltip content={localDraftCount > 0 ? `Move the ${localDraftCount} ${localDraftCount === 1 ? 'plan' : 'plans'} out of the selected folders before deleting them.` : undefined}><Button title="Delete selected" size="sm" color="danger" variant="plain" disabled={localDraftCount > 0} onPress={() => setConfirm(true)}/></Tooltip> : null}</Box>
    {confirm ? <BaseModal visible title="Delete folders?" titleIcon={<Icon name="trash" size={20} color="danger120"/>} onDismiss={dismiss} footer={<><Button title="Cancel" variant="outlined" color="gray" disabled={pending} onPress={dismiss}/><Button title={pending ? 'Deleting folders…' : 'Delete folders'} color="danger" loading={pending} disabled={pending || localDraftCount > 0} onPress={() => void remove()}/></>}><Box gap="s" backgroundColor="gray5" borderRadius="s" padding="m" style={{ borderWidth: 1, borderColor: '#e5e7eb' }}><Text variant="bodySmall" semibold>Folders to delete</Text><Text variant="bodySmall">{folders.length} {folders.length === 1 ? 'folder' : 'folders'} selected</Text><Text variant="bodySmall" color="gray">Delete the selected folders from the organisation? This cannot be undone.</Text>{localDraftCount ? <Text color="danger120">Move {localDraftCount} local draft plans first.</Text> : null}{error ? <Text color="danger120" accessibilityRole="alert">{error}</Text> : null}</Box></BaseModal> : null}
  </>;
}
