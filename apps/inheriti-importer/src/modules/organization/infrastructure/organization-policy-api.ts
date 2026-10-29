import { useApiQuery } from '@shared/infrastructure/importer-api/http';
import {
  useGetSelectedOrganization,
  useGetSelectedOrganizationId,
} from './selected-organization-api';

type Capabilities = {
  canAccessStagedItems?: boolean;
  canCreatePlanCategories?: boolean;
  canManageOrganizationSettings?: boolean;
  limits?: { maxTeamsPerPlan?: number };
};

export function useSelectedOrganizationMemberCapabilities() {
  const id = useGetSelectedOrganizationId();
  const result = useApiQuery<Capabilities>(
    ['capabilities', id],
    id ? `/integrations/v1/organizations/${encodeURIComponent(id)}/member-capabilities` : null,
  );
  return {
    canAccessStagedItems: result.data?.canAccessStagedItems ?? false,
    canCreatePlanCategories: result.data?.canCreatePlanCategories ?? false,
    canManageOrganizationSettings: result.data?.canManageOrganizationSettings ?? false,
    limits: result.data?.limits ?? {},
    loading: result.loading,
  };
}

export type PlanCreationOrgPolicy = ReturnType<typeof usePlanCreationOrgPolicy>;

export function usePlanCreationOrgPolicy() {
  const { data: organization } = useGetSelectedOrganization();
  const settings = organization?.settings;
  const approvalMode = settings?.moderation?.approvalMode ?? 'PER_PLAN';
  return {
    privateAllowed: settings?.backupPlans?.allowPrivatePlans ?? true,
    authRequired: !(settings?.authentication?.allowNoAuthentication ?? true),
    moderationRequired: !(settings?.moderation?.allowNoModeration ?? true),
    approvalModePerPlan: approvalMode === 'PER_PLAN',
    approvalMode: approvalMode === 'PER_PLAN' ? ('THRESHOLD' as const) : approvalMode,
    organizationApprovalMode: approvalMode,
    autoModeratorOwner: settings?.moderation?.autoModerator ?? true,
    enabledMethods: settings?.authentication?.enabledMethods ?? {},
    authThreshold: settings?.authentication?.threshold ?? ('per_plan' as const),
  };
}
