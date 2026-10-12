import { useEffect } from 'react';
import {
  useOrgSubscriptionStatus,
  useSelectedOrganizationMemberCapabilities,
} from '@modules/organization/infrastructure/importer-api';

export interface SelectableOrganizationState {
  organizationId?: string;
  canUse: boolean;
  blockedReason: string | null;
  loading: boolean;
}

const NO_PLAN_CREATION_MESSAGE = 'You do not have permission to create plans in this organisation.';

/**
 * Importer-scoped composition. Joins the local `useOrgSubscriptionStatus`
 * (lifecycle / standby / trial / payment authority) with `canStartPlanCreation`
 * for the *currently selected* organisation and reduces both to a single
 * "can this org be used as the Importer working context" verdict.
 *
 * The blocking logic stays in the shared Importer API hooks; this only merges
 * their outputs.
 */
export default function useSelectableOrganization(): SelectableOrganizationState {
  const {
    isCreationBlocked,
    accessRestrictionMessage,
    organizationId,
    loading: statusLoading,
  } = useOrgSubscriptionStatus();

  const { canStartPlanCreation, loading: capabilitiesLoading } =
    useSelectedOrganizationMemberCapabilities();

  const loading = statusLoading || capabilitiesLoading;

  useEffect(() => {
    console.debug('[selectable-organization]', {
      organizationId,
      statusLoading,
      capabilitiesLoading,
      loading,
      isCreationBlocked,
      canStartPlanCreation,
    });
  }, [
    canStartPlanCreation,
    capabilitiesLoading,
    isCreationBlocked,
    loading,
    organizationId,
    statusLoading,
  ]);

  if (loading) {
    return { organizationId, canUse: false, blockedReason: null, loading: true };
  }

  if (isCreationBlocked) {
    return {
      organizationId,
      canUse: false,
      blockedReason: accessRestrictionMessage ?? 'This organisation’s subscription is inactive.',
      loading: false,
    };
  }

  if (!canStartPlanCreation) {
    return {
      organizationId,
      canUse: false,
      blockedReason: NO_PLAN_CREATION_MESSAGE,
      loading: false,
    };
  }

  return { organizationId, canUse: true, blockedReason: null, loading: false };
}
