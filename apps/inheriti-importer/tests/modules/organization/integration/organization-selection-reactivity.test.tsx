import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@shared/infrastructure/importer-api/http', () => ({
  useApiQuery: (_key: unknown, path: string | null) => ({
    data: path?.startsWith('/integrations/v1/organizations/') && !path.endsWith('/member-capabilities')
      ? { id: path.split('/')[4], isActivationPending: false }
      : path?.endsWith('/member-capabilities')
        ? { canAccessStagedItems: true }
        : undefined,
    loading: false,
  }),
}));

vi.mock('@shared/infrastructure/importer-api', () => ({
  useAuthenticatedCookieSession: () => ({ session: { sessionFamilyId: 'family-1', userId: 'user-1' } }),
  useService: () => ({ clearOrganization: vi.fn() }),
}));

import useSwitchOrganizationFlow from '@modules/organization/application/use-switch-organization-flow';
import {
  setActiveOrganizationAccount,
  setSelectedOrganizationForActive,
  useGetSelectedOrganizationId,
} from '@modules/organization/infrastructure/selected-organization-api';

afterEach(() => {
  setActiveOrganizationAccount(null);
  localStorage.clear();
});

describe('organization selection reactivity', () => {
  it('updates the selected organization when the active account changes', () => {
    setActiveOrganizationAccount('account-a');
    const { result } = renderHook(() => useGetSelectedOrganizationId());

    act(() => setSelectedOrganizationForActive('account-a', 'org-a'));
    expect(result.current).toBe('org-a');

    act(() => setActiveOrganizationAccount('account-b'));
    expect(result.current).toBeNull();
    act(() => setSelectedOrganizationForActive('account-b', 'org-b'));
    expect(result.current).toBe('org-b');

    act(() => setActiveOrganizationAccount('account-a'));
    expect(result.current).toBe('org-a');
  });

  it('moves the gate from zero selection through selected-org access to ready', async () => {
    setActiveOrganizationAccount('account-a');
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSwitchOrganizationFlow(), { wrapper });
    expect(result.current.phase).toBe('idle');

    await act(async () => {
      await result.current.selectOrganization('org-a');
    });

    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.accessOrganizationId).toBe('org-a');
    expect(result.current.canUse).toBe(true);
  });
});
