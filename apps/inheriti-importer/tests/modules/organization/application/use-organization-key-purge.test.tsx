import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const useAuthenticatedCookieSession = vi.fn();
const useService = vi.fn();

vi.mock('@shared/infrastructure/importer-api', () => ({
  useAuthenticatedCookieSession: (...args: unknown[]) => useAuthenticatedCookieSession(...args),
  useService: (...args: unknown[]) => useService(...args),
}));

import useOrganizationKeyPurge from '@modules/organization/application/use-organization-key-purge';

afterEach(() => {
  vi.clearAllMocks();
});

describe('useOrganizationKeyPurge', () => {
  it('clears the outgoing organization using the confirmed cookie session identity', async () => {
    const clearOrganization = vi.fn().mockResolvedValue(undefined);
    useAuthenticatedCookieSession.mockReturnValue({
      session: { sessionFamilyId: 'family-1', userId: 'user-1' },
    });
    useService.mockReturnValue({ clearOrganization });

    const { result } = renderHook(() => useOrganizationKeyPurge());
    await result.current.purgeOrganization('org-a');

    expect(clearOrganization).toHaveBeenCalledWith({
      organizationId: 'org-a',
      sessionFamilyId: 'family-1',
      userId: 'user-1',
    });
  });

  it('no-ops when there is no confirmed cookie session yet', async () => {
    const clearOrganization = vi.fn().mockResolvedValue(undefined);
    useAuthenticatedCookieSession.mockReturnValue({ session: null });
    useService.mockReturnValue({ clearOrganization });

    const { result } = renderHook(() => useOrganizationKeyPurge());
    await result.current.purgeOrganization('org-a');

    expect(clearOrganization).not.toHaveBeenCalled();
  });

  it('no-ops when there is no organization to leave', async () => {
    const clearOrganization = vi.fn().mockResolvedValue(undefined);
    useAuthenticatedCookieSession.mockReturnValue({
      session: { sessionFamilyId: 'family-1', userId: 'user-1' },
    });
    useService.mockReturnValue({ clearOrganization });

    const { result } = renderHook(() => useOrganizationKeyPurge());
    await result.current.purgeOrganization(null);
    await result.current.purgeOrganization(undefined);

    expect(clearOrganization).not.toHaveBeenCalled();
  });

  it('swallows a vault rejection so the switch is never blocked by a purge failure', async () => {
    const clearOrganization = vi.fn().mockRejectedValue(new Error('boom'));
    useAuthenticatedCookieSession.mockReturnValue({
      session: { sessionFamilyId: 'family-1', userId: 'user-1' },
    });
    useService.mockReturnValue({ clearOrganization });

    const { result } = renderHook(() => useOrganizationKeyPurge());
    await expect(result.current.purgeOrganization('org-a')).resolves.toBeUndefined();
    await waitFor(() => expect(clearOrganization).toHaveBeenCalled());
  });
});
