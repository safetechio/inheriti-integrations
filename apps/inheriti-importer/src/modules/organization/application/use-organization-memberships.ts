import { useMemo } from 'react';
import {
  useGetJoinedOrganizations,
  useGetMyOrganization,
} from '@modules/organization/infrastructure/importer-api';
import { preferAccessDenial } from '@modules/_shared/domain/api-status-error';

export interface OrganizationMembership {
  id: string;
  name: string;
  isOwned: boolean;
}

interface UseOrganizationMembershipsResult {
  memberships: OrganizationMembership[];
  loading: boolean;
  isRefetching: boolean;
  error: Error | null;
  retry: () => void;
}

/**
 * Importer-scoped composition of the local `useGetMyOrganization` +
 * `useGetJoinedOrganizations`. Produces the flat row list the Switch
 * Organization screen renders; per-row usability is decided by
 * `use-selectable-organization` after a row is picked.
 */
export default function useOrganizationMemberships(
  enabled = true,
): UseOrganizationMembershipsResult {
  const {
    data: ownedOrganization,
    loading: ownedLoading,
    isRefetching: ownedRefetching,
    error: ownedError,
    refetch: refetchOwned,
  } = useGetMyOrganization({ enabled });

  const {
    data: joinedOrganizations,
    loading: joinedLoading,
    isRefetching: joinedRefetching,
    error: joinedError,
    refetch: refetchJoined,
  } = useGetJoinedOrganizations({ enabled });

  const memberships = useMemo<OrganizationMembership[]>(() => {
    const rows: OrganizationMembership[] = [];

    if (ownedOrganization) {
      rows.push({
        id: ownedOrganization.id,
        name: ownedOrganization.name,
        isOwned: true,
      });
    }

    for (const org of joinedOrganizations ?? []) {
      rows.push({ id: org.id, name: org.name, isOwned: false });
    }

    return rows;
  }, [ownedOrganization, joinedOrganizations]);

  return {
    memberships,
    loading: ownedLoading || joinedLoading,
    isRefetching: ownedRefetching || joinedRefetching,
    error: preferAccessDenial(ownedError, joinedError),
    retry: () => {
      void refetchOwned();
      void refetchJoined();
    },
  };
}
