import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { ApiStatusError } from '@modules/_shared/domain/api-status-error';

const useGetSelectedOrganization = vi.fn();
const useSelectedOrganizationMemberCapabilities = vi.fn();

vi.mock('@modules/organization/infrastructure/importer-api', () => ({
  useGetSelectedOrganization: (...args: unknown[]) => useGetSelectedOrganization(...args),
  useSelectedOrganizationMemberCapabilities: (...args: unknown[]) =>
    useSelectedOrganizationMemberCapabilities(...args),
}));

import useSelectableOrganization from '@modules/organization/application/use-selectable-organization';

afterEach(() => vi.clearAllMocks());

function stubOrganization({
  isActivationPending = false,
  canAccessStagedItems = true,
  canStartPlanCreation = false,
  loading = false,
}: {
  isActivationPending?: boolean;
  canAccessStagedItems?: boolean;
  canStartPlanCreation?: boolean;
  loading?: boolean;
} = {}) {
  useGetSelectedOrganization.mockReturnValue({
    data: { id: 'org-a', isActivationPending },
    loading,
  });
  useSelectedOrganizationMemberCapabilities.mockReturnValue({
    canAccessStagedItems,
    canStartPlanCreation,
    loading,
  });
}

describe('useSelectableOrganization', () => {
  it('waits for organization and staged-item capability', () => {
    stubOrganization({ loading: true });
    const { result } = renderHook(() => useSelectableOrganization());
    expect(result.current).toEqual({
      organizationId: 'org-a',
      canUse: false,
      blockedReason: null,
      loading: true,
    });
  });

  it('blocks organizations still awaiting activation', () => {
    stubOrganization({ isActivationPending: true });
    const { result } = renderHook(() => useSelectableOrganization());
    expect(result.current).toEqual({
      organizationId: 'org-a',
      canUse: false,
      blockedReason: 'This organisation must finish activation before imports can be staged.',
      loading: false,
    });
  });

  it('blocks members without staged-item access even if plan creation is allowed', () => {
    stubOrganization({ canAccessStagedItems: false, canStartPlanCreation: true });
    const { result } = renderHook(() => useSelectableOrganization());
    expect(result.current).toEqual({
      organizationId: 'org-a',
      canUse: false,
      blockedReason: 'You do not have permission to stage imports in this organisation.',
      loading: false,
    });
  });

  it('permits staging without normal plan creation capability', () => {
    stubOrganization({ canStartPlanCreation: false });
    const { result } = renderHook(() => useSelectableOrganization());
    expect(result.current).toEqual({
      organizationId: 'org-a',
      canUse: true,
      blockedReason: null,
      loading: false,
    });
  });

  it('blocks when the selected organization does not resolve', () => {
    stubOrganization();
    useGetSelectedOrganization.mockReturnValue({ data: undefined, loading: false });
    const { result } = renderHook(() => useSelectableOrganization());
    expect(result.current.canUse).toBe(false);
  });

  it.each([401, 403, 404])('blocks cached organization access after HTTP %i', (status) => {
    stubOrganization();
    useGetSelectedOrganization.mockReturnValue({
      data: { id: 'org-a' },
      loading: false,
      error: new ApiStatusError('denied', status),
    });
    const { result } = renderHook(() => useSelectableOrganization());
    expect(result.current.canUse).toBe(false);
    expect(result.current.blockedReason).toContain('no longer has access');
  });

  it.each([401, 403, 404])('blocks cached capabilities after HTTP %i', (status) => {
    stubOrganization();
    useSelectedOrganizationMemberCapabilities.mockReturnValue({
      canAccessStagedItems: true,
      loading: false,
      error: new ApiStatusError('denied', status),
    });
    const { result } = renderHook(() => useSelectableOrganization());
    expect(result.current.canUse).toBe(false);
    expect(result.current.blockedReason).toContain('no longer has access');
  });

  it('preserves cached access after a transient capability failure', () => {
    stubOrganization();
    useSelectedOrganizationMemberCapabilities.mockReturnValue({
      canAccessStagedItems: true,
      loading: false,
      error: new ApiStatusError('unavailable', 500),
    });
    const { result } = renderHook(() => useSelectableOrganization());
    expect(result.current.canUse).toBe(true);
  });
});
