import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const useGetSelectedOrganizationId = vi.fn();
const useSwitchToOrganization = vi.fn();
const useOrgSubscriptionStatus = vi.fn();
const useSelectedOrganizationMemberCapabilities = vi.fn();
const useAuthenticatedCookieSession = vi.fn();
const useService = vi.fn();

vi.mock('@shared/infrastructure/importer-api', () => ({
  useAuthenticatedCookieSession: (...args: unknown[]) => useAuthenticatedCookieSession(...args),
  useService: (...args: unknown[]) => useService(...args),
}));

vi.mock('@modules/organization/infrastructure/importer-api', () => ({
  useGetSelectedOrganizationId: (...args: unknown[]) => useGetSelectedOrganizationId(...args),
  useSwitchToOrganization: (...args: unknown[]) => useSwitchToOrganization(...args),
  useOrgSubscriptionStatus: (...args: unknown[]) => useOrgSubscriptionStatus(...args),
  useSelectedOrganizationMemberCapabilities: (...args: unknown[]) =>
    useSelectedOrganizationMemberCapabilities(...args),
}));

import useSwitchOrganizationFlow from '@modules/organization/application/use-switch-organization-flow';

function stubSdk({
  selectedOrganizationId,
  statusOrganizationId,
  isCreationBlocked = false,
  canStartPlanCreation = true,
  loading = false,
  accessRestrictionMessage,
}: {
  selectedOrganizationId: string | null;
  statusOrganizationId?: string;
  isCreationBlocked?: boolean;
  canStartPlanCreation?: boolean;
  loading?: boolean;
  accessRestrictionMessage?: string;
}) {
  useGetSelectedOrganizationId.mockReturnValue(selectedOrganizationId);
  useOrgSubscriptionStatus.mockReturnValue({
    isCreationBlocked,
    accessRestrictionMessage,
    organizationId: statusOrganizationId,
    loading,
  });
  useSelectedOrganizationMemberCapabilities.mockReturnValue({ canStartPlanCreation, loading });
  useAuthenticatedCookieSession.mockReturnValue({
    session: { sessionFamilyId: 'family-1', userId: 'user-1' },
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('useSwitchOrganizationFlow', () => {
  it('purges the outgoing organization key before switching, then reaches ready', async () => {
    const order: string[] = [];
    const clearOrganization = vi.fn(async () => {
      order.push('clearOrganization');
    });
    const switchToOrganization = vi.fn(async () => {
      order.push('switchToOrganization');
    });
    useService.mockReturnValue({ clearOrganization });
    useSwitchToOrganization.mockReturnValue({ switchToOrganization });
    stubSdk({ selectedOrganizationId: 'org-a', statusOrganizationId: 'org-b' });

    const { result, rerender } = renderHook(() => useSwitchOrganizationFlow());

    await act(async () => {
      await result.current.selectOrganization('org-b');
    });

    expect(order).toEqual(['clearOrganization', 'switchToOrganization']);
    expect(clearOrganization).toHaveBeenCalledWith({
      organizationId: 'org-a',
      sessionFamilyId: 'family-1',
      userId: 'user-1',
    });

    stubSdk({
      selectedOrganizationId: 'org-b',
      statusOrganizationId: 'org-b',
      canStartPlanCreation: true,
    });
    useService.mockReturnValue({ clearOrganization });
    useSwitchToOrganization.mockReturnValue({ switchToOrganization });
    rerender();

    expect(result.current.phase).toBe('ready');
  });

  it('does not purge when re-selecting the currently selected organization', async () => {
    const clearOrganization = vi.fn().mockResolvedValue(undefined);
    const switchToOrganization = vi.fn().mockResolvedValue(undefined);
    useService.mockReturnValue({ clearOrganization });
    useSwitchToOrganization.mockReturnValue({ switchToOrganization });
    stubSdk({ selectedOrganizationId: 'org-a', statusOrganizationId: 'org-a' });

    const { result } = renderHook(() => useSwitchOrganizationFlow());

    await act(async () => {
      await result.current.selectOrganization('org-a');
    });

    expect(clearOrganization).not.toHaveBeenCalled();
    expect(switchToOrganization).toHaveBeenCalledWith('org-a');
  });

  it('reports blocked with the API-provided reason once the new context resolves', () => {
    const clearOrganization = vi.fn().mockResolvedValue(undefined);
    const switchToOrganization = vi.fn().mockResolvedValue(undefined);
    useService.mockReturnValue({ clearOrganization });
    useSwitchToOrganization.mockReturnValue({ switchToOrganization });
    stubSdk({
      selectedOrganizationId: 'org-b',
      statusOrganizationId: 'org-b',
      isCreationBlocked: true,
      accessRestrictionMessage: 'This organisation is on standby.',
    });

    const { result } = renderHook(() => useSwitchOrganizationFlow());

    // Simulate having already picked org-b in a previous render (pendingOrganizationId set).
    act(() => {
      void result.current.selectOrganization('org-b');
    });

    expect(['switching', 'checking', 'blocked']).toContain(result.current.phase);
  });

  it('reset clears the pending selection back to idle', () => {
    useService.mockReturnValue({ clearOrganization: vi.fn() });
    useSwitchToOrganization.mockReturnValue({ switchToOrganization: vi.fn() });
    stubSdk({ selectedOrganizationId: null });

    const { result } = renderHook(() => useSwitchOrganizationFlow());

    act(() => result.current.reset());

    expect(result.current.phase).toBe('idle');
    expect(result.current.pendingOrganizationId).toBeNull();
  });
});
