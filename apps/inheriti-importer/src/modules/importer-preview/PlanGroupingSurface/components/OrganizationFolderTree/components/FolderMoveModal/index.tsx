import { useState } from 'react';
import { TREE_ICON_NAMES } from '@/assets/file-type-icons/catalog';
import { BaseModal, Box, Button, FormSearchableSelect, Icon, Text } from '@main-components';
import type { Folder, FolderWorkspaceProps } from '../../../../types';
import { moveRoots, validFolderDestination } from '../../hooks/folder-drag-move';
import { useFolderChangePreview } from '../../hooks/use-folder-change-preview';
import { FolderImpactSkeleton } from '../FolderImpactSkeleton';

export function FolderMoveModal({ folder, folders = [folder], workspace, initialParentId, onDismiss }: { folder: Folder; folders?: Folder[]; workspace: FolderWorkspaceProps; initialParentId?: string | null; onDismiss: () => void }) {
  const [parentId, setParentId] = useState<string | null>(initialParentId === undefined ? folder.parentId : initialParentId);
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [moving, setMoving] = useState(false);
  const roots = moveRoots(workspace.folders, folders.map((item) => item.id));
  const remaining = roots.filter((item) => item.parentId !== parentId && !completedIds.includes(item.id));
  const valid = validFolderDestination(workspace.folders, roots, parentId, folder.scope);
  const { previews, pending, error: previewError, retry } = useFolderChangePreview({ folders: remaining, workspace, changes: { parentId }, enabled: valid && remaining.length > 0 && !moving });
  const affectedPlans = new Set(previews.flatMap(({ preview }) => preview.affectedPlanIds)).size;
  const gainingTeams = new Set(previews.flatMap(({ preview }) => preview.addedTeamIds)).size;
  const losingTeams = new Set(previews.flatMap(({ preview }) => preview.removedTeamIds)).size;
  const foldersById = new Map(workspace.folders.map((item) => [item.id, item]));
  const path = (id: string | null) => {
    const names: string[] = [];
    const visited = new Set<string>();
    while (id && !visited.has(id)) {
      visited.add(id);
      const item = foldersById.get(id);
      if (!item) break;
      names.unshift(item.name);
      id = item.parentId;
    }
    return ['Organisation root', ...names].join(' / ');
  };
  const run = async () => {
    if (moving || pending || previews.length !== remaining.length || previews.some(({ preview }) => preview.blockers.length)) return;
    setMoving(true); setError('');
    let done = [...completedIds];
    try {
      for (const item of remaining) {
        await workspace.onMoveFolder!(item, parentId);
        done = [...done, item.id];
        setCompletedIds(done);
      }
      onDismiss();
    } catch (cause) {
      setError(`${done.length} of ${roots.filter((item) => item.parentId !== parentId).length} folders moved. ${cause instanceof Error ? cause.message : 'Could not move remaining folders.'}`);
    } finally { setMoving(false); }
  };
  return <BaseModal visible title={roots.length > 1 ? `Move ${roots.length} folders` : `Move ${folder.name}`} titleIcon={<Icon name={TREE_ICON_NAMES.folder} size={20} color="primary" />} description="Choose where these folders and their contents should live." onDismiss={() => { if (!moving) onDismiss(); }} footer={<><Button title="Cancel" variant="outlined" color="gray" disabled={moving} onPress={onDismiss}/><Button title={moving ? 'Moving folders…' : roots.length > 1 ? 'Move folders' : 'Move folder'} loading={moving} disabled={moving || pending || !valid || !remaining.length || previews.length !== remaining.length || previews.some(({ preview }) => preview.blockers.length > 0) || !workspace.onMoveFolder || !workspace.onPreviewFolderChange} onPress={() => void run()}/></>}>
    <Box gap="m">
      <Box gap="xs" backgroundColor="gray5" borderRadius="s" padding="m" style={{ borderWidth: 1, borderColor: '#e5e7eb' }}>
        <Text variant="bodySmall" semibold>Current location</Text>
        {roots.map((item) => <Text key={item.id} variant="bodySmall" color="gray">{path(item.parentId)} / {item.name}</Text>)}
      </Box>
      <FormSearchableSelect label="Destination" value={parentId ?? ''} disabled={moving || completedIds.length > 0} onChange={(value) => { setParentId(value || null); setError(''); }} options={[{ value: '', label: 'Organisation root' }, ...workspace.folders.filter((item) => item.scope === folder.scope && (roots.some((root) => root.parentId === item.id) || validFolderDestination(workspace.folders, roots, item.id, folder.scope))).map((item) => ({ value: item.id, label: path(item.id) }))]} helperText={!valid ? 'Choose a different location.' : undefined}/>
      {pending ? <FolderImpactSkeleton /> : null}
      {previews.length ? <Box gap="xs" backgroundColor="gray5" borderRadius="s" padding="m" style={{ borderWidth: 1, borderColor: '#e5e7eb' }}><Text variant="bodySmall" semibold>Access impact</Text><Text variant="bodySmall">{affectedPlans} {affectedPlans === 1 ? 'plan' : 'plans'} affected</Text><Text variant="bodySmall">Teams gaining access: {gainingTeams} · losing access: {losingTeams}</Text>{previews.flatMap(({ folderId, preview }) => preview.blockers.map((blocker) => <Text key={`${folderId}:${blocker}`} color="danger120">{blocker}</Text>))}</Box> : null}
      {previewError ? <Box gap="xs"><Text color="danger120" accessibilityRole="alert">{previewError}</Text><Button title="Try again" size="sm" onPress={retry}/></Box> : null}
      {error ? <Text color="danger120" accessibilityRole="alert">{error}</Text> : null}
    </Box>
  </BaseModal>;
}
