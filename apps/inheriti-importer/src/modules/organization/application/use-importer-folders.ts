import { ApiStatusError } from '@modules/_shared/domain/api-status-error';
import { useQueryClient } from '@tanstack/react-query';
import { request, useApiQuery } from '@shared/infrastructure/importer-api/http';
import { useRuntime } from '@shared/infrastructure/importer-api/runtime';
import { useSelectedOrganizationMemberCapabilities } from '../infrastructure/organization-policy-api';
import {
  getActiveOrganizationAccount,
  getSelectedOrganizationSnapshot,
  useGetSelectedOrganizationId,
} from '../infrastructure/selected-organization-api';
import type { FolderChangePreview, FolderTeamsPolicy, PlanFolder, PlanFolderScope } from '../domain/plan-folder';
import { useFindSelectedOrganizationPlanCreationTeamsByCriteria } from '../infrastructure/organization-resources-api';

export function useImporterFolders() {
  const organizationId = useGetSelectedOrganizationId();
  const account = getActiveOrganizationAccount();
  const scope = 'SHARED' as const;
  const { transport } = useRuntime();
  const client = useQueryClient();
  const capabilities = useSelectedOrganizationMemberCapabilities();
  const teams = useFindSelectedOrganizationPlanCreationTeamsByCriteria(
    undefined,
    undefined,
    undefined,
    { enabled: capabilities.canManagePlanFolders },
  );
  const path = organizationId
    ? `/integrations/v1/organizations/${encodeURIComponent(organizationId)}/plan-folders`
    : null;
  const key = ['importer-folders', account, organizationId, scope];
  const catalog = useApiQuery<{ items: PlanFolder[]; assignments?: Array<{ folderId: string }> }>(key, path, { scope });

  function currentPath() {
    // Fence stale inline editors after an account or organisation switch.
    if (
      !path ||
      account !== getActiveOrganizationAccount() ||
      organizationId !== getSelectedOrganizationSnapshot()
    )
      throw new Error('The active account or organisation changed. Reopen the folder editor.');
    return path;
  }

  async function mutate(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', suffix: string, body?: unknown, query?: Record<string, string | number>) {
    const invalidate = () => client.invalidateQueries({ queryKey: ['importer-folders', account, organizationId] });
    try {
      await request(transport, method, currentPath() + suffix, body, query);
    } catch (error) {
      const deleting = method === 'DELETE' || suffix === '/bulk-delete';
      if (deleting && error instanceof ApiStatusError && error.message === 'plan_folder_not_empty') {
        await invalidate();
        throw new Error('A folder still contains plans or subfolders. Move its plans and move or delete its subfolders before trying again.');
      }
      throw error;
    }
    await invalidate();
  }

  return {
    folders: catalog.data?.items ?? [],
    assignments: catalog.data?.assignments,
    teams: Object.values(teams.data ?? {}),
    teamsLoading: teams.data === undefined && (teams.loading || teams.isRefetching),
    teamsError: teams.data === undefined && teams.error ? 'Teams could not be loaded.' : undefined,
    onRetryTeams: () => {
      void teams.refetch();
    },
    loading: catalog.loading,
    hasLoaded: catalog.data !== undefined,
    refreshing: catalog.isRefetching,
    error: catalog.error ? 'Folders could not be loaded. Check your access and retry.' : undefined,
    scope,
    onRetry: () => {
      void catalog.refetch();
    },
    onCreateFolder: capabilities.canManagePlanFolders
      ? async (input: {
          name: string;
          parentId: string | null;
          scope: PlanFolderScope;
          policy?: FolderTeamsPolicy | null;
        }) => {
          await mutate('POST', '', {
            ...input,
            scope,
            id: crypto.randomUUID(),
            policy: input.policy ?? null,
          });
        }
      : undefined,
    onRenameFolder: capabilities.canManagePlanFolders
      ? async (folder: PlanFolder, name: string) => {
          await mutate('PATCH', `/${encodeURIComponent(folder.id)}`, {
            name,
            expectedRevision: folder.revision,
          });
        }
      : undefined,
    onPreviewFolderChange: capabilities.canManagePlanFolders
      ? async (folder: PlanFolder, changes: { policy?: FolderTeamsPolicy | null; usePlanPermissions?: boolean; parentId?: string | null }) =>
          request<FolderChangePreview>(transport, 'POST', currentPath() + `/${encodeURIComponent(folder.id)}/change-preview`, changes)
      : undefined,
    onChangeFolderPolicy: capabilities.canManagePlanFolders
      ? async (folder: PlanFolder, policy: FolderTeamsPolicy | null, usePlanPermissions?: boolean) =>
          mutate('PUT', `/${encodeURIComponent(folder.id)}/policy`, { policy, usePlanPermissions, expectedRevision: folder.revision })
      : undefined,
    onMoveFolder: capabilities.canManagePlanFolders
      ? async (folder: PlanFolder, parentId: string | null) =>
          mutate('POST', `/${encodeURIComponent(folder.id)}/move`, { parentId, expectedRevision: folder.revision })
      : undefined,
    onDeleteFolder: capabilities.canManagePlanFolders
      ? async (folder: PlanFolder) =>
          mutate('DELETE', `/${encodeURIComponent(folder.id)}`, undefined, { expectedRevision: folder.revision })
      : undefined,
    onDeleteFolders: capabilities.canManagePlanFolders
      ? async (folders: PlanFolder[]) =>
          mutate('POST', '/bulk-delete', {
            operationId: crypto.randomUUID(),
            folders: folders.map(({ id, revision }) => ({ id, expectedRevision: revision })),
          })
      : undefined,
  };
}
