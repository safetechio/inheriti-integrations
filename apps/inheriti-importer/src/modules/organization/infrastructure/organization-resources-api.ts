import {
  toRecord,
  unwrapList,
  useApiQuery,
  whereQuery,
} from '@shared/infrastructure/importer-api/http';
import { useGetSelectedOrganizationId } from './selected-organization-api';

export function useFindSelectedOrganizationPlanCreationTeamsByCriteria(
  _filter?: unknown,
  _pagination?: unknown,
  _sort?: unknown,
  options?: { enabled?: boolean },
) {
  const id = useGetSelectedOrganizationId();
  const result = useApiQuery<
    Array<{ id: string; name: string }> | { items?: Array<{ id: string; name: string }> }
  >(
    ['teams', id],
    id && options?.enabled !== false
      ? `/integrations/v1/organizations/${encodeURIComponent(id)}/member-plan-creation-teams`
      : null,
    whereQuery([{ field: 'status', operator: '==', value: 'ACTIVE' }]),
  );
  return { ...result, data: result.data ? toRecord(unwrapList(result.data)) : undefined };
}

export function useFindActiveOrganizationMembersByCriteria(
  filter?: { organizationId?: string; email?: string },
  _pagination?: unknown,
  _sort?: unknown,
  options?: { enabled?: boolean },
) {
  const id = filter?.organizationId;
  const where = [
    { field: 'tenantId', operator: '==', value: id },
    { field: 'status', operator: '==', value: 'ACTIVE' },
    ...(filter?.email ? [{ field: 'email', operator: '==', value: filter.email }] : []),
  ];
  const result = useApiQuery<
    Array<{ id: string; email?: string; role?: { name?: string } }> | { items?: Array<{ id: string; email?: string; role?: { name?: string } }> }
  >(
    ['members', id, filter?.email],
    id && options?.enabled !== false ? `/integrations/v1/organizations/${encodeURIComponent(id)}/members` : null,
    whereQuery(where),
  );
  return { ...result, data: result.data ? toRecord(unwrapList(result.data)) : undefined };
}

export function useGetCurrentMember() {
  const id = useGetSelectedOrganizationId();
  const profile = useApiQuery<{ email?: string }>(['profile'], '/integrations/v1/importer/profile');
  const members = useFindActiveOrganizationMembersByCriteria(
    { organizationId: id ?? undefined, email: profile.data?.email },
    undefined,
    undefined,
    { enabled: Boolean(id && profile.data?.email) },
  );
  return {
    member: Object.values(members.data ?? {})[0],
    loading: profile.loading || members.loading,
  };
}

export function useGetOrganizationPlanCreationStorageLayerSummary(organizationId?: string) {
  return useApiQuery<{ activeDataStorageLayerCount: number }>(
    ['storage-summary', organizationId],
    organizationId
      ? `/integrations/v1/organizations/${encodeURIComponent(organizationId)}/storage-layers/plan-creation-summary`
      : null,
  );
}
