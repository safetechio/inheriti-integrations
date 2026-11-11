import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { ApiStatusError } from '@modules/_shared/domain/api-status-error';

const { state, selectOrganization, retry } = vi.hoisted(() => ({
  state: {
    memberships: [] as { id: string; name: string; isOwned: boolean }[],
    loading: false,
    isRefetching: false,
    error: null as Error | null,
    phase: 'idle',
    blockedReason: null as string | null,
    selectedOrganizationId: null as string | null,
    pendingOrganizationId: null as string | null,
    canUse: false,
    accessLoading: false,
    accessOrganizationId: undefined as string | undefined,
  },
  selectOrganization: vi.fn().mockResolvedValue(undefined),
  retry: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: retry }),
}));
vi.mock('@shared/infrastructure/importer-api', () => ({
  useAuthState: (selector: (state: { notice: null }) => unknown) => selector({ notice: null }),
}));
vi.mock('@modules/organization/application/use-organization-memberships', () => ({
  default: () => ({
    memberships: state.memberships,
    loading: state.loading,
    isRefetching: state.isRefetching,
    error: state.error,
  }),
}));
vi.mock('@modules/organization/application/use-switch-organization-flow', () => ({
  default: () => ({ ...state, selectOrganization }),
}));
vi.mock('@modules/import/ui/components/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => (
    <main>
      <button type="button">Organisation menu</button>
      <button type="button">Account menu</button>
      {children}
    </main>
  ),
}));
vi.mock('@modules/import/ui/components/ImportPanel', () => ({
  ImportPanel: ({
    disabled,
    notice,
    onRetry,
  }: {
    disabled?: boolean;
    notice?: string;
    onRetry?: () => void;
  }) => (
    <section>
      <p>{notice}</p>
      <button type="button" disabled={disabled}>
        Choose files
      </button>
      {onRetry ? (
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </section>
  ),
}));

import OrganizationGate from '@modules/auth/ui/components/OrganizationGate';

beforeEach(() => {
  Object.assign(state, {
    memberships: [],
    loading: false,
    isRefetching: false,
    error: null,
    phase: 'idle',
    blockedReason: null,
    selectedOrganizationId: null,
    pendingOrganizationId: null,
    canUse: false,
    accessLoading: false,
    accessOrganizationId: undefined,
  });
  vi.clearAllMocks();
});
afterEach(cleanup);

function gate() {
  return render(
    <OrganizationGate onSignOut={vi.fn()}>
      <p>Operational importer</p>
    </OrganizationGate>,
  );
}

function expectRecoveryShell(view: ReturnType<typeof gate>) {
  expect(view.getByText('Organisation menu')).toBeTruthy();
  expect(view.getByText('Account menu')).toBeTruthy();
  expect((view.getByText('Choose files') as HTMLButtonElement).disabled).toBe(true);
  expect(view.queryByText('Operational importer')).toBeNull();
  expect(view.queryByText('Choose an organisation')).toBeNull();
}

describe('OrganizationGate landing', () => {
  it('shows the disabled landing and menus when no organisations resolve', () => {
    const view = gate();
    expectRecoveryShell(view);
    expect(view.getByText('No organisations are available for this account.')).toBeTruthy();
  });

  it('keeps import disabled while memberships load', () => {
    state.loading = true;
    const view = gate();
    expectRecoveryShell(view);
    expect(view.getByText('Loading organisations…')).toBeTruthy();
  });

  it('shows a retry for membership errors instead of an empty-state claim', () => {
    state.error = new Error('profile failed');
    const view = gate();
    expectRecoveryShell(view);
    expect(
      view.getByText('Could not load organisations. Retry or choose another account.'),
    ).toBeTruthy();
    expect(view.queryByText('No organisations are available for this account.')).toBeNull();
    fireEvent.click(view.getByText('Retry'));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('keeps recovery menus available when access is blocked', () => {
    Object.assign(state, {
      phase: 'blocked',
      selectedOrganizationId: 'org-a',
      accessOrganizationId: 'org-a',
      blockedReason: 'Subscription expired.',
      memberships: [{ id: 'org-a', name: 'A', isOwned: true }],
    });
    const view = gate();
    expectRecoveryShell(view);
    expect(view.getByText('Subscription expired.')).toBeTruthy();
    fireEvent.click(view.getByText('Retry'));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('selects the first available organisation when no selection exists', () => {
    state.memberships = [
      { id: 'org-a', name: 'A', isOwned: true },
      { id: 'org-b', name: 'B', isOwned: false },
    ];
    const view = gate();
    expectRecoveryShell(view);
    expect(
      view.getByText('Choose an organisation from the menu above to start an import.'),
    ).toBeTruthy();
    expect(selectOrganization).toHaveBeenCalledWith('org-a');
  });

  it('preserves a valid selection and a pending manual switch', () => {
    state.memberships = [
      { id: 'org-a', name: 'A', isOwned: true },
      { id: 'org-b', name: 'B', isOwned: false },
    ];
    state.selectedOrganizationId = 'org-b';
    gate();
    expect(selectOrganization).not.toHaveBeenCalledWith('org-a');
    cleanup();
    vi.clearAllMocks();
    state.selectedOrganizationId = null;
    state.pendingOrganizationId = 'org-b';
    state.phase = 'switching';
    gate();
    expect(selectOrganization).not.toHaveBeenCalled();
  });

  it('replaces a stale saved selection only after memberships resolve successfully', () => {
    state.memberships = [{ id: 'org-a', name: 'A', isOwned: true }];
    state.selectedOrganizationId = 'org-old';
    state.loading = true;
    const view = gate();
    expect(selectOrganization).not.toHaveBeenCalled();
    state.loading = false;
    state.error = new ApiStatusError('denied', 403);
    view.rerender(
      <OrganizationGate onSignOut={vi.fn()}>
        <p>Operational importer</p>
      </OrganizationGate>,
    );
    expect(selectOrganization).not.toHaveBeenCalled();
    state.error = null;
    view.rerender(
      <OrganizationGate onSignOut={vi.fn()}>
        <p>Operational importer</p>
      </OrganizationGate>,
    );
    expect(selectOrganization).toHaveBeenCalledWith('org-a');
  });

  it('waits for a background refetch before replacing an apparently stale selection', () => {
    state.memberships = [{ id: 'org-a', name: 'A', isOwned: true }];
    state.selectedOrganizationId = 'org-b';
    state.isRefetching = true;
    const view = gate();
    expect(selectOrganization).not.toHaveBeenCalledWith('org-a');
    state.memberships = [
      { id: 'org-a', name: 'A', isOwned: true },
      { id: 'org-b', name: 'B', isOwned: false },
    ];
    state.isRefetching = false;
    view.rerender(
      <OrganizationGate onSignOut={vi.fn()}>
        <p>Operational importer</p>
      </OrganizationGate>,
    );
    expect(selectOrganization).not.toHaveBeenCalledWith('org-a');
  });

  it.each([401, 403, 500])('does not replace a saved selection after refetch HTTP %i', (status) => {
    state.memberships = [{ id: 'org-a', name: 'A', isOwned: true }];
    state.selectedOrganizationId = 'org-b';
    state.isRefetching = true;
    const view = gate();
    state.isRefetching = false;
    state.error = new ApiStatusError('failed', status);
    view.rerender(
      <OrganizationGate onSignOut={vi.fn()}>
        <p>Operational importer</p>
      </OrganizationGate>,
    );
    expect(selectOrganization).not.toHaveBeenCalledWith('org-a');
  });

  it('auto-selects the only organisation, then mounts the importer only after matching access', () => {
    state.memberships = [{ id: 'org-a', name: 'A', isOwned: true }];
    const view = gate();
    expectRecoveryShell(view);
    expect(selectOrganization).toHaveBeenCalledWith('org-a');
    Object.assign(state, {
      phase: 'ready',
      selectedOrganizationId: 'org-a',
      accessOrganizationId: 'org-b',
      canUse: true,
    });
    view.rerender(
      <OrganizationGate onSignOut={vi.fn()}>
        <p>Operational importer</p>
      </OrganizationGate>,
    );
    expectRecoveryShell(view);
    Object.assign(state, { accessOrganizationId: 'org-a' });
    view.rerender(
      <OrganizationGate onSignOut={vi.fn()}>
        <p>Operational importer</p>
      </OrganizationGate>,
    );
    expect(view.getByText('Operational importer')).toBeTruthy();
    expect(view.queryByText('Choose files')).toBeNull();
  });

  it('preserves an authorized workspace when a membership refetch fails', () => {
    function Workspace() {
      const [value, setValue] = useState('edited secret');
      return (
        <input
          aria-label="Workspace value"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      );
    }
    Object.assign(state, {
      memberships: [{ id: 'org-a', name: 'A', isOwned: true }],
      phase: 'ready',
      selectedOrganizationId: 'org-a',
      accessOrganizationId: 'org-a',
      canUse: true,
    });
    const view = render(
      <OrganizationGate onSignOut={vi.fn()}>
        <Workspace />
      </OrganizationGate>,
    );
    fireEvent.change(view.getByLabelText('Workspace value'), { target: { value: 'unsaved edit' } });
    state.error = new Error('temporary profile failure');
    view.rerender(
      <OrganizationGate onSignOut={vi.fn()}>
        <Workspace />
      </OrganizationGate>,
    );
    expect((view.getByLabelText('Workspace value') as HTMLInputElement).value).toBe('unsaved edit');
    state.memberships = [];
    view.rerender(
      <OrganizationGate onSignOut={vi.fn()}>
        <Workspace />
      </OrganizationGate>,
    );
    expectRecoveryShell(view);
  });

  it.each([401, 403])('closes cached membership access after HTTP %i', (status) => {
    Object.assign(state, {
      memberships: [{ id: 'org-a', name: 'A', isOwned: true }],
      phase: 'ready',
      selectedOrganizationId: 'org-a',
      accessOrganizationId: 'org-a',
      canUse: true,
      error: new ApiStatusError('denied', status),
    });
    const view = gate();
    expectRecoveryShell(view);
    expect(
      view.getByText('Could not load organisations. Retry or choose another account.'),
    ).toBeTruthy();
  });
});
