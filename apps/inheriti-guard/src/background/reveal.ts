import { hasRevealFailed, revealGateDeadline, revealModeOf, revealProgressMessage } from '@safetech/inheriti-elements-core/browser';
import type { BrowserIntegrationCore, PlanGovernanceView, RevealProgress, ScopedRevealHandle, ScopedRevealProgress } from '@safetech/inheriti-elements-core/browser';
import type { RevealFieldOption, RevealViewState } from '../shared/messages.js';
import type { AccessBatch, AccessFieldResult, AccessFieldResultCode, FieldMapping } from '../shared/access-contract.js';
import { validateAccessBatch } from '../shared/access-contract.js';
import { fillPageField, fillPageTarget, preflightPageTarget } from './page-fill.js';
import { revalidatePageTarget, writePageTarget } from './page-target.js';

const RECOVERY_KEY = 'inheritiElements.openReveal';
/**
 * How long a reveal stays resumable before its record is treated as abandoned.
 *
 * The server's own session lifetime replaces this the moment there is one; it only covers the window
 * between "the operator asked" and "the reveal exists", which is exactly where a relayed master key
 * makes a person go and answer a phone.
 */
const RECOVERY_WINDOW_MS = 10 * 60_000;
const DEADLINE_ALARM = 'inheritiElements.revealDeadline';
const ALLOWED_FIELDS = new Set(['username', 'email', 'password']);

/** The shared progress shape, narrowed to the identity and lifetime this host always receives. */
type RevealSessionView = ScopedRevealProgress & { readonly id: string; readonly expiresAt: string };

/**
 * What a restarted worker needs to take an open reveal back up.
 *
 * A governed reveal outlives the worker that started it — the access is the merge process, and the
 * server hands the same one back to the next `start` — so the intent that opened it is worth as much
 * as its id. Plaintext is never part of this: it was memory-only and is gone.
 */
interface RevealRecovery {
  readonly planId: string;
  readonly deadline: string;
  readonly revealId?: string;
  readonly message?: string;
  readonly intent:
    | { readonly kind: 'FIELD'; readonly selector: string; readonly origin: string; readonly tabId: number }
    | { readonly kind: 'BATCH'; readonly batch: AccessBatch };
}

interface ChromeRevealCore extends BrowserIntegrationCore {
  withReveal<TResult>(
    planId: string,
    options: {
      mode?: 'DIRECT' | 'GOVERNED';
      signal?: AbortSignal;
      onProgress?: (progress: RevealProgress) => void;
      onSession?: (session: RevealSessionView) => void;
    },
    // The handle the SDK actually passes. It was narrowed here to the two members this host uses,
    // which never type-checked: a callback that accepts less than what is passed is unsound in a
    // parameter position, so the narrowing made `ChromeRevealCore` stop extending the core it
    // describes. What this host may *do* with a reveal is bounded by the capabilities its
    // registration carries, not by hiding methods from a type.
    work: (reveal: ScopedRevealHandle) => Promise<TResult>,
  ): Promise<TResult>;
}

interface PlanForReveal extends PlanGovernanceView {
  readonly assets: readonly {
    readonly id: string;
    readonly code?: string;
    readonly name: string;
    readonly type?: string;
    readonly isBinary: boolean;
    readonly fieldNames: readonly string[];
    readonly matchOrigins?: readonly string[];
  }[];
}

export class ChromeRevealController {
  private active: AbortController | undefined;
  private state: RevealViewState = { kind: 'IDLE' };
  private intent: RevealRecovery | undefined;
  private shutdownGeneration = 0;

  public constructor(
    private readonly getCore: () => Promise<BrowserIntegrationCore>,
    private readonly storage: chrome.storage.StorageArea,
  ) {}

  public current(): RevealViewState { return this.state; }

  private ownsOperation(generation: number, abort: AbortController): boolean {
    return generation === this.shutdownGeneration && this.active === abort && !abort.signal.aborted;
  }

  public async fields(planId: string, origin: string): Promise<RevealViewState> {
    return this.fieldsOf(await this.planFor(planId), planId, origin);
  }

  private async planFor(planId: string): Promise<PlanForReveal> {
    return await (await this.getCore()).getPlan(planId) as unknown as PlanForReveal;
  }

  /** The plan is read once and both the field list and the reveal's mode come out of it. */
  private fieldsOf(plan: PlanForReveal, planId: string, origin: string): RevealViewState {
    const fields = plan.assets.flatMap((asset) => asset.isBinary ? [] : asset.fieldNames
      .filter((fieldName) => ALLOWED_FIELDS.has(fieldName))
      .map((fieldName): RevealFieldOption => ({
        selector: `${asset.code ?? asset.id}.${fieldName}`,
        label: `${asset.name} — ${fieldName}`,
        fieldName,
        matchesOrigin: asset.matchOrigins?.includes(origin) ?? false,
      })))
      .sort((left, right) => Number(right.matchesOrigin) - Number(left.matchesOrigin) || left.label.localeCompare(right.label));
    this.state = { kind: 'READY', planId, fields };
    return this.state;
  }

  public async fill(input: {
    planId: string;
    selector: string;
    origin: string;
    tabId: number;
  }): Promise<RevealViewState> {
    if (this.active !== undefined) return { kind: 'ERROR', message: 'A reveal is already in progress.' };
    const generation = this.shutdownGeneration;
    const plan = await this.planFor(input.planId);
    if (generation !== this.shutdownGeneration) return { kind: 'ERROR', message: 'Reveal canceled.' };
    const options = this.fieldsOf(plan, input.planId, input.origin);
    const selected = options.kind === 'READY' ? options.fields.find((field) => field.selector === input.selector) : undefined;
    if (selected === undefined) return { kind: 'ERROR', message: 'That field is no longer available.' };

    const abort = new AbortController();
    this.active = abort;
    this.state = { kind: 'RUNNING', message: 'Opening the plan.' };
    this.intent = {
      planId: input.planId,
      deadline: new Date(Date.now() + RECOVERY_WINDOW_MS).toISOString(),
      intent: { kind: 'FIELD', selector: input.selector, origin: input.origin, tabId: input.tabId },
    };
    await this.remember({});
    if (!this.ownsOperation(generation, abort)) {
      if (this.active === abort && generation === this.shutdownGeneration) {
        await this.forget();
        if (this.active === abort) this.active = undefined;
      }
      return { kind: 'ERROR', message: 'Reveal canceled.' };
    }
    let lastProgress: RevealProgress | undefined;
    try {
      const core = await this.getCore() as ChromeRevealCore;
      if (!this.ownsOperation(generation, abort)) throw stableError('access-request-failed');
      await core.withReveal(input.planId, {
        mode: revealModeOf(plan),
        signal: abort.signal,
        onSession: (session) => { if (this.ownsOperation(generation, abort)) void this.remember(session); },
        onProgress: (progress) => {
          if (!this.ownsOperation(generation, abort)) return;
          lastProgress = progress;
          this.state = progressFor(progress);
          // The panel is rebuilt from this record after an eviction, so the phase a person is waiting
          // on has to be in it, not only in this worker's memory.
          void this.remember({});
        },
      }, async (reveal) => {
        if (!this.ownsOperation(generation, abort)) throw stableError('access-request-failed');
        await this.remember({ id: reveal.session.id, expiresAt: reveal.session.expiresAt });
        const value = await reveal.field<unknown>(input.selector, { action: 'AUTOFILL_FIELD', origin: input.origin });
        if (!this.ownsOperation(generation, abort)) throw stableError('access-request-failed');
        if (typeof value !== 'string') throw new Error('asset_value_invalid');
        const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!this.ownsOperation(generation, abort)) throw stableError('access-request-failed');
        if (active?.id !== input.tabId || originOf(active.url) !== input.origin) {
          throw Object.assign(new Error('stale_tab_context'), { code: 'stale_tab_context' });
        }
        if (!this.ownsOperation(generation, abort)) throw stableError('access-request-failed');
        await chrome.scripting.executeScript({
          target: { tabId: input.tabId },
          func: fillPageField,
          args: [selected.fieldName, value],
        });
      });
      if (this.ownsOperation(generation, abort)) this.state = { kind: 'DONE', message: 'Field filled. Reveal closed.' };
    } catch (error) {
      if (this.active === abort && generation === this.shutdownGeneration) {
        this.state = { kind: 'ERROR', message: messageFor(error, abort.signal.aborted, lastProgress) };
      }
    } finally {
      if (this.active === abort && generation === this.shutdownGeneration) {
        await this.forget();
        if (this.active === abort) this.active = undefined;
      }
    }
    return generation === this.shutdownGeneration ? this.state : { kind: 'ERROR', message: 'Reveal canceled.' };
  }

  public async fillBatch(batch: AccessBatch): Promise<readonly AccessFieldResult[]> {
    if (this.active !== undefined) throw stableError('access-request-failed');
    if (!validateAccessBatch(batch).valid) throw stableError('invalid-access-batch');
    const generation = this.shutdownGeneration;
    const plan = await this.planFor(batch.identity.planId);
    if (generation !== this.shutdownGeneration) return resultsFor(batch, 'canceled');
    if (!batch.mappings.every((mapping) => protectedFieldExists(plan, mapping))) {
      return resultsFor(batch, 'field-unavailable');
    }
    for (const mapping of batch.mappings) {
      let current = false;
      try { current = await preflightPageTarget(mapping.pageTarget, revalidatePageTarget); } catch { /* stale frame */ }
      if (generation !== this.shutdownGeneration) return resultsFor(batch, 'canceled');
      if (!current) {
        return resultsFor(batch, 'stale-page-context');
      }
    }

    const abort = new AbortController();
    this.active = abort;
    this.state = { kind: 'RUNNING', message: 'Opening the plan.' };
    this.intent = {
      planId: batch.identity.planId,
      deadline: new Date(Date.now() + RECOVERY_WINDOW_MS).toISOString(),
      intent: { kind: 'BATCH', batch },
    };
    await this.remember({});
    if (!this.ownsOperation(generation, abort)) {
      if (this.active === abort && generation === this.shutdownGeneration) {
        await this.forget();
        if (this.active === abort) this.active = undefined;
      }
      return resultsFor(batch, 'canceled');
    }
    const outcomes = new Map<string, AccessFieldResultCode>();
    let lastProgress: RevealProgress | undefined;
    try {
      const core = await this.getCore() as ChromeRevealCore;
      if (!this.ownsOperation(generation, abort)) throw stableError('access-request-failed');
      await core.withReveal(batch.identity.planId, {
        mode: revealModeOf(plan), signal: abort.signal,
        onSession: (session) => { if (this.ownsOperation(generation, abort)) void this.remember(session); },
        onProgress: (progress) => {
          if (!this.ownsOperation(generation, abort)) return;
          lastProgress = progress;
          this.state = progressFor(progress);
          void this.remember({});
        },
      }, async (reveal) => {
        if (!this.ownsOperation(generation, abort)) throw stableError('access-request-failed');
        await this.remember({ id: reveal.session.id, expiresAt: reveal.session.expiresAt });
        await reveal.consumeFields(batch.mappings.map((mapping) => ({
          selector: mapping.protectedField.selector,
          options: { action: 'AUTOFILL_FIELD' as const, origin: batch.identity.origin },
        })), async (fields) => {
          const valuesBySelector = new Map(fields.map((field) => [field.selector, field.value]));
          let contextStale = false;
          for (const mapping of batch.mappings) {
            if (!this.ownsOperation(generation, abort)) {
              outcomes.set(mapping.protectedField.selector, 'canceled');
              continue;
            }
            if (contextStale) {
              outcomes.set(mapping.protectedField.selector, 'stale-page-context');
              continue;
            }
            const value = valuesBySelector.get(mapping.protectedField.selector);
            if (typeof value !== 'string') {
              outcomes.set(mapping.protectedField.selector, 'invalid-value');
              continue;
            }
            try {
              if (!this.ownsOperation(generation, abort)) {
                outcomes.set(mapping.protectedField.selector, 'canceled');
                continue;
              }
              const result = await fillPageTarget(mapping.pageTarget, value, writePageTarget);
              outcomes.set(mapping.protectedField.selector, result);
              contextStale = result === 'stale-page-context';
            } catch {
              outcomes.set(mapping.protectedField.selector, 'destination-failed');
            }
          }
          // The installed SDK's destination contract reports the batch as one unit. Reject it when
          // any write failed so it never records an unsuccessful delivery as successful; Chrome
          // retains the more precise per-field codes for the operator.
          if ([...outcomes.values()].some((code) => code !== 'filled')) {
            throw stableError('access-request-failed');
          }
        });
      });
      if (this.ownsOperation(generation, abort)) this.state = { kind: 'DONE', message: 'Autofill finished. Reveal closed.' };
    } catch (error) {
      const code = batchErrorCode(error, abort.signal.aborted);
      for (const mapping of batch.mappings) {
        if (!outcomes.has(mapping.protectedField.selector)) outcomes.set(mapping.protectedField.selector, code);
      }
      if (this.active === abort && generation === this.shutdownGeneration) {
        this.state = { kind: 'ERROR', message: messageFor(error, abort.signal.aborted, lastProgress) };
      }
    } finally {
      if (this.active === abort && generation === this.shutdownGeneration) {
        await this.forget();
        if (this.active === abort) this.active = undefined;
      }
    }
    return batch.mappings.map((mapping) => resultFor(mapping, outcomes.get(mapping.protectedField.selector) ?? 'not-attempted'));
  }

  /**
   * Gives up the governed access this operator holds on a plan.
   *
   * A governed access outlives the reveal that opened it, and the next reveal takes it up where it
   * stopped. This is the other choice: the access is not wanted, and the next one starts clean.
   */
  public async abortPlanAccess(planId: string): Promise<RevealViewState> {
    const { aborted } = await (await this.getCore()).abortPlanAccess(planId);
    this.state = {
      kind: 'DONE',
      message: aborted
        ? 'Access aborted. The next reveal of this plan will start a new request.'
        : 'No access is open on this plan.',
    };
    return this.state;
  }

  public cancel(): RevealViewState {
    this.active?.abort();
    this.state = { kind: 'RUNNING', message: 'Canceling reveal…' };
    return this.state;
  }

  /** Stops active and persisted reveal work before a coordinated Secure Logoff clears custody. */
  public async shutdown(): Promise<void> {
    this.shutdownGeneration += 1;
    this.active?.abort();
    await this.closeAbandoned();
    this.active = undefined;
    this.state = { kind: 'IDLE' };
  }

  public async closeAbandoned(): Promise<void> {
    const stored = await this.storage.get(RECOVERY_KEY);
    const recovery = stored[RECOVERY_KEY] as { revealId?: unknown } | undefined;
    if (typeof recovery?.revealId === 'string') await this.closeReveal(recovery.revealId);
    await this.forget();
  }

  /**
   * What a worker that vanished mid-reveal comes back to.
   *
   * Closing it was wrong: the reveal a person is answering on their phone right now — the custodian
   * claim, the moderator approval, the key release — is still open on the server, and cancelling it
   * throws away approvals already given and leaves the phone holding a request nobody will collect.
   * Only a reveal past its deadline is closed here. A live one becomes something the panel can offer
   * to take up again, and the server hands the same governed access back to the next `start`.
   */
  public async recoverAbandoned(): Promise<void> {
    const recovery = await this.recovery();
    if (recovery === undefined) return;
    if (Date.parse(recovery.deadline) <= Date.now()) { await this.closeAbandoned(); return; }
    this.intent = recovery;
    this.state = {
      kind: 'RESUMABLE',
      planId: recovery.planId,
      message: recovery.message ?? 'A reveal is still open on this plan. Resume it to continue where it stopped.',
    };
  }

  /**
   * Takes the open reveal back up with the intent that started it.
   *
   * A governed plan resumes its own access, so no gate that was already cleared is asked for twice —
   * a custodian share claimed while this worker was gone is simply found claimed. A direct reveal has
   * nothing to resume, so the abandoned session is closed before a new one starts rather than left to
   * expire on its own.
   */
  public async resume(): Promise<RevealViewState> {
    const generation = this.shutdownGeneration;
    const recovery = await this.recovery();
    if (generation !== this.shutdownGeneration) return { kind: 'ERROR', message: 'Reveal canceled.' };
    if (recovery === undefined) { this.state = { kind: 'IDLE' }; return this.state; }
    if (Date.parse(recovery.deadline) <= Date.now()) {
      await this.closeAbandoned();
      this.state = { kind: 'ERROR', message: 'That reveal expired before it could be resumed. Start a new one.' };
      return this.state;
    }
    const plan = await this.planFor(recovery.planId);
    if (generation !== this.shutdownGeneration) return { kind: 'ERROR', message: 'Reveal canceled.' };
    if (revealModeOf(plan) !== 'GOVERNED' && recovery.revealId !== undefined) await this.closeReveal(recovery.revealId);
    if (generation !== this.shutdownGeneration) return { kind: 'ERROR', message: 'Reveal canceled.' };
    if (recovery.intent.kind === 'BATCH') {
      await this.fillBatch(recovery.intent.batch);
      return this.state;
    }
    return this.fill({ planId: recovery.planId, ...recovery.intent });
  }

  private async recovery(): Promise<RevealRecovery | undefined> {
    const stored = await this.storage.get(RECOVERY_KEY);
    const recovery = stored[RECOVERY_KEY] as Partial<RevealRecovery> | undefined;
    if (typeof recovery?.planId !== 'string' || typeof recovery.deadline !== 'string') return undefined;
    if (recovery.intent?.kind !== 'FIELD' && recovery.intent?.kind !== 'BATCH') return undefined;
    return recovery as RevealRecovery;
  }

  private async closeReveal(revealId: string): Promise<void> {
    const workflows = (await this.getCore()).reveals as unknown as {
      close(revealId: string, reason: 'CANCELED'): Promise<void>;
    } | undefined;
    try { await workflows?.close(revealId, 'CANCELED'); } catch { /* best effort */ }
  }

  /**
   * Keeps the record in step with the reveal, so a worker that dies at any point can come back to it.
   *
   * The deadline is the session's own once there is a session; until then it is the local window, so
   * a reveal killed while a phone is being asked for the Application key is still resumable.
   */
  private async remember(session: Partial<Pick<RevealSessionView, 'id' | 'expiresAt'>>): Promise<void> {
    if (this.intent === undefined) return;
    this.intent = {
      ...this.intent,
      ...(session.id === undefined ? {} : { revealId: session.id }),
      ...(session.expiresAt === undefined ? {} : { deadline: session.expiresAt }),
      ...(this.state.kind === 'RUNNING' ? { message: this.state.message } : {}),
    };
    await this.storage.set({ [RECOVERY_KEY]: this.intent });
    await chrome.alarms.create(DEADLINE_ALARM, { when: Date.parse(this.intent.deadline) });
  }

  private async forget(): Promise<void> {
    this.intent = undefined;
    await this.storage.remove(RECOVERY_KEY);
    await chrome.alarms.clear(DEADLINE_ALARM);
  }
}

export function isRevealDeadline(name: string): boolean { return name === DEADLINE_ALARM; }

/**
 * The panel's view of a reveal step. The sequence is the Client SDK's and the words are the shared
 * ones; the panel only decides whether a phase is still running or is an error to show as one.
 */
function progressFor(progress: RevealProgress): RevealViewState {
  const message = revealProgressMessage(progress);
  if (hasRevealFailed(progress.phase)) return { kind: 'ERROR', message };
  // STARTING and WAITING_FOR_MASTER_KEY precede creation of a reveal session.
  const session = progress.session as RevealSessionView | undefined;
  const gateExpiresAt = revealGateDeadline(progress);
  return {
    kind: 'RUNNING',
    ...(session?.id === undefined ? {} : { revealId: session.id }),
    ...(session?.expiresAt === undefined ? {} : { expiresAt: session.expiresAt }),
    // The gate's own window travels beside the session's, never instead of it: `expiresAt` still
    // drives the recovery record and the deadline alarm.
    ...(gateExpiresAt === undefined ? {} : { gateExpiresAt }),
    message,
  };
}

function messageFor(error: unknown, canceled: boolean, lastProgress?: RevealProgress): string {
  // The server's own explanation outranks the transport error and the generic fallback below.
  if (lastProgress?.phase === 'STOPPED_BY_DMS') {
    return 'The dead man\'s switch subject stopped this reveal. Nothing was released.';
  }
  if (canceled) return 'Reveal canceled.';
  const code = (error as { code?: unknown })?.code;
  if (code === 'action_origin_denied') return 'This page origin is not approved for autofill.';
  if (code === 'stale_tab_context') return 'The page changed before autofill. Reveal again on the current page.';
  // The Application's key is held by the operator, never by the plan service, so a missing one is a
  // configuration answer rather than a failure to retry.
  if ((error as { name?: unknown })?.name === 'MasterKeyRequired') {
    return 'This Application\'s master key is not available. Add it to the extension and reveal again.';
  }
  return 'Reveal could not continue. Try again.';
}

function originOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

function protectedFieldExists(plan: PlanForReveal, mapping: FieldMapping): boolean {
  const field = mapping.protectedField;
  const asset = plan.assets.find((candidate) => candidate.id === field.assetId);
  return asset !== undefined && !asset.isBinary
    && (asset.code ?? asset.id) === field.assetCode
    && asset.name === field.assetName
    && (asset.type ?? '') === field.assetType
    && asset.fieldNames.includes(field.fieldName)
    && field.selector === `${asset.code ?? asset.id}.${field.fieldName}`;
}

function resultFor(mapping: FieldMapping, code: AccessFieldResultCode): AccessFieldResult {
  return { selector: mapping.protectedField.selector, targetId: mapping.pageTarget.targetId, code };
}

function resultsFor(batch: AccessBatch, code: AccessFieldResultCode): readonly AccessFieldResult[] {
  return batch.mappings.map((mapping) => resultFor(mapping, code));
}

function batchErrorCode(error: unknown, canceled: boolean): AccessFieldResultCode {
  if (canceled) return 'canceled';
  const code = (error as { code?: unknown })?.code;
  if (code === 'action_origin_denied') return 'authorization-denied';
  if (code === 'asset_not_found' || code === 'asset_field_not_found') return 'field-unavailable';
  if (code === 'asset_value_invalid') return 'invalid-value';
  return 'not-attempted';
}

function stableError(code: 'invalid-access-batch' | 'access-request-failed'): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}
