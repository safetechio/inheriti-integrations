import { useMemo } from 'react';
import {
  useAuthenticatedCookieSession,
  useService,
  type OrganizationKeyVault,
} from '@shared/infrastructure/importer-api';
import {
  useFindSelectedOrganizationPlanCreationTeamsByCriteria,
  useFindActiveOrganizationPlanCategoriesByCriteria,
  useFindActiveOrganizationMembersByCriteria,
  useGetCurrentMember,
  useGetMasterKeyConfigurationStatus,
  useGetOrganizationPlanCreationStorageLayerSummary,
  useGetRawSelectedOrganizationId,
  usePlanCreationOrgPolicy,
} from '@modules/organization/infrastructure/importer-api';
import type { OrganizationKeyIdentity } from '../domain/plan-batch-input';

export function usePlanBatchContext() {
  const { data: rawOrganizationId } = useGetRawSelectedOrganizationId();
  const organizationId = rawOrganizationId ?? undefined;
  const { session: authenticatedSession } = useAuthenticatedCookieSession();
  const organizationKeyVault = useService<OrganizationKeyVault>('OrganizationKeyVault');
  const { member: currentMember } = useGetCurrentMember();
  const policy = usePlanCreationOrgPolicy();
  const { data: planCreationTeams } = useFindSelectedOrganizationPlanCreationTeamsByCriteria(
    undefined,
    undefined,
    undefined,
    { enabled: Boolean(organizationId) },
  );
  const { data: planCategories } = useFindActiveOrganizationPlanCategoriesByCriteria(
    undefined,
    undefined,
    undefined,
    { enabled: Boolean(organizationId) },
  );
  const { data: organizationMembers } = useFindActiveOrganizationMembersByCriteria(
    { organizationId },
    undefined,
    undefined,
    { enabled: Boolean(organizationId) },
  );
  const { data: organizationKeyReady, loading: organizationKeyLoading } =
    useGetMasterKeyConfigurationStatus(organizationId);
  const { data: storageSummary, loading: storageLoading } =
    useGetOrganizationPlanCreationStorageLayerSummary(organizationId);
  const identity = useMemo<OrganizationKeyIdentity | null>(() => {
    if (!organizationId || !authenticatedSession) return null;
    return {
      organizationId,
      sessionFamilyId: authenticatedSession.sessionFamilyId,
      userId: authenticatedSession.userId,
    };
  }, [organizationId, authenticatedSession]);

  return {
    organizationId,
    organizationKeyVault,
    currentMember,
    policy,
    planCreationTeams,
    planCategories,
    organizationMembers,
    organizationKeyReady,
    organizationKeyLoading,
    storageSummary,
    storageLoading,
    identity,
  };
}
