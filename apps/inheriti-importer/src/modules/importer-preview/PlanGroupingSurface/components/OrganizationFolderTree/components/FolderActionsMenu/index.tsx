import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BaseModal, Box, Button, Icon, IconAction, Text } from '@main-components';
import type { Folder, FolderWorkspaceProps } from '../../../../types';
import { FolderPermissionsModal } from '../FolderPermissionsModal';
import { FolderMoveModal } from '../FolderMoveModal';

export function FolderActionsMenu({ folder, workspace, canCreatePlan, onCreatePlan, onNewSubfolder, onRename, localDraftCount = 0, editingPending = false }: {
  folder: Folder; workspace: FolderWorkspaceProps; canCreatePlan: boolean; onCreatePlan?: () => void;
  onNewSubfolder: () => void; onRename: () => void; localDraftCount?: number; editingPending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<'permissions' | 'move' | 'delete'>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const deleting = useRef(false);
  const [position, setPosition] = useState<{ top: number; left: number; maxHeight: number }>();
  const anchor = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const trigger = anchor.current;
    const menu = panel.current;
    if (!open || !trigger || !menu) return;
    const update = () => {
      const margin = 8;
      const gap = 4;
      const rect = trigger.getBoundingClientRect();
      const width = menu.getBoundingClientRect().width;
      const height = menu.scrollHeight + menu.offsetHeight - menu.clientHeight;
      const bottomEdge = Math.max(margin, window.innerHeight - margin);
      const belowTop = Math.min(bottomEdge, Math.max(margin, rect.bottom + gap));
      const aboveBottom = Math.min(bottomEdge, Math.max(margin, rect.top - gap));
      const below = bottomEdge - belowTop;
      const above = aboveBottom - margin;
      const opensAbove = height > below && above > below;
      const maxHeight = opensAbove ? above : below;
      setPosition({
        top: opensAbove ? aboveBottom - Math.min(height, maxHeight) : belowTop,
        left: Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin)),
        maxHeight,
      });
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(menu);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent | MouseEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return;
        anchor.current?.querySelector<HTMLElement>('[role="button"]')?.focus(); setOpen(false);
      } else if (!anchor.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', close); document.addEventListener('mousedown', close);
    return () => { document.removeEventListener('keydown', close); document.removeEventListener('mousedown', close); };
  }, [open]);
  const item = (title: string, icon: string, enabled: boolean, action: () => void, danger = false) =>
    <button aria-label={title} className={`folder-menu-item${danger ? ' is-danger' : ''}`} disabled={!enabled} onClick={() => { setOpen(false); action(); }}><Icon name={icon} size={14} color="currentColor"/>{title}</button>;
  const dismissDelete = () => { if (!deleting.current) setDialog(undefined); };
  const deleteFolder = async () => {
    if (deleting.current) return;
    deleting.current = true;
    setPending(true); setError('');
    try { await workspace.onDeleteFolder!(folder); setDialog(undefined); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete folder.'); }
    finally { deleting.current = false; setPending(false); }
  };
  return <>
    <Box ref={anchor} className="folder-menu">
      <IconAction name="ellipsis-vertical" label={`Actions for ${folder.name}`} onPress={() => setOpen(value => !value)}/>
      {open ? createPortal(<Box ref={panel} className="folder-menu-popover" style={{ ...position, maxWidth: 'calc(100vw - 16px)', overflowY: 'auto' }}>
        {item('New plan', 'file-lock', Boolean(onCreatePlan && canCreatePlan), () => onCreatePlan?.())}
        {item('New subfolder', 'folder-plus', Boolean(workspace.onCreateFolder) && !editingPending, onNewSubfolder)}
        <Box className="folder-menu-separator"/>
        {item('Rename', 'pen', Boolean(workspace.onRenameFolder) && !editingPending, onRename)}
        {workspace.onMoveFolder ? item('Move to', 'folder-open', true, () => setDialog('move')) : null}
        {folder.scope === 'SHARED' && workspace.onChangeFolderPolicy ? item('Permissions', 'user-shield', true, () => setDialog('permissions')) : null}
        {workspace.onDeleteFolder ? <><Box className="folder-menu-separator"/>{item('Delete', 'trash', localDraftCount === 0, () => setDialog('delete'), true)}</> : null}
      </Box>, document.body) : null}
    </Box>
    {dialog === 'permissions' ? <FolderPermissionsModal folder={folder} workspace={workspace} onDismiss={() => setDialog(undefined)}/> : null}
    {dialog === 'move' ? <FolderMoveModal folder={folder} workspace={workspace} onDismiss={() => setDialog(undefined)}/> : null}
    {dialog === 'delete' ? <BaseModal visible title="Delete folder?" titleIcon={<Icon name="trash" size={20} color="danger120"/>} onDismiss={dismissDelete} footer={<><Button title="Cancel" variant="outlined" color="gray" disabled={pending} onPress={dismissDelete}/><Button title={pending ? 'Deleting folder…' : 'Delete folder'} color="danger" loading={pending} disabled={pending || localDraftCount > 0} onPress={() => void deleteFolder()}/></>}><Box gap="s" backgroundColor="gray5" borderRadius="s" padding="m" style={{ borderWidth: 1, borderColor: '#e5e7eb' }}><Text variant="bodySmall" semibold>Folder to delete</Text><Text variant="bodySmall">{folder.name}</Text><Text variant="bodySmall" color="gray">Delete this folder from the organisation? This cannot be undone.</Text>{localDraftCount ? <Text color="danger120">Move its {localDraftCount} local draft plans first.</Text> : null}{error ? <Text color="danger120" accessibilityRole="alert">{error}</Text> : null}</Box></BaseModal> : null}
  </>;
}
