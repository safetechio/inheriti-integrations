// @vitest-environment happy-dom
// See MappingWorkspace.test.tsx for why happy-dom is required here (getPlanAssetIconName
// pulls in Core's /core bundle).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const usePlanBatchController = vi.fn();

vi.mock('@modules/batch/application/use-plan-batch-controller', () => ({
  usePlanBatchController: (...args: unknown[]) => usePlanBatchController(...args),
}));

import { PlanBatchWorkspace } from '@modules/plans/ui/components/PlanBatchWorkspace';
import { createEmptyImportSession, type ImportSession } from '@modules/import/domain/import-model';
import { makePlanDraft, type PlanDraft } from '@modules/plans/domain/workspace-model';
import type { PlanBatchControllerState } from '@modules/batch/application/use-plan-batch-controller';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function controllerState(
  overrides: Partial<PlanBatchControllerState> = {},
): PlanBatchControllerState {
  return {
    organizationId: 'org-1',
    organizationKey: {
      configured: true,
      configuredLoading: false,
      activePlanId: null,
      step: 'ready',
      error: null,
    },
    storage: { loading: false, activeDataStorageLayerCount: 1 },
    ready: true,
    running: false,
    items: [],
    result: { complete: [], createdUnconfigured: [], failed: [], cancelled: [] },
    execute: vi.fn(),
    retryCreate: vi.fn(),
    retryConfigure: vi.fn(),
    cancel: vi.fn(),
    ...overrides,
  };
}

function plan(clientId = 'plan-1'): PlanDraft {
  return makePlanDraft(clientId, 'My Plan');
}

function session(): ImportSession {
  return createEmptyImportSession('session-1');
}

function renderWorkspace(
  overrides: Partial<PlanBatchControllerState> = {},
  plans: PlanDraft[] = [plan()],
) {
  usePlanBatchController.mockReturnValue(controllerState(overrides));
  const onSuccess = vi.fn();
  render(<PlanBatchWorkspace plans={plans} session={session()} onSuccess={onSuccess} />);
  return { onSuccess };
}

describe('PlanBatchWorkspace', () => {
  it('renders nothing with no Plans, before the controller is even consulted for state', () => {
    usePlanBatchController.mockReturnValue(controllerState());
    const { container } = render(
      <PlanBatchWorkspace plans={[]} session={session()} onSuccess={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows the configured-but-not-released Organization Key state', () => {
    renderWorkspace();
    expect(screen.getByText('Configured — release required when staging')).toBeTruthy();
  });

  it('prompts to configure the Organization Key when it is not yet set up', () => {
    renderWorkspace({
      organizationKey: {
        configured: false,
        configuredLoading: false,
        activePlanId: null,
        step: 'idle',
        error: null,
      },
    });
    expect(screen.getByText('Not configured')).toBeTruthy();
    expect(screen.getByText(/Configure the Organization Key in Inheriti® Business/i)).toBeTruthy();
  });

  it('shows the not-claimed state when no SafeKey device has claimed the key', () => {
    renderWorkspace({
      organizationKey: {
        configured: true,
        configuredLoading: false,
        activePlanId: null,
        step: 'not-claimed',
        error: null,
      },
    });
    expect(screen.getByText('Waiting for SafeKey claim')).toBeTruthy();
    expect(screen.getByText(/has not been claimed on a SafeKey device/i)).toBeTruthy();
  });

  it('shows an Offline status and recovery message on a network-shaped release error', () => {
    renderWorkspace({
      organizationKey: {
        configured: true,
        configuredLoading: false,
        activePlanId: 'plan-1',
        step: 'error',
        error: 'Network request failed: fetch timeout',
      },
    });
    expect(screen.getByText('Offline')).toBeTruthy();
    expect(screen.getByText(/Reconnect to Inheriti® Business/i)).toBeTruthy();
  });

  it('shows a Session expired status and recovery message on an auth-shaped release error', () => {
    renderWorkspace({
      organizationKey: {
        configured: true,
        configuredLoading: false,
        activePlanId: 'plan-1',
        step: 'error',
        error: 'Unauthorized: session has expired, please login again',
      },
    });
    expect(screen.getByText('Session expired')).toBeTruthy();
    expect(screen.getByText(/Sign in again to continue this import/i)).toBeTruthy();
  });

  it('shows a Plan-bound releasing state while a specific Plan is waiting on its key', () => {
    renderWorkspace({
      organizationKey: {
        configured: true,
        configuredLoading: false,
        activePlanId: 'plan-1',
        step: 'ready',
        error: null,
      },
    });
    expect(screen.getByText('Waiting for SafeKey to release this Plan’s key')).toBeTruthy();
  });

  it('allows staging while the storage layer summary is loading', () => {
    renderWorkspace({ storage: { loading: true, activeDataStorageLayerCount: undefined } });
    expect(screen.getByRole('button', { name: 'Stage import' })).toHaveProperty('disabled', false);
  });

  it('allows staging when the organization has no active storage layer', () => {
    renderWorkspace({ storage: { loading: false, activeDataStorageLayerCount: 0 } });
    expect(screen.getByRole('button', { name: 'Stage import' })).toHaveProperty('disabled', false);
  });

  it('disables staging when no organization is selected, and explains why', () => {
    renderWorkspace({ organizationId: undefined, ready: false });
    expect(screen.getByRole('button', { name: 'Stage import' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/Select an organization before importing/i)).toBeTruthy();
  });

  it('enables staging once organization and key are ready', () => {
    renderWorkspace();
    expect(screen.getByRole('button', { name: 'Stage import' })).toHaveProperty('disabled', false);
  });

  it('only shows Cancel while a batch is running, and Cancel calls the controller', () => {
    const { rerender } = (() => {
      usePlanBatchController.mockReturnValue(controllerState({ running: false }));
      const utils = render(
        <PlanBatchWorkspace plans={[plan()]} session={session()} onSuccess={vi.fn()} />,
      );
      return utils;
    })();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();

    const cancel = vi.fn();
    usePlanBatchController.mockReturnValue(controllerState({ running: true, cancel }));
    rerender(<PlanBatchWorkspace plans={[plan()]} session={session()} onSuccess={vi.fn()} />);

    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelButton);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Working…' })).toHaveProperty('disabled', true);
  });

  it('renders one row per batch item and offers the matching retry action for each terminal state', () => {
    const retryCreate = vi.fn();
    const retryConfigure = vi.fn();
    renderWorkspace({
      retryCreate,
      retryConfigure,
      items: [
        { planId: 'plan-created', status: 'FAILED_CREATE' },
        { planId: 'plan-staged', status: 'FAILED_CONFIGURE' },
        { planId: 'plan-ok', status: 'COMPLETE' },
      ],
      result: {
        complete: [{ planId: 'plan-ok', status: 'COMPLETE' }],
        createdUnconfigured: [{ planId: 'plan-staged', status: 'FAILED_CONFIGURE' }],
        failed: [{ planId: 'plan-created', status: 'FAILED_CREATE' }],
        cancelled: [],
      },
    });

    expect(screen.getByText(/plan-created · FAILED_STAGE/)).toBeTruthy();
    expect(screen.getByText(/plan-staged · FAILED_STAGE/)).toBeTruthy();
    expect(screen.getByText(/plan-ok · STAGED/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retryCreate).toHaveBeenCalledWith('plan-created');

    fireEvent.click(screen.getAllByRole('button', { name: 'Retry staging' })[0]!);
    expect(retryConfigure).toHaveBeenCalledWith('plan-staged');
  });

  it('shows cancelled items in the progress summary without counting them as staged', () => {
    renderWorkspace({
      items: [
        { planId: 'plan-a', status: 'COMPLETE' },
        { planId: 'plan-b', status: 'CANCELLED' },
      ],
      result: {
        complete: [{ planId: 'plan-a', status: 'COMPLETE' }],
        createdUnconfigured: [],
        failed: [],
        cancelled: [{ planId: 'plan-b', status: 'CANCELLED' }],
      },
    });
    expect(screen.getByText(/Staged: 1 · Pending: 0 · Failed: 0 · Cancelled: 1/)).toBeTruthy();
  });
});
