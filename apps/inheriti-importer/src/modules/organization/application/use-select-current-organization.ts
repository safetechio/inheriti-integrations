import {
  useGetSelectedOrganization,
  useSwitchToOrganization,
} from '@modules/organization/infrastructure/importer-api';
import { getActiveOrganizationAccount } from '@modules/organization/infrastructure/selected-organization-api';
import useOrganizationKeyPurge from './use-organization-key-purge';

export default function useSelectCurrentOrganization() {
  const { data: organization } = useGetSelectedOrganization();
  const { switchToOrganization, loading } = useSwitchToOrganization();
  const { purgeOrganization } = useOrganizationKeyPurge();

  async function selectOrganization(id: string) {
    const accountKey = getActiveOrganizationAccount();
    if (id === organization?.id) return;
    await purgeOrganization(organization?.id);
    if (getActiveOrganizationAccount() !== accountKey) return;
    await switchToOrganization(id);
  }

  return { organization, loading, selectOrganization };
}
