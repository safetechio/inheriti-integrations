import { type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCoreSessionBridge,
  ImporterApiProvider,
  useAuthenticatedCookieSession,
  useService,
  type OrganizationKeyVault,
  type OrganizationEventListener,
} from '@shared/infrastructure/importer-api';
import {
  useFindActiveOrganizationMembersByCriteria,
  useFindActiveOrganizationPlanCategoriesByCriteria,
  useFindSelectedOrganizationPlanCreationTeamsByCriteria,
  useGetCurrentMember,
  useGetJoinedOrganizations,
  useGetMyOrganization,
  useMasterKeySession,
  useOrgSubscriptionStatus,
} from '@modules/organization/infrastructure/importer-api';
import type { ElectronHttpTransport } from '@shared/infrastructure/transport/electron-http-transport';

vi.mock('@safetech/inheriti-core-sdk/crypto', () => ({
  generateRSAOAEPKeyPair: vi.fn(async () => ({
    publicKeyBase64: 'public-key',
    privateKey: {} as CryptoKey,
  })),
}));

const session = {
  sessionFamilyId: 'family-1',
  userId: 'user-1',
  expiresAt: '2099-01-01T00:00:00.000Z',
};

function setup(
  responder: (request: {
    method: string;
    path: string;
    query?: unknown;
    body?: unknown;
  }) => unknown | Promise<unknown>,
  onSessionChange?: ReturnType<typeof createCoreSessionBridge>['update'],
) {
  const transport = {
    request: vi.fn(async (request) => {
      const response = await responder(request);
      return { status: 200, body: { result: response } };
    }),
  } as unknown as ElectronHttpTransport;
  const vault: OrganizationKeyVault = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    clearOrganization: vi.fn(async () => undefined),
    clearSession: vi.fn(async () => undefined),
    clearAllSessions: vi.fn(async () => undefined),
  };
  const authProvider: {
    dispatch?: (action: { type: 'SIGN_IN' | 'SIGN_OUT' | 'AUTH_READY' }) => void;
  } = {};
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const socket = { on: vi.fn(), off: vi.fn(), emit: vi.fn() };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ImporterApiProvider
        transport={transport}
        vault={vault}
        authProvider={authProvider}
        socket={socket}
        onSessionChange={onSessionChange}
      >
        {children}
      </ImporterApiProvider>
    </QueryClientProvider>
  );
  return { transport, vault, authProvider, socket, wrapper };
}

describe('Importer API provider', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('selectedOrganizationId', 'org-1');
  });

  it('joins the API tenant room for Organization Key delivery', () => {
    const { socket, wrapper } = setup(() => session);
    const { result } = renderHook(
      () => useService<OrganizationEventListener>('OrganizationEventListener'),
      {
        wrapper,
      },
    );
    const subscription = {
      organizationId: 'org-1',
      eventName: 'tenant_changed',
      subscriptionKey: 'key-release',
      handlers: { onUpdated: vi.fn() },
    };

    act(() => result.current.subscribe(subscription));
    expect(socket.emit).toHaveBeenCalledWith('subscribe_tenant', { tenantId: 'org-1' });
    act(() => result.current.unsubscribe(subscription));
    expect(socket.emit).toHaveBeenCalledWith('unsubscribe_tenant', { tenantId: 'org-1' });
  });

  it('unwraps list envelopes and sends ACTIVE/member filters through the query contract', async () => {
    const requests: Array<{ path: string; query?: unknown }> = [];
    const { wrapper } = setup((request) => {
      requests.push(request);
      if (request.path === '/user/session') return session;
      if (request.path === '/user/profile') return { id: 'owner-1', email: 'me@example.com' };
      if (request.path === '/organizations')
        return {
          items: [
            { id: 'owned', name: 'Owned', userId: 'owner-1' },
            { id: 'joined', name: 'Joined', userId: 'other' },
          ],
          total: 2,
        };
      return {
        items: [{ id: `${request.path}-item`, name: 'Item', email: 'me@example.com' }],
        total: 1,
      };
    });
    const { result } = renderHook(
      () => ({
        owned: useGetMyOrganization(),
        joined: useGetJoinedOrganizations(),
        categories: useFindActiveOrganizationPlanCategoriesByCriteria(),
        teams: useFindSelectedOrganizationPlanCreationTeamsByCriteria(),
        members: useFindActiveOrganizationMembersByCriteria({
          organizationId: 'org-1',
          email: 'me@example.com',
        }),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.owned.data?.id).toBe('owned'));
    expect(result.current.joined.data?.map((item) => item.id)).toEqual(['joined']);
    expect(Object.keys(result.current.categories.data ?? {})).toHaveLength(1);
    expect(Object.keys(result.current.teams.data ?? {})).toHaveLength(1);
    expect(Object.keys(result.current.members.data ?? {})).toHaveLength(1);
    const filtered = requests.filter(
      (request) =>
        request.path.includes('plan-categories') ||
        request.path.includes('member-plan-creation-teams') ||
        request.path.endsWith('/members'),
    );
    expect(filtered.every((request) => JSON.stringify(request.query).includes('ACTIVE'))).toBe(
      true,
    );
    expect(
      JSON.stringify(filtered.find((request) => request.path.endsWith('/members'))?.query),
    ).toContain('me@example.com');
  });

  it('finds the current active member through profile email and the members endpoint', async () => {
    const requests: Array<{ path: string; query?: unknown }> = [];
    const { wrapper } = setup((request) => {
      requests.push(request);
      if (request.path === '/user/session') return session;
      if (request.path === '/user/profile') return { email: 'me@example.com' };
      if (request.path.endsWith('/members'))
        return { items: [{ id: 'member-1', email: 'me@example.com' }], total: 1 };
      return null;
    });
    const { result } = renderHook(() => useGetCurrentMember(), { wrapper });
    await waitFor(() => expect(result.current.member?.id).toBe('member-1'));
    expect(requests.some((request) => request.path.endsWith('/members/current'))).toBe(false);
    expect(
      JSON.stringify(requests.find((request) => request.path.endsWith('/members'))?.query),
    ).toContain('me@example.com');
  });

  it('shares one confirmation across consumers and purges the replaced session family', async () => {
    let current = session;
    const { transport, vault, wrapper } = setup((request) => {
      if (request.path === '/user/session') return current;
      return null;
    });
    const { result } = renderHook(
      () => ({ first: useAuthenticatedCookieSession(), second: useAuthenticatedCookieSession() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.first.status).toBe('AUTHENTICATED'));
    expect(result.current.first.session).toEqual(result.current.second.session);
    expect(vi.mocked(transport.request)).toHaveBeenCalledTimes(1);
    current = { ...session, sessionFamilyId: 'family-2' };
    await act(() => result.current.second.confirmSession());
    expect(vault.clearSession).toHaveBeenCalledWith('family-1');
    expect(result.current.first.session?.sessionFamilyId).toBe('family-2');
  });

  it('synchronizes confirmed sessions with Core and invalidates a replacement before adoption', async () => {
    let current = session;
    const bridge = createCoreSessionBridge();
    const listener = vi.fn();
    const unsubscribe = bridge.subscribeAuthState(listener);
    const { transport, wrapper } = setup(
      (request) => (request.path === '/user/session' ? current : null),
      bridge.update,
    );
    const { result } = renderHook(() => useAuthenticatedCookieSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('AUTHENTICATED'));
    expect(await bridge.getIdentityId()).toBe('user-1');
    current = { ...session, sessionFamilyId: 'family-2', userId: 'user-2' };
    await act(() => result.current.confirmSession());
    expect(await bridge.getIdentityId()).toBe('user-2');
    vi.mocked(transport.request).mockResolvedValueOnce({ status: 401, body: {} });
    await act(() => result.current.confirmSession());
    expect(await bridge.getIdentityId()).toBeUndefined();
    expect(listener.mock.calls).toEqual([[false], [true], [false], [true], [false]]);
    unsubscribe();
  });

  it('preserves a confirmed descriptor on server errors and expires it on authorization failure', async () => {
    const { transport, vault, wrapper } = setup((request) =>
      request.path === '/user/session' ? session : null,
    );
    const { result } = renderHook(() => useAuthenticatedCookieSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('AUTHENTICATED'));
    vi.mocked(transport.request).mockResolvedValueOnce({ status: 500, body: {} });
    await act(() => result.current.confirmSession());
    expect(result.current.status).toBe('ERROR');
    expect(result.current.session?.sessionFamilyId).toBe('family-1');
    expect(vault.clearSession).not.toHaveBeenCalled();
    vi.mocked(transport.request).mockResolvedValueOnce({ status: 401, body: {} });
    await act(() => result.current.confirmSession());
    expect(result.current.status).toBe('EXPIRED');
    expect(result.current.session).toBeNull();
    expect(vault.clearSession).toHaveBeenCalledWith('family-1');
  });

  it('reconfirms after login, resets on logout, and accepts a different login session', async () => {
    const { transport, vault, authProvider, wrapper } = setup(() => null);
    vi.mocked(transport.request)
      .mockResolvedValueOnce({ status: 401, body: {} })
      .mockResolvedValueOnce({ status: 200, body: { result: session } })
      .mockResolvedValueOnce({
        status: 200,
        body: { result: { ...session, sessionFamilyId: 'family-2', userId: 'user-2' } },
      });
    const { result } = renderHook(() => useAuthenticatedCookieSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe('EXPIRED'));
    act(() => authProvider.dispatch?.({ type: 'SIGN_IN' }));
    await waitFor(() => expect(result.current.session?.sessionFamilyId).toBe('family-1'));
    act(() => authProvider.dispatch?.({ type: 'SIGN_OUT' }));
    expect(result.current.status).toBe('IDLE');
    expect(result.current.session).toBeNull();
    expect(vault.clearAllSessions).toHaveBeenCalledOnce();
    act(() => authProvider.dispatch?.({ type: 'SIGN_IN' }));
    await waitFor(() => expect(result.current.session?.sessionFamilyId).toBe('family-2'));
  });

  it('ignores a confirmation response from an earlier auth epoch', async () => {
    let resolveOld!: (value: { status: number; body: { result: typeof session } }) => void;
    const oldConfirmation = new Promise<{ status: number; body: { result: typeof session } }>(
      (resolve) => {
        resolveOld = resolve;
      },
    );
    const { transport, authProvider, wrapper } = setup(() => null);
    vi.mocked(transport.request)
      .mockImplementationOnce(() => oldConfirmation)
      .mockResolvedValueOnce({
        status: 200,
        body: { result: { ...session, sessionFamilyId: 'new-family' } },
      });
    const { result } = renderHook(() => useAuthenticatedCookieSession(), { wrapper });
    act(() => authProvider.dispatch?.({ type: 'SIGN_IN' }));
    await waitFor(() => expect(result.current.session?.sessionFamilyId).toBe('new-family'));
    resolveOld({ status: 200, body: { result: session } });
    await act(async () => oldConfirmation);
    expect(result.current.session?.sessionFamilyId).toBe('new-family');
  });

  it('resets a failed master-key attempt and becomes ready on retry', async () => {
    let attempts = 0;
    const { wrapper } = setup((request) => {
      if (request.path === '/user/session') return session;
      if (request.path.endsWith('/master-key-session')) {
        attempts += 1;
        if (attempts === 1) throw new Error('failed');
        return { sessionId: 'session-2', envelopeId: 'envelope-2', relayToken: 'relay-2' };
      }
      return null;
    });
    const { result, rerender } = renderHook(
      ({ orgId }) => useMasterKeySession({ orgId, enabled: true, readStoredKey: async () => null }),
      { initialProps: { orgId: 'org-1' }, wrapper },
    );
    await waitFor(() => expect(result.current.step).toBe('error'));
    rerender({ orgId: 'org-2' });
    expect(result.current.step).toBe('preparing');
    await waitFor(() => expect(result.current.sessionId).toBe('session-2'));
  });

  it('cancels a relay session whose creation resolves after unmount', async () => {
    let resolveCreation!: (value: unknown) => void;
    const creation = new Promise((resolve) => {
      resolveCreation = resolve;
    });
    const { transport, wrapper } = setup((request) => {
      if (request.path === '/user/session') return session;
      if (request.path.endsWith('/master-key-session')) return creation;
      return null;
    });
    const { unmount } = renderHook(
      () => useMasterKeySession({ orgId: 'org-1', enabled: true, readStoredKey: async () => null }),
      { wrapper },
    );
    unmount();
    resolveCreation({ sessionId: 'late-session' });
    await waitFor(() =>
      expect(vi.mocked(transport.request)).toHaveBeenCalledWith(
        expect.objectContaining({
          path: '/organizations/org-1/master-key-session/late-session/cancel',
        }),
      ),
    );
  });

  it.each([
    [null, true],
    [{ status: 'ACTIVE' }, false],
    [{ status: 'TRIALING' }, false],
    [{ status: 'PAUSED' }, true],
    [{ status: 'ACTIVE', paymentMethod: { state: 'failed' } }, true],
    [{ status: 'ACTIVE', standbyPeriod: { status: 'ACTIVE' } }, true],
    [{ status: 'ACTIVE', standbyPeriod: { status: 'EXPIRED' } }, true],
    [{ status: 'ACTIVE', lifecycle: { accessMode: 'READ_ONLY' } }, true],
    [{ status: 'PAUSED', lifecycle: { accessMode: 'FULL' } }, false],
  ])('derives subscription eligibility from %j', async (subscription, blocked) => {
    const { wrapper } = setup((request) => {
      if (request.path === '/user/session') return session;
      if (request.path === '/organizations/org-1') return { id: 'org-1', name: 'Org' };
      if (request.path.endsWith('/subscriptions/details')) return subscription;
      return null;
    });
    const { result } = renderHook(() => useOrgSubscriptionStatus(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isCreationBlocked).toBe(blocked);
  });

  it('blocks legacy organizations in standby even with an active subscription', async () => {
    const { wrapper } = setup((request) => {
      if (request.path === '/user/session') return session;
      if (request.path === '/organizations/org-1') {
        return { id: 'org-1', name: 'Org', standbyPeriodInfo: { id: 'standby-1' } };
      }
      if (request.path.endsWith('/subscriptions/details')) return { status: 'ACTIVE' };
      return null;
    });
    const { result } = renderHook(() => useOrgSubscriptionStatus(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isCreationBlocked).toBe(true);
  });
});
