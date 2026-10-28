import {
  useGetSelectedOrganization,
  useSelectedOrganizationMemberCapabilities,
} from '@modules/organization/infrastructure/importer-api';

export interface SelectableOrganizationState {
  organizationId?: string;
  canUse: boolean;
  blockedReason: string | null;
  loading: boolean;
}

const NO_STAGED_ACCESS_MESSAGE = 'You do not have permission to stage imports in this organisation.';
const ACTIVATION_PENDING_MESSAGE = 'This organisation must finish activation before imports can be staged.';

export default function useSelectableOrganization(): SelectableOrganizationState {
  const organization = useGetSelectedOrganization();
  const { canAccessStagedItems, loading: capabilitiesLoading } =
    useSelectedOrganizationMemberCapabilities();
  const organizationId = organization.data?.id;
  const loading = organization.loading || capabilitiesLoading;

  if (loading) {
    return { organizationId, canUse: false, blockedReason: null, loading: true };
  }

  if (!organizationId) {
    return {
      organizationId,
      canUse: false,
      blockedReason: 'We could not verify this organisation’s access.',
      loading: false,
    };
  }

  if (organization.data?.isActivationPending) {
    return {
      organizationId,
      canUse: false,
      blockedReason: ACTIVATION_PENDING_MESSAGE,
      loading: false,
    };
  }

  if (!canAccessStagedItems) {
    return {
      organizationId,
      canUse: false,
      blockedReason: NO_STAGED_ACCESS_MESSAGE,
      loading: false,
    };
  }

  return { organizationId, canUse: true, blockedReason: null, loading: false };
}
