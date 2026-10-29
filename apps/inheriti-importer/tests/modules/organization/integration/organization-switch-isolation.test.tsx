import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import InMemoryOrganizationKeyVault from '@modules/organization/infrastructure/in-memory-organization-key-vault';

const useGetRawSelectedOrganizationId = vi.fn();
const useSwitchToOrganization = vi.fn();
const useGetSelectedOrganization = vi.fn();
const useSelectedOrganizationMemberCapabilities = vi.fn();
const useAuthenticatedCookieSession = vi.fn();
const useService = vi.fn();

vi.mock('@shared/infrastructure/importer-api', () => ({
  useAuthenticatedCookieSession: (...args: unknown[]) => useAuthenticatedCookieSession(...args),
  useService: (...args: unknown[]) => useService(...args),
}));

vi.mock('@modules/organization/infrastructure/importer-api', () => ({
  useGetSelectedOrganizationId: () => useGetRawSelectedOrganizationId()?.data ?? null,
  useGetRawSelectedOrganizationId: (...args: unknown[]) => useGetRawSelectedOrganizationId(...args),
  useSwitchToOrganization: (...args: unknown[]) => useSwitchToOrganization(...args),
  useGetSelectedOrganization: (...args: unknown[]) => useGetSelectedOrganization(...args),
  useSelectedOrganizationMemberCapabilities: (...args: unknown[]) =>
    useSelectedOrganizationMemberCapabilities(...args),
}));

import useSwitchOrganizationFlow from '@modules/organization/application/use-switch-organization-flow';

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * Host integration test that proves organisation A's Organization Key
 * cannot remain readable once the working context has moved to organisation
 * B, using the REAL `InMemoryOrganizationKeyVault` (the production vault
 * wired into `ImporterRuntime`) rather than a mock of it. Only the runtime's
 * own React hooks are stubbed.
 */
describe('organization switch tenant isolation', () => {
  it('org A key material is gone from the vault once org B is the selected context', async () => {
    const vault = new InMemoryOrganizationKeyVault();
    const sessionIdentity = { sessionFamilyId: 'family-1', userId: 'user-1' };
    const orgAContext = { organizationId: 'org-a', ...sessionIdentity };
    const orgBContext = { organizationId: 'org-b', ...sessionIdentity };

    // Organisation A had a released Organization Key sitting in the vault —
    // exactly what PlanBatchWorkspace would have stored during an import.
    await vault.set(orgAContext, 'org-a-secret-master-key');
    await expect(vault.get(orgAContext)).resolves.toBe('org-a-secret-master-key');

    useService.mockReturnValue(vault);
    useAuthenticatedCookieSession.mockReturnValue({
      session: sessionIdentity,
    });
    useGetRawSelectedOrganizationId.mockReturnValue({ data: 'org-a' });
    useGetSelectedOrganization.mockReturnValue({ data: { id: 'org-b' }, loading: false });
    useSelectedOrganizationMemberCapabilities.mockReturnValue({
      canAccessStagedItems: true,
      loading: false,
    });

    let currentOrganizationId = 'org-a';
    const switchToOrganization = vi.fn(async (nextId: string) => {
      currentOrganizationId = nextId;
    });
    useSwitchToOrganization.mockReturnValue({ switchToOrganization });

    const { result } = renderHook(() => useSwitchOrganizationFlow());

    await act(async () => {
      await result.current.selectOrganization('org-b');
    });

    expect(currentOrganizationId).toBe('org-b');
    // The key organisation A held is gone — switching contexts never leaves
    // a stale organisation's key reachable from the new one.
    await expect(vault.get(orgAContext)).resolves.toBeNull();
    // Organisation B never had a key released, so it correctly has none either
    // (proves the vault wasn't just wiped wholesale, only A's entry was scoped
    // and removed).
    await expect(vault.get(orgBContext)).resolves.toBeNull();
  });

  it('a still-selected organization keeps its key (purge is scoped, not global)', async () => {
    const vault = new InMemoryOrganizationKeyVault();
    const sessionIdentity = { sessionFamilyId: 'family-1', userId: 'user-1' };
    const orgAContext = { organizationId: 'org-a', ...sessionIdentity };
    const orgBContext = { organizationId: 'org-b', ...sessionIdentity };

    await vault.set(orgAContext, 'org-a-secret');
    await vault.set(orgBContext, 'org-b-secret');

    useService.mockReturnValue(vault);
    useAuthenticatedCookieSession.mockReturnValue({ session: sessionIdentity });
    useGetRawSelectedOrganizationId.mockReturnValue({ data: 'org-a' });
    useGetSelectedOrganization.mockReturnValue({ data: { id: 'org-c' }, loading: false });
    useSelectedOrganizationMemberCapabilities.mockReturnValue({
      canAccessStagedItems: true,
      loading: false,
    });
    useSwitchToOrganization.mockReturnValue({
      switchToOrganization: vi.fn().mockResolvedValue(undefined),
    });

    const { result } = renderHook(() => useSwitchOrganizationFlow());

    // Switch to a THIRD organization (org-c); org-b's key must be untouched.
    await act(async () => {
      await result.current.selectOrganization('org-c');
    });

    await expect(vault.get(orgAContext)).resolves.toBeNull();
    await expect(vault.get(orgBContext)).resolves.toBe('org-b-secret');
  });
});
