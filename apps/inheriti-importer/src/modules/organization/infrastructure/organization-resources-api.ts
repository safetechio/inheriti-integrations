import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  request,
  toRecord,
  unwrapList,
  useApiQuery,
  whereQuery,
} from '@shared/infrastructure/importer-api/http';
import { useRuntime } from '@shared/infrastructure/importer-api/runtime';
import { useGetSelectedOrganizationId } from './selected-organization-api';

export function useFindActiveOrganizationPlanCategoriesByCriteria(
  _filter?: unknown,
  _pagination?: unknown,
  _sort?: unknown,
  options?: { enabled?: boolean },
) {
  const id = useGetSelectedOrganizationId();
  const result = useApiQuery<
    Array<{ id: string; name: string }> | { items?: Array<{ id: string; name: string }> }
  >(
    ['categories', id],
    id && options?.enabled !== false
      ? `/organizations/${encodeURIComponent(id)}/plan-categories`
      : null,
    whereQuery([{ field: 'status', operator: '==', value: 'ACTIVE' }]),
  );
  return { ...result, data: result.data ? toRecord(unwrapList(result.data)) : undefined };
}

export function useSaveOrganizationPlanCategory() {
  const { transport } = useRuntime();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  return {
    loading,
    save: async (category: {
      id: string;
      organizationId: string;
      name: string;
      status: string;
      createdAt: Date;
    }) => {
      setLoading(true);
      try {
        const saved = await request<{ id: string }>(
          transport,
          'POST',
          `/organizations/${encodeURIComponent(category.organizationId)}/plan-categories`,
          {
            id: category.id,
            name: category.name,
            status: category.status,
            createdAt: category.createdAt.toISOString(),
          },
        );
        await queryClient.invalidateQueries({ queryKey: ['categories', category.organizationId] });
        return saved;
      } finally {
        setLoading(false);
      }
    },
  };
}

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
      ? `/organizations/${encodeURIComponent(id)}/member-plan-creation-teams`
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
    Array<{ id: string; email?: string }> | { items?: Array<{ id: string; email?: string }> }
  >(
    ['members', id, filter?.email],
    id && options?.enabled !== false ? `/organizations/${encodeURIComponent(id)}/members` : null,
    whereQuery(where),
  );
  return { ...result, data: result.data ? toRecord(unwrapList(result.data)) : undefined };
}

export function useGetCurrentMember() {
  const id = useGetSelectedOrganizationId();
  const profile = useApiQuery<{ email?: string }>(['profile'], '/user/profile');
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
      ? `/organizations/${encodeURIComponent(organizationId)}/storage-layers/plan-creation-summary`
      : null,
  );
}
