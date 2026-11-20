import { useState } from 'react';
import { BaseModal, Box, Button, FormSearchableSelect, Icon, Text } from '@main-components';
import { TREE_ICON_NAMES } from '@/assets/file-type-icons/catalog';
import { canCreatePlanAtDestination } from '@modules/organization/domain/plan-folder';
import type { FolderWorkspaceProps, PlanDraft } from '../../../../types';
import { PlanAvatar } from '../PlanAvatar';

type Props = {
  planIds: string[];
  plans: PlanDraft[];
  workspace: FolderWorkspaceProps;
  initialFolderId: string | null;
  canMove: boolean;
  onDismiss: () => void;
  onConfirm: (plans: PlanDraft[], folderId: string | null) => void;
};

export function MovePlansModal({ planIds, plans, workspace, initialFolderId, canMove, onDismiss, onConfirm }: Props) {
  const selected = plans.filter((plan) => planIds.includes(plan.id) && (plan.sharingModel === 'PRIVATE' ? 'PERSONAL' : 'SHARED') === workspace.scope);
  const commonFolderId = selected.length && selected.every((plan) => plan.folderId === selected[0]?.folderId) ? selected[0]?.folderId ?? null : null;
  const [folderId, setFolderId] = useState<string | null>(() =>
    initialFolderId !== commonFolderId && canCreatePlanAtDestination(initialFolderId, workspace.scope, workspace.folders)
      ? initialFolderId : commonFolderId,
  );
  const valid = canCreatePlanAtDestination(folderId, workspace.scope, workspace.folders);
  const changed = selected.some((plan) => (plan.folderId ?? null) !== folderId);
  const enabled = canMove && selected.length > 0 && valid && changed;
  const foldersById = new Map(workspace.folders.map((folder) => [folder.id, folder]));
  const path = (id: string) => {
    const names: string[] = [];
    const visited = new Set<string>();
    while (id && !visited.has(id)) {
      visited.add(id);
      const folder = foldersById.get(id);
      if (!folder) break;
      names.unshift(folder.name);
      id = folder.parentId ?? '';
    }
    return ['Organisation root', ...names].join(' / ');
  };
  const helper = !selected.length ? 'The selected plans are no longer available in this scope.'
    : !canMove ? 'Moving plans is unavailable.'
    : !valid ? 'Choose a folder in this scope that allows plans.'
    : !changed ? 'All selected plans are already in this location.'
    : 'Only the local draft plan location will change.';

  return <BaseModal visible title={selected.length === 1 ? 'Move plan' : `Move ${selected.length} plans`} titleIcon={<Icon name={TREE_ICON_NAMES.folder} size={20} color="primary" />} description="Choose where the selected plans should live." onDismiss={onDismiss} footer={<><Button title="Cancel" variant="outlined" color="gray" onPress={onDismiss}/><Button title={selected.length === 1 ? 'Move plan' : 'Move plans'} disabled={!enabled} onPress={() => { if (enabled) onConfirm(selected, folderId); }}/></>}>
    <Box gap="m">
      <Box gap="xs" backgroundColor="gray5" borderRadius="s" padding="m" style={{ borderWidth: 1, borderColor: '#e5e7eb' }}>
        <Text variant="bodySmall" semibold>{selected.length} {selected.length === 1 ? 'plan' : 'plans'} selected</Text>
        {selected.slice(0, 5).map((plan) => <Box key={plan.id} flexDirection="row" alignItems="center" gap="s"><PlanAvatar id={plan.id}/><Text variant="bodySmall">{plan.name}</Text></Box>)}
        {selected.length > 5 ? <Text variant="bodySmall" color="gray">And {selected.length - 5} more</Text> : null}
      </Box>
      <FormSearchableSelect label="Destination" value={folderId ?? ''} onChange={(value) => setFolderId(value || null)} options={[{ value: '', label: 'Organisation root' }, ...workspace.folders.filter((folder) => folder.scope === workspace.scope).map((folder) => ({ value: folder.id, label: path(folder.id) }))]} helperText={helper}/>
    </Box>
  </BaseModal>;
}
