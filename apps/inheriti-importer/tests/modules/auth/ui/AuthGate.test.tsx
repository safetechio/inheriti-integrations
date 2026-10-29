import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const useAuthProvider = vi.fn();
const useAuthState = vi.fn();
const useAuthenticatedCookieSession = vi.fn();
const useGetJoinedOrganizations = vi.fn();
const useGetMyOrganization = vi.fn();
const useGetSelectedOrganization = vi.fn();
const useSelectedOrganizationMemberCapabilities = vi.fn();
const useGetSelectedOrganizationId = vi.fn();
const useSwitchToOrganization = vi.fn();
const useService = vi.fn();
const useGetIdentity = vi.fn();
const useGetCurrentMember = vi.fn();

vi.mock('@shared/infrastructure/importer-api', () => ({
  useAuthProvider: (...args: unknown[]) => useAuthProvider(...args),
  useAuthState: (selector: (state: unknown) => unknown) => useAuthState(selector),
  useAuthenticatedCookieSession: (...args: unknown[]) => useAuthenticatedCookieSession(...args),
  useService: (...args: unknown[]) => useService(...args),
}));

vi.mock('@modules/organization/infrastructure/importer-api', () => ({
  useGetIdentity: (...args: unknown[]) => useGetIdentity(...args),
  useGetCurrentMember: (...args: unknown[]) => useGetCurrentMember(...args),
  useGetJoinedOrganizations: (...args: unknown[]) => useGetJoinedOrganizations(...args),
  useGetMyOrganization: (...args: unknown[]) => useGetMyOrganization(...args),
  useGetSelectedOrganization: (...args: unknown[]) => useGetSelectedOrganization(...args),
  useSelectedOrganizationMemberCapabilities: (...args: unknown[]) =>
    useSelectedOrganizationMemberCapabilities(...args),
  useGetSelectedOrganizationId: (...args: unknown[]) => useGetSelectedOrganizationId(...args),
  useSwitchToOrganization: (...args: unknown[]) => useSwitchToOrganization(...args),
}));

vi.mock('@modules/organization/infrastructure/organization-resources-api', () => ({
  useGetCurrentMember: (...args: unknown[]) => useGetCurrentMember(...args),
}));

import { AuthGate } from '@modules/auth/ui';

type AuthProviderMock = {
  state?: { authInitialized: boolean; isLoggedIn: boolean };
  dispatch?: (action: unknown) => void;
  restoreSession: () => Promise<void>;
  login: () => Promise<unknown>;
  cancelLogin: () => Promise<void>;
  logout: () => Promise<void>;
  accounts?: () => Promise<Array<{ key: string; subject: string; active: boolean }>>;
  activateAccount?: (key: string) => Promise<void>;
};

function makeAuthProvider(overrides: Partial<AuthProviderMock> = {}): AuthProviderMock {
  return {
    restoreSession: vi.fn().mockResolvedValue(undefined),
    login: vi.fn().mockResolvedValue({}),
    cancelLogin: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function stubAuthState(state: {
  authInitialized: boolean;
  isLoggedIn: boolean;
  accountsRevision?: number;
  notice?: string | null;
}) {
  useAuthState.mockImplementation((selector: (s: unknown) => unknown) => selector(state));
}

function stubReadyOrganization(
  overrides: {
    canAccessStagedItems?: boolean;
    isActivationPending?: boolean;
  } = {},
) {
  useGetMyOrganization.mockReturnValue({
    data: { id: 'org-a', name: 'Acme' },
    loading: false,
    isRefetching: false,
  });
  useGetJoinedOrganizations.mockReturnValue({ data: [], loading: false, isRefetching: false });
  useGetSelectedOrganizationId.mockReturnValue('org-a');
  useGetSelectedOrganization.mockReturnValue({
    data: { id: 'org-a', name: 'Acme', isActivationPending: overrides.isActivationPending ?? false },
    loading: false,
  });
  useSelectedOrganizationMemberCapabilities.mockReturnValue({
    canAccessStagedItems: overrides.canAccessStagedItems ?? true,
    loading: false,
  });
  useSwitchToOrganization.mockReturnValue({
    switchToOrganization: vi.fn().mockResolvedValue(undefined),
  });
  useService.mockReturnValue({ clearOrganization: vi.fn().mockResolvedValue(undefined) });
}

beforeEach(() => {
  useGetIdentity.mockReturnValue({ identity: { fullName: 'Ada', email: 'ada@example.com' } });
  useGetCurrentMember.mockReturnValue({ member: { id: 'member-1' } });
  useAuthenticatedCookieSession.mockReturnValue({
    status: 'AUTHENTICATED',
    confirmSession: vi.fn().mockResolvedValue(undefined),
    session: { sessionFamilyId: 'family-1', userId: 'user-1' },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AuthGate — restore / sign-in / cancel', () => {
  it('calls restoreSession on mount', () => {
    const provider = makeAuthProvider();
    useAuthProvider.mockReturnValue(provider);
    stubAuthState({ authInitialized: false, isLoggedIn: false });

    render(<AuthGate>content</AuthGate>);

    expect(provider.restoreSession).toHaveBeenCalledTimes(1);
  });

  it('shows the sign-in screen once restore says signed out', () => {
    useAuthProvider.mockReturnValue(makeAuthProvider());
    stubAuthState({ authInitialized: true, isLoggedIn: false });

    render(<AuthGate>content</AuthGate>);

    expect(screen.getByText('Sign in with SafeID')).toBeTruthy();
  });

  it('offers saved accounts after sign-out and activates the selected profile', async () => {
    const activateAccount = vi.fn().mockResolvedValue(undefined);
    useAuthProvider.mockReturnValue(
      makeAuthProvider({
        accounts: vi.fn().mockResolvedValue([{ key: 'account-b', subject: 'B', active: false }]),
        activateAccount,
      }),
    );
    stubAuthState({ authInitialized: true, isLoggedIn: false });
    stubReadyOrganization();

    render(<AuthGate>content</AuthGate>);

    fireEvent.click(await screen.findByRole('button', { name: 'Continue with saved account' }));
    await waitFor(() => expect(activateAccount).toHaveBeenCalledWith('account-b'));
  });

  it('reloads saved accounts when the active account signs out without restarting', async () => {
    const accounts = vi.fn().mockResolvedValue([{ key: 'account-b', subject: 'B', active: false }]);
    useAuthProvider.mockReturnValue(makeAuthProvider({ accounts }));
    stubAuthState({ authInitialized: true, isLoggedIn: true });
    stubReadyOrganization();
    const view = render(<AuthGate>content</AuthGate>);

    stubAuthState({ authInitialized: true, isLoggedIn: false });
    view.rerender(<AuthGate>content</AuthGate>);

    expect(await screen.findByRole('button', { name: 'Continue with saved account' })).toBeTruthy();
    expect(accounts).toHaveBeenCalled();
  });

  it('clears an early saved-account chooser snapshot after sign-out-all completes', async () => {
    const accounts = vi
      .fn()
      .mockResolvedValueOnce([{ key: 'account-b', subject: 'B', active: false }])
      .mockResolvedValueOnce([])
      .mockResolvedValue([]);
    useAuthProvider.mockReturnValue(makeAuthProvider({ accounts }));
    stubAuthState({ authInitialized: true, isLoggedIn: false, accountsRevision: 0 });
    const view = render(<AuthGate>content</AuthGate>);
    expect(await screen.findByRole('button', { name: 'Continue with saved account' })).toBeTruthy();

    stubAuthState({ authInitialized: true, isLoggedIn: false, accountsRevision: 1 });
    view.rerender(<AuthGate>content</AuthGate>);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Continue with saved account' })).toBeNull());
  });

  it('ignores a late saved-account list from before sign-out-all completed', async () => {
    let resolveOld: (
      accounts: Array<{ key: string; subject: string; active: boolean }>,
    ) => void = () => {};
    const accounts = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValue([]);
    useAuthProvider.mockReturnValue(makeAuthProvider({ accounts }));
    stubAuthState({ authInitialized: true, isLoggedIn: false, accountsRevision: 0 });
    const view = render(<AuthGate>content</AuthGate>);

    stubAuthState({ authInitialized: true, isLoggedIn: false, accountsRevision: 1 });
    view.rerender(<AuthGate>content</AuthGate>);
    await waitFor(() => expect(accounts).toHaveBeenCalledTimes(2));
    await act(async () => {
      resolveOld([{ key: 'account-b', subject: 'B', active: false }]);
    });
    expect(screen.queryByRole('button', { name: 'Continue with saved account' })).toBeNull();
  });

  it('clicking sign-in calls the provider login and lets a cancel abort it', async () => {
    let resolveLogin: (value: unknown) => void = () => {};
    const login = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveLogin = resolve;
        }),
    );
    const cancelLogin = vi.fn().mockResolvedValue(undefined);
    useAuthProvider.mockReturnValue(makeAuthProvider({ login, cancelLogin }));
    stubAuthState({ authInitialized: true, isLoggedIn: false });

    render(<AuthGate>content</AuthGate>);

    fireEvent.click(screen.getByText('Sign in with SafeID'));
    expect(login).toHaveBeenCalledTimes(1);

    // While the login promise is pending, a Cancel affordance is shown.
    const cancelButton = await screen.findByText('Cancel');
    fireEvent.click(cancelButton);
    await waitFor(() => expect(cancelLogin).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Sign in with SafeID')).toBeTruthy();

    resolveLogin({});
  });

  it('shows the raw error message on a real login failure, but not for AUTH_CANCELLED', async () => {
    const login = vi.fn().mockRejectedValue(new Error('NETWORK_DOWN'));
    useAuthProvider.mockReturnValue(makeAuthProvider({ login }));
    stubAuthState({ authInitialized: true, isLoggedIn: false });

    render(<AuthGate>content</AuthGate>);
    fireEvent.click(screen.getByText('Sign in with SafeID'));

    await waitFor(() => expect(screen.getByText('NETWORK_DOWN')).toBeTruthy());
  });
});

describe('AuthGate — organization selection and sign-out', () => {
  it('keeps a failed cross-account destination notice visible on the organization gate', async () => {
    useAuthProvider.mockReturnValue(makeAuthProvider());
    stubAuthState({
      authInitialized: true,
      isLoggedIn: true,
      notice: 'That organisation is no longer available for this account.',
    });
    stubReadyOrganization({ canAccessStagedItems: false });

    render(
      <AuthGate>
        <div data-testid="protected">secret content</div>
      </AuthGate>,
    );

    expect(
      (await screen.findAllByText('That organisation is no longer available for this account.')).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByTestId('protected')).toBeNull();
  });
  it('renders imported children once signed in, an organization is selectable, and the cookie session is confirmed', async () => {
    useAuthProvider.mockReturnValue(makeAuthProvider());
    stubAuthState({ authInitialized: true, isLoggedIn: true });
    stubReadyOrganization();

    render(
      <AuthGate>
        <div data-testid="protected">secret content</div>
      </AuthGate>,
    );

    await waitFor(() => expect(screen.getByTestId('protected')).toBeTruthy());
  });

  it('shows the blocked reason and withholds children when the organization capability check fails', async () => {
    useAuthProvider.mockReturnValue(makeAuthProvider());
    stubAuthState({ authInitialized: true, isLoggedIn: true });
    stubReadyOrganization({ canAccessStagedItems: false });

    render(
      <AuthGate>
        <div data-testid="protected">secret content</div>
      </AuthGate>,
    );

    await waitFor(() =>
      expect(
        screen.getByText('You do not have permission to stage imports in this organisation.'),
      ).toBeTruthy(),
    );
    expect(screen.queryByTestId('protected')).toBeNull();
  });

  it('signing out from the organization gate calls the provider logout', async () => {
    // The gate's own "Sign out" affordance lives on the selection screen
    // itself (it disappears once `children` renders — the account-menu sign
    // out in AppShell covers the post-selection case), so exercise it from
    // the blocked-organization state.
    const logout = vi.fn().mockResolvedValue(undefined);
    useAuthProvider.mockReturnValue(makeAuthProvider({ logout }));
    stubAuthState({ authInitialized: true, isLoggedIn: true });
    stubReadyOrganization({ canAccessStagedItems: false });

    render(
      <AuthGate>
        <div data-testid="protected">secret content</div>
      </AuthGate>,
    );
    await waitFor(() =>
      expect(
        screen.getByText('You do not have permission to stage imports in this organisation.'),
      ).toBeTruthy(),
    );

    fireEvent.click(screen.getByText('Sign out'));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
  });
});

describe('AuthGate — session-proof states (expired / replaced / offline / error)', () => {
  beforeEach(() => {
    useAuthProvider.mockReturnValue(makeAuthProvider());
    stubAuthState({ authInitialized: true, isLoggedIn: true });
    stubReadyOrganization();
  });

  it('shows an expired message with a sign-in-again action', () => {
    useAuthenticatedCookieSession.mockReturnValue({
      status: 'EXPIRED',
      confirmSession: vi.fn(),
      session: null,
    });

    render(
      <AuthGate>
        <div data-testid="protected" />
      </AuthGate>,
    );

    expect(screen.getByText('Session expired')).toBeTruthy();
    expect(screen.getByText('Sign in again')).toBeTruthy();
    expect(screen.queryByTestId('protected')).toBeNull();
  });

  it('treats an AUTHENTICATED-to-IDLE drop as replaced-elsewhere, not as ordinary boot checking', () => {
    // First render: cookie session is AUTHENTICATED.
    useAuthenticatedCookieSession.mockReturnValue({
      status: 'AUTHENTICATED',
      confirmSession: vi.fn(),
      session: { sessionFamilyId: 'family-1', userId: 'user-1' },
    });
    const { rerender } = render(
      <AuthGate>
        <div data-testid="protected" />
      </AuthGate>,
    );

    // Another window took over the session: the manager broadcasts and this
    // window's status collapses to IDLE without a local logout.
    useAuthenticatedCookieSession.mockReturnValue({
      status: 'IDLE',
      confirmSession: vi.fn(),
      session: null,
    });
    act(() => {
      rerender(
        <AuthGate>
          <div data-testid="protected" />
        </AuthGate>,
      );
    });

    expect(screen.getByText('Signed out elsewhere')).toBeTruthy();
    expect(screen.queryByTestId('protected')).toBeNull();
  });

  it('distinguishes offline from a generic confirmation error and lets the user retry', async () => {
    const originalOnLine = window.navigator.onLine;
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });

    const confirmSession = vi.fn().mockResolvedValue(undefined);
    useAuthenticatedCookieSession.mockReturnValue({
      status: 'ERROR',
      confirmSession,
      session: null,
    });

    render(
      <AuthGate>
        <div data-testid="protected" />
      </AuthGate>,
    );

    expect(screen.getByText('You are offline')).toBeTruthy();
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(confirmSession).toHaveBeenCalledTimes(1));

    Object.defineProperty(window.navigator, 'onLine', {
      value: originalOnLine,
      configurable: true,
    });
  });

  it('shows a generic error with retry when online but confirmation still failed', () => {
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
    useAuthenticatedCookieSession.mockReturnValue({
      status: 'ERROR',
      confirmSession: vi.fn(),
      session: null,
    });

    render(
      <AuthGate>
        <div data-testid="protected" />
      </AuthGate>,
    );

    expect(screen.getByText('Could not verify your session')).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
  });
});
