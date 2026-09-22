import { describe, expect, it, vi } from 'vitest';
import { ActiveRevealRegistry, GovernanceProgressPresenter, progressMessage, revealAndInsert, RevealInsertUnavailable, RevealStoppedByDeadManSwitch } from '../src/reveal.js';
import { messageFor } from '../src/plan-view-model.js';
import type { RevealCancellationToken, RevealProgressReporter } from '../src/reveal.js';

function fixture(overrides: Record<string, unknown> = {}) {
  const reports: string[] = [];
  const field = vi.fn().mockResolvedValue('protected-value');
  const core = {
    getPlan: vi.fn().mockResolvedValue({
      assets: [{ id: 'asset-1', code: 'prod-db', name: 'Production database', fieldNames: ['username', 'password'] }],
      governance: { mode: 'GOVERNED' },
    }),
    withReveal: vi.fn(async (_planId, options, work) => {
      options.onProgress?.({
        phase: 'WAITING_FOR_MODERATION',
        session: { stage: 'WAITING_FOR_PARTICIPANTS', approvedModerators: 1, requiredModerators: 2 },
      });
      return work({
        session: { expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() },
        field,
      });
    }),
    ...overrides,
  };
  const ui = {
    withProgress: async <TResult>(task: (progress: RevealProgressReporter, token: RevealCancellationToken) => Promise<TResult>): Promise<TResult> => task(
      { report: ({ message }) => { if (message) reports.push(message); } },
      { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: vi.fn() }) },
    ),
    pickField: vi.fn().mockResolvedValue('prod-db.password'),
    insertAtCursor: vi.fn().mockResolvedValue(true),
  };
  return { core, ui, field, reports };
}

describe('VS Code reveal and insert', () => {
  it('opens a direct reveal for a plan with no gate, without being told to', async () => {
    const { core } = fixture({
      getPlan: vi.fn().mockResolvedValue({
        assets: [{ id: 'asset-1', code: 'prod-db', name: 'Production database', fieldNames: ['password'] }],
        governance: { mode: 'DIRECT' },
      }),
    });

    await revealAndInsert(core as never, fixture().ui as never, new ActiveRevealRegistry(), 'plan-1');

    expect(core.withReveal.mock.calls[0]?.[1]).toMatchObject({ mode: 'DIRECT' });
  });

  it('shows selectors only, then requests INSERT_FIELD and inserts the selected value', async () => {
    const { core, ui, field, reports } = fixture();

    await revealAndInsert(core as never, ui as never, new ActiveRevealRegistry(), 'plan-1');

    expect(ui.pickField).toHaveBeenCalledWith([
      { label: 'prod-db.username', description: 'Production database', selector: 'prod-db.username' },
      { label: 'prod-db.password', description: 'Production database', selector: 'prod-db.password' },
    ]);
    expect(JSON.stringify(ui.pickField.mock.calls)).not.toContain('protected-value');
    expect(field).toHaveBeenCalledWith('prod-db.password', { action: 'INSERT_FIELD' });
    expect(ui.insertAtCursor).toHaveBeenCalledWith('protected-value');
    expect(core.withReveal.mock.calls[0]?.[1]).toMatchObject({ mode: 'GOVERNED' });
    expect(reports).toContain('Waiting for moderators (1 of 2 approved).');
    expect(reports.some((message) => message.includes('Data will be accessible for 10 minutes.'))).toBe(true);
  });

  it('aborts the scoped reveal when the progress notification is canceled', async () => {
    let cancel: (() => void) | undefined;
    const core = {
      getPlan: vi.fn().mockResolvedValue({ assets: [{ id: 'asset-1', fieldNames: ['password'] }] }),
      withReveal: vi.fn((_planId, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('canceled'), { name: 'AbortError' })));
        cancel?.();
      })),
    };
    const ui = {
      withProgress: <TResult>(task: (progress: RevealProgressReporter, token: RevealCancellationToken) => Promise<TResult>): Promise<TResult> => task(
        { report: vi.fn() },
        { isCancellationRequested: false, onCancellationRequested: (listener: () => void) => { cancel = listener; return { dispose: vi.fn() }; } },
      ),
      pickField: vi.fn(),
      insertAtCursor: vi.fn(),
    };

    await expect(revealAndInsert(core as never, ui as never, new ActiveRevealRegistry(), 'plan-1'))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(ui.insertAtCursor).not.toHaveBeenCalled();
  });

  it('aborts every active reveal when the extension disposable is released', () => {
    const active = new ActiveRevealRegistry();
    const first = active.create();
    const second = active.create();

    active.dispose();

    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
  });

  it('refuses to open a reveal when the plan exposes no insertable text field', async () => {
    const { core, ui } = fixture({ getPlan: vi.fn().mockResolvedValue({ assets: [] }) });

    await expect(revealAndInsert(core as never, ui as never, new ActiveRevealRegistry(), 'plan-1'))
      .rejects.toBeInstanceOf(RevealInsertUnavailable);
    expect(core.withReveal).not.toHaveBeenCalled();
  });

  // The wording is shared, so the editor only has to prove it renders what the SDK reports and
  // never leaks a protocol stage. The catalogue itself is covered once, in packages/core.
  it('renders the phase the SDK reports, without exposing protocol stages', () => {
    const text = progressMessage({
      phase: 'WAITING_FOR_MODERATION',
      session: { stage: 'WAITING_FOR_PARTICIPANTS', approvedModerators: 0, requiredModerators: 1 },
    } as never);

    expect(text).toBe('Waiting for moderators (0 of 1 approved).');
    expect(text).not.toContain('WAITING_FOR_PARTICIPANTS');
  });

  it('names the member’s own confirmation, never moderation, at the authentication gate', () => {
    const text = progressMessage({
      phase: 'WAITING_FOR_AUTHENTICATION',
      session: { stage: 'WAITING_FOR_PARTICIPANTS' },
    } as never);

    expect(text).toContain('Confirm this access on SafeKey Mobile');
    expect(text).not.toContain('moderator');
  });

  it.each(['WAITING_FOR_AUTHENTICATION', 'WAITING_FOR_MODERATION'] as const)(
    'counts down the server deadline while %s is active',
    (phase) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
      const reports: string[] = [];
      const presenter = new GovernanceProgressPresenter({
        report: ({ message }) => { if (message) reports.push(message); },
      });
      try {
        presenter.update({
          phase,
          session: { stage: 'WAITING_FOR_PARTICIPANTS', governanceExpiresAt: '2030-01-01T00:01:01.000Z' },
        } as never);
        expect(reports.at(-1)).toContain('Time remaining 01:01.');

        vi.advanceTimersByTime(2_000);
        expect(reports.at(-1)).toContain('Time remaining 00:59.');
      } finally {
        presenter.close();
        vi.useRealTimers();
      }
    },
  );

  it('reports the gate reset through progress and the error boundary, without claiming an insert', async () => {
    const reports: string[] = [];
    const insertAtCursor = vi.fn();
    const core = {
      getPlan: vi.fn().mockResolvedValue({ assets: [{ id: 'asset-1', code: 'prod-db', fieldNames: ['password'] }] }),
      withReveal: vi.fn(async (_planId, options) => {
        options.onProgress?.({ phase: 'WAITING_FOR_DMS', session: { stage: 'WAITING_FOR_DMS', dmsExpiresAt: '2030-03-04T09:30:00.000Z' } });
        options.onProgress?.({ phase: 'STOPPED_BY_DMS', session: { stage: 'CANCELED', closedReason: 'DMS_RESET' } });
        throw Object.assign(new Error('reveal_authorization_ended:CANCELED'), { code: 'reveal_authorization_ended' });
      }),
    };
    const ui = {
      withProgress: async <TResult>(task: (progress: RevealProgressReporter, token: RevealCancellationToken) => Promise<TResult>): Promise<TResult> => task(
        { report: ({ message }) => { if (message) reports.push(message); } },
        { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: vi.fn() }) },
      ),
      pickField: vi.fn(),
      insertAtCursor,
    };

    const failure = await revealAndInsert(core as never, ui as never, new ActiveRevealRegistry(), 'plan-1')
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RevealStoppedByDeadManSwitch);
    expect(messageFor((failure as RevealStoppedByDeadManSwitch).code))
      .toBe('The dead man\'s switch subject stopped this reveal — nothing was released');
    // The stop is worded by the error boundary; progress deliberately stays quiet about it.
    expect(reports.some((message) => message.includes('dead man'))).toBe(true);
    expect(insertAtCursor).not.toHaveBeenCalled();
  });

  it('keeps the reveal session lifetime, not the gate deadline, on the post-authorization countdown', async () => {
    const { core, ui, reports } = fixture({
      withReveal: vi.fn(async (_planId, options, work) => {
        options.onProgress?.({ phase: 'WAITING_FOR_DMS', session: { stage: 'WAITING_FOR_DMS', dmsExpiresAt: new Date(Date.now() + 60_000).toISOString() } });
        options.onProgress?.({ phase: 'RELEASING_MATERIAL', session: { stage: 'AUTHORIZED' } });
        return work({
          session: { expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() },
          field: vi.fn().mockResolvedValue('protected-value'),
        });
      }),
    });

    await revealAndInsert(core as never, ui as never, new ActiveRevealRegistry(), 'plan-1');

    expect(reports.some((message) => message.includes('Data will be accessible for 10 minutes.'))).toBe(true);
    expect(reports.some((message) => message.includes('Data will be accessible for 1 minutes.'))).toBe(false);
  });
});
