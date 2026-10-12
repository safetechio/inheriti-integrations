import { useApiQuery } from '@shared/infrastructure/importer-api/http';
import {
  useGetSelectedOrganization,
  useGetSelectedOrganizationId,
} from './selected-organization-api';

type Capabilities = {
  canStartPlanCreation?: boolean;
  canCreatePlanCategories?: boolean;
  canManageOrganizationSettings?: boolean;
  limits?: { maxTeamsPerPlan?: number };
};

export function useSelectedOrganizationMemberCapabilities() {
  const id = useGetSelectedOrganizationId();
  const result = useApiQuery<Capabilities>(
    ['capabilities', id],
    id ? `/organizations/${encodeURIComponent(id)}/member-capabilities` : null,
  );
  return {
    canStartPlanCreation: result.data?.canStartPlanCreation ?? false,
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

export function useOrgSubscriptionStatus() {
  const organization = useGetSelectedOrganization();
  const id = organization.data?.id;
  const subscription = useApiQuery<{
    status?: string;
    lifecycle?: { accessMode?: string };
    paymentMethod?: { state?: string };
    standbyPeriod?: { status?: string };
    isInStandbyMode?: boolean;
    isStandbyExpired?: boolean;
    isPaymentFailed?: boolean;
  }>(
    ['subscription', id],
    id ? `/organizations/${encodeURIComponent(id)}/subscriptions/details` : null,
  );
  const accessMode = subscription.data?.lifecycle?.accessMode;
  const activeByStatus =
    subscription.data?.status === 'ACTIVE' || subscription.data?.status === 'TRIALING';
  const legacyRestricted =
    Boolean(organization.data?.standbyPeriod ?? organization.data?.standbyPeriodInfo) ||
    subscription.data?.isInStandbyMode === true ||
    subscription.data?.isStandbyExpired === true ||
    subscription.data?.isPaymentFailed === true ||
    subscription.data?.paymentMethod?.state === 'failed' ||
    subscription.data?.standbyPeriod?.status === 'ACTIVE' ||
    subscription.data?.standbyPeriod?.status === 'EXPIRED' ||
    !activeByStatus;
  const blocked =
    !subscription.loading &&
    (!subscription.data || (accessMode ? accessMode !== 'FULL' : legacyRestricted));
  return {
    organizationId: id,
    loading: organization.loading || subscription.loading,
    isCreationBlocked: blocked,
    accessRestrictionMessage: blocked ? 'This organisation’s subscription is inactive.' : null,
  };
}
