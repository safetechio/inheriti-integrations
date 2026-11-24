import { useState } from 'react';
import { BaseModal, Box, Button, ChoiceGroup, Icon, Text } from '@main-components';
import type { Folder, FolderWorkspaceProps } from '../../../../types';
import type { FolderTeamsPolicy } from '@modules/organization/domain/plan-folder';
import { useFolderChangePreview } from '../../hooks/use-folder-change-preview';
import { TeamsSelectInput } from '@modules/organization/ui/components/TeamsSelectInput';
import { FolderImpactSkeleton } from '../FolderImpactSkeleton';

export function FolderPermissionsModal({ folder: currentFolder, workspace, onDismiss }: { folder: Folder; workspace: FolderWorkspaceProps; onDismiss: () => void }) {
  const [folder] = useState(currentFolder);
  const stale = folder.id !== currentFolder.id || folder.revision !== currentFolder.revision;
  const [mode, setMode] = useState<'inherit' | 'own' | 'plan'>(folder.usePlanPermissions ? 'plan' : folder.parentId && folder.policy === null ? 'inherit' : 'own');
  const [allow, setAllow] = useState(folder.policy?.teams.allow ?? []);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const policy: FolderTeamsPolicy | null = mode === 'own' ? { teams: { allow, deny: folder.policy?.teams.deny ?? [] } } : null;
  const usePlanPermissions = mode === 'plan' || folder.usePlanPermissions ? mode === 'plan' : undefined;
  const { previews, pending, error: previewError, retry } = useFolderChangePreview({ folders: [folder], workspace, changes: { policy, usePlanPermissions }, enabled: !stale });
  const preview = previews.find((item) => item.folderId === folder.id)?.preview;
  const save = async () => {
    if (stale || saving || !preview || pending || previewError || preview.blockers.length || !workspace.onChangeFolderPolicy) return;
    setSaving(true); setError('');
    try { await workspace.onChangeFolderPolicy(folder, policy, usePlanPermissions); onDismiss(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update permissions.'); }
    finally { setSaving(false); }
  };
  return <BaseModal visible title={`Permissions for ${folder.name}`} titleIcon={<Icon name="shield-halved" size={20} color="primary"/>} description="Choose how permissions are set for plans in this folder." onDismiss={() => { if (!saving) onDismiss(); }} footer={<><Button title="Cancel" variant="outlined" color="gray" onPress={onDismiss} disabled={saving}/><Button title={saving ? 'Saving permissions…' : 'Save permissions'} loading={saving} disabled={stale || saving || pending || !!previewError || !preview || !!preview.blockers.length || !workspace.onChangeFolderPolicy} onPress={() => void save()}/></>}>
    <Box gap="m">
      <ChoiceGroup<'inherit' | 'own' | 'plan'>
          label="Permission policy"
          value={mode}
          options={[
            ...(folder.parentId ? [{ value: 'inherit' as const, label: 'Inherit permissions', description: 'Use the parent folder’s permission settings.' }] : []),
            { value: 'own', label: 'Use own policy', description: 'Choose teams for this folder.' },
            { value: 'plan', label: 'Permissions per plan', description: 'Each plan keeps its own permissions when moved into this folder.' },
          ]}
          disabled={saving || stale}
          onChange={setMode}
        />
      {mode === 'own' ? (
        <Box gap="s" backgroundColor="gray5" borderRadius="s" padding="m" borderWidth={1} borderColor="gray10">
          <Text variant="bodySmall" semibold>Teams with access</Text>
          <TeamsSelectInput
            teams={workspace.teams ?? []}
            selectedIds={allow}
            onChange={setAllow}
            disabled={saving || stale}
            loading={workspace.teamsLoading}
            error={workspace.teamsError}
            onRetry={workspace.onRetryTeams}
          />
        </Box>
      ) : null}
      {pending ? <FolderImpactSkeleton /> : null}
      {preview && !pending && !previewError ? <Box gap="xs" backgroundColor="gray5" borderRadius="s" padding="m" style={{ borderWidth: 1, borderColor: '#e5e7eb' }}><Text variant="bodySmall" semibold>Access impact</Text><Text variant="bodySmall">Plans affected: {preview.affectedPlanIds.length}</Text><Text variant="bodySmall">Teams gaining access: {preview.addedTeamIds.length} · losing access: {preview.removedTeamIds.length}</Text>{preview.blockers.map((blocker) => <Text key={blocker} color="danger120" accessibilityRole="alert">{blocker}</Text>)}</Box> : null}
      {previewError ? <Box gap="s"><Text color="danger120" accessibilityRole="alert">{previewError}</Text><Button title="Try again" variant="outlined" color="gray" onPress={retry}/></Box> : null}
      {stale ? (
        <Text color="danger120" accessibilityRole="alert">This folder changed while you were editing. Close and reopen permissions to review the latest policy.</Text>
      ) : null}
      {error && !stale ? <Text color="danger120" accessibilityRole="alert">{error}</Text> : null}
    </Box>
  </BaseModal>;
}
