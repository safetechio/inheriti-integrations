import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const useOrgSubscriptionStatus = vi.fn();
const useSelectedOrganizationMemberCapabilities = vi.fn();

vi.mock('@modules/organization/infrastructure/importer-api', () => ({
  useOrgSubscriptionStatus: (...args: unknown[]) => useOrgSubscriptionStatus(...args),
  useSelectedOrganizationMemberCapabilities: (...args: unknown[]) =>
    useSelectedOrganizationMemberCapabilities(...args),
}));

import useSelectableOrganization from '@modules/organization/application/use-selectable-organization';

afterEach(() => {
  vi.clearAllMocks();
});

describe('useSelectableOrganization', () => {
  it('reports loading while either SDK hook is still resolving', () => {
    useOrgSubscriptionStatus.mockReturnValue({
      isCreationBlocked: false,
      organizationId: 'org-a',
      loading: true,
    });
    useSelectedOrganizationMemberCapabilities.mockReturnValue({
      canStartPlanCreation: true,
      loading: false,
    });

    const { result } = renderHook(() => useSelectableOrganization());

    expect(result.current).toEqual({
      organizationId: 'org-a',
      canUse: false,
      blockedReason: null,
      loading: true,
    });
  });

  it('is blocked with the subscription message when the lifecycle blocks creation', () => {
    useOrgSubscriptionStatus.mockReturnValue({
      isCreationBlocked: true,
      accessRestrictionMessage: 'Your trial expired.',
      organizationId: 'org-a',
      loading: false,
    });
    useSelectedOrganizationMemberCapabilities.mockReturnValue({
      canStartPlanCreation: true,
      loading: false,
    });

    const { result } = renderHook(() => useSelectableOrganization());

    expect(result.current).toEqual({
      organizationId: 'org-a',
      canUse: false,
      blockedReason: 'Your trial expired.',
      loading: false,
    });
  });

  it('falls back to a generic message when the subscription hook has none', () => {
    useOrgSubscriptionStatus.mockReturnValue({
      isCreationBlocked: true,
      accessRestrictionMessage: undefined,
      organizationId: 'org-a',
      loading: false,
    });
    useSelectedOrganizationMemberCapabilities.mockReturnValue({
      canStartPlanCreation: true,
      loading: false,
    });

    const { result } = renderHook(() => useSelectableOrganization());

    expect(result.current.blockedReason).toBe('This organisation’s subscription is inactive.');
  });

  it('is blocked with a permission message when the member cannot start plan creation', () => {
    useOrgSubscriptionStatus.mockReturnValue({
      isCreationBlocked: false,
      organizationId: 'org-a',
      loading: false,
    });
    useSelectedOrganizationMemberCapabilities.mockReturnValue({
      canStartPlanCreation: false,
      loading: false,
    });

    const { result } = renderHook(() => useSelectableOrganization());

    expect(result.current).toEqual({
      organizationId: 'org-a',
      canUse: false,
      blockedReason: 'You do not have permission to create plans in this organisation.',
      loading: false,
    });
  });

  it('is usable once both checks pass', () => {
    useOrgSubscriptionStatus.mockReturnValue({
      isCreationBlocked: false,
      organizationId: 'org-a',
      loading: false,
    });
    useSelectedOrganizationMemberCapabilities.mockReturnValue({
      canStartPlanCreation: true,
      loading: false,
    });

    const { result } = renderHook(() => useSelectableOrganization());

    expect(result.current).toEqual({
      organizationId: 'org-a',
      canUse: true,
      blockedReason: null,
      loading: false,
    });
  });
});
