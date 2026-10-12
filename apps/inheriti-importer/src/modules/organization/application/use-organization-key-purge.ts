import { useCallback } from 'react';
import {
  useAuthenticatedCookieSession,
  useService,
  type OrganizationKeyVault,
} from '@shared/infrastructure/importer-api';

export interface OrganizationKeyPurge {
  purgeOrganization: (organizationId: string | null | undefined) => Promise<void>;
}

/**
 * Wires the Importer's `OrganizationKeyVault.clearOrganization` (see
 * `docs/adr/0001-organization-key-boundary.md`) to the organisation the user
 * is switching AWAY from. Every organisation-switch call site (the Switch
 * Organization screen and the AppShell account-menu quick switcher) must
 * call `purgeOrganization(previousOrganizationId)` before invoking the local
 * `useSwitchToOrganization` — this must run before the next organisation's
 * context is exposed, so a key released under organisation A can never be
 * read once organisation B's screen is up.
 *
 * `clearSession`/`clearAllSessions` are not this hook's concern: the session
 * manager calls `clearSession` on session expiry/replacement, and the runtime wires
 * `clearAllSessions` to logout. This hook only closes the organisation-switch
 * gap those two mechanisms leave open — neither one runs at the moment a user
 * switches organisations without logging out.
 */
export default function useOrganizationKeyPurge(): OrganizationKeyPurge {
  const { session } = useAuthenticatedCookieSession();
  const vault = useService<OrganizationKeyVault>('OrganizationKeyVault');

  const purgeOrganization = useCallback(
    async (organizationId: string | null | undefined) => {
      if (!organizationId || !session) return;
      await vault
        .clearOrganization({
          organizationId,
          sessionFamilyId: session.sessionFamilyId,
          userId: session.userId,
        })
        .catch(() => undefined);
    },
    [session, vault],
  );

  return { purgeOrganization };
}
