import { revealGateCountdown, revealGateDeadline, revealModeOf, revealProgressMessage } from '@safetech/inheriti-elements-core';
import type { PlanGovernanceView, RevealProgress, ScopedRevealProgress } from '@safetech/inheriti-elements-core';

/** The one shared progress shape; kept under the host's own name for its existing callers. */
export type RevealSessionProgress = ScopedRevealProgress;

export interface VscodeRevealCore {
  getPlan(planId: string): Promise<PlanGovernanceView & {
    assets: ReadonlyArray<{ id: string; code?: string; name?: string; fieldNames?: readonly string[]; isBinary?: boolean }>;
    participants?: ReadonlyArray<{
      displayName: string;
      lifecycle: string | { kind: 'UNKNOWN'; raw: string };
      relationships: ReadonlyArray<string | { kind: 'UNKNOWN'; raw: string }>;
    }>;
  }>;
  withReveal<TResult>(
    planId: string,
    options: {
      mode?: 'DIRECT' | 'GOVERNED';
      signal?: AbortSignal;
      onProgress?: (progress: RevealProgress) => void;
      onSession?: (session: RevealSessionProgress) => void;
    },
    work: (reveal: {
      session: { expiresAt: string };
      field<TValue = unknown>(selector: string, options: { action: 'INSERT_FIELD' }): Promise<TValue>;
    }) => Promise<TResult>,
  ): Promise<TResult>;
}

export interface RevealProgressReporter { report(value: { message?: string }): void }
export interface RevealCancellationToken {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

export interface VscodeRevealUi {
  withProgress<TResult>(task: (progress: RevealProgressReporter, token: RevealCancellationToken) => Promise<TResult>): Promise<TResult>;
  pickField(items: readonly { label: string; description: string; selector: string }[]): Promise<string | undefined>;
  insertAtCursor(value: string): Promise<boolean>;
}

/** The reveal ended because the dead-man's-switch subject answered, not because anything failed. */
export class RevealStoppedByDeadManSwitch extends Error {
  public readonly code = 'reveal_stopped_by_dms';
  public constructor(options?: { cause?: unknown }) {
    super('reveal_stopped_by_dms', options);
    this.name = 'RevealStoppedByDeadManSwitch';
  }
}

export class RevealInsertUnavailable extends Error {
  public readonly code = 'reveal_insert_unavailable';
  public constructor() { super('reveal_insert_unavailable'); this.name = 'RevealInsertUnavailable'; }
}

export class ActiveRevealRegistry {
  private readonly controllers = new Set<AbortController>();

  public create(): AbortController {
    const controller = new AbortController();
    this.controllers.add(controller);
    return controller;
  }

  public release(controller: AbortController): void { this.controllers.delete(controller); }

  public dispose(): void {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }
}

export async function revealAndInsert(
  core: VscodeRevealCore,
  ui: VscodeRevealUi,
  activeReveals: ActiveRevealRegistry,
  planId: string,
): Promise<void> {
  const plan = await core.getPlan(planId);
  const fields = plan.assets.flatMap((asset) => asset.isBinary ? [] : (asset.fieldNames ?? []).map((field) => ({
    label: `${asset.code ?? asset.id}.${field}`,
    description: asset.name ?? asset.code ?? asset.id,
    selector: `${asset.code ?? asset.id}.${field}`,
  })));
  if (fields.length === 0) throw new RevealInsertUnavailable();

  // Named so "waiting for moderators" becomes a list of people to go and ask.
  const moderators = (plan.participants ?? [])
    .filter((participant) => participant.lifecycle === 'ACTIVE' && participant.relationships.includes('MODERATOR'))
    .map((participant) => participant.displayName);
  const controller = activeReveals.create();
  try {
    await ui.withProgress(async (progress, token) => {
      const cancellation = token.onCancellationRequested(() => controller.abort());
      if (token.isCancellationRequested) controller.abort();
      progress.report({ message: 'Opening the plan.' });
      let lastProgress: RevealProgress | undefined;
      const governanceProgress = new GovernanceProgressPresenter(progress, moderators);
      try {
        await core.withReveal(planId, {
          mode: revealModeOf(plan),
          signal: controller.signal,
          onProgress: (reported) => {
            lastProgress = reported;
            governanceProgress.update(reported);
          },
        }, async (reveal) => {
          governanceProgress.close();
          const countdown = startCountdown(reveal.session.expiresAt, progress);
          try {
            const selector = await ui.pickField(fields);
            if (!selector) { controller.abort(); throw canceled(); }
            const value = await reveal.field<unknown>(selector, { action: 'INSERT_FIELD' });
            if (controller.signal.aborted) throw canceled();
            const inserted = await ui.insertAtCursor(renderValue(value));
            if (!inserted) throw new RevealInsertUnavailable();
          } finally {
            clearInterval(countdown);
          }
        });
      } catch (error) {
        // The server already said why this ended. Without this the generic error boundary would
        // relabel a healthy dead-man's-switch stop as an authorization failure.
        if (lastProgress?.phase === 'STOPPED_BY_DMS') throw new RevealStoppedByDeadManSwitch({ cause: error });
        throw error;
      } finally {
        governanceProgress.close();
        cancellation.dispose();
      }
    });
  } finally {
    activeReveals.release(controller);
  }
}

/**
 * The editor's line for a reveal step. The sequence is the Client SDK's; only the words are here,
 * and they are the shared ones so the editor, the CLI and the browser panel agree.
 */
export function progressMessage(progress: RevealProgress, moderators: readonly string[] = []): string {
  return revealProgressMessage(progress, { moderators });
}

/** Repaints a gate's server deadline without taking ownership of expiration. */
export class GovernanceProgressPresenter {
  private timer: ReturnType<typeof setInterval> | undefined;
  private current: RevealProgress | undefined;

  public constructor(
    private readonly reporter: RevealProgressReporter,
    private readonly moderators: readonly string[] = [],
  ) {}

  public update(progress: RevealProgress): void {
    this.close();
    this.current = progress;
    this.report();
    if (revealGateDeadline(progress)) this.timer = setInterval(() => this.report(), 1_000);
  }

  public close(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private report(): void {
    if (!this.current) return;
    const countdown = revealGateCountdown(this.current);
    const suffix = countdown === undefined ? '' : ` Time remaining ${countdown}.`;
    this.reporter.report({ message: `${progressMessage(this.current, this.moderators)}${suffix}` });
  }
}

function startCountdown(expiresAt: string, progress: RevealProgressReporter): ReturnType<typeof setInterval> {
  const report = (): void => {
    const remaining = Math.max(0, new Date(expiresAt).getTime() - Date.now());
    progress.report({ message: `Data will be accessible for ${Math.max(1, Math.ceil(remaining / 60_000))} minutes.` });
  };
  report();
  return setInterval(report, 1_000);
}

function renderValue(value: unknown): string {
  if (typeof value === 'string') return value;
  const encoded = JSON.stringify(value);
  return encoded === undefined ? String(value) : encoded;
}

function canceled(): Error {
  const error = new Error('reveal_canceled');
  error.name = 'AbortError';
  return error;
}
