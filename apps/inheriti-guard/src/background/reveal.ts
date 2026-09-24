import { hasRevealFailed, revealGateDeadline, revealModeOf, revealProgressMessage } from '@safetech/inheriti-elements-core/browser';
import type { BrowserIntegrationCore, PlanGovernanceView, RevealProgress, ScopedRevealHandle, ScopedRevealOptions, ScopedRevealProgress } from '@safetech/inheriti-elements-core/browser';
import type { RevealFieldOption, RevealViewState } from '../shared/messages.js';
import type { AccessBatch, AccessFieldResult, AccessFieldResultCode, FieldMapping } from '../shared/access-contract.js';
import { validateAccessBatch } from '../shared/access-contract.js';
import { fillPageField, fillPageTarget, preflightPageTarget } from './page-fill.js';
import { revalidatePageTarget, writePageTarget } from './page-target.js';

const RECOVERY_KEY = 'inheriti.openReveal';
const RELAY_KEY = 'inheritiGuard.pendingKeyRelay';
type RelayOwner = { issuer: string; subject: string; organizationId: string };
type RelayRecovery = RelayOwner & { planId: string; sessionId: string; expiresAt: string };
/**
 * How long a reveal stays resumable before its record is treated as abandoned.
 *
 * The server's own session lifetime replaces this the moment there is one; it only covers the window
 * between "the operator asked" and "the reveal exists", which is exactly where a relayed master key
 * makes a person go and answer a phone.
 */
const RECOVERY_WINDOW_MS = 10 * 60_000;
const DEADLINE_ALARM = 'inheriti.revealDeadline';
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
      onRelaySession?: ScopedRevealOptions['onRelaySession'];
      selectCustodianDevice?: ScopedRevealOptions['selectCustodianDevice'];
      proDevice?: ScopedRevealOptions['proDevice'];
    },
    // The handle the SDK actually passes. It was narrowed here to the two members this host uses,
    // which never type-checked: a callback that accepts less than what is passed is unsound in a
    // parameter position, so the narrowing made `ChromeRevealCore` stop extending the core it
    // describes. What this host may *do* with a reveal is bounded by the capabilities its
    // registration carries, not by hiding methods from a type.
    work: (reveal: ScopedRevealHandle) => Promise<TResult>,
  ): Promise<TResult>;
}

type ProOptions = Pick<ScopedRevealOptions, 'selectCustodianDevice' | 'proDevice'> & { finish(): void };

interface PlanForReveal extends PlanGovernanceView {
  readonly participants?: readonly { readonly id: string; readonly displayName: string; readonly relationships: readonly string[]; readonly lifecycle: string }[];
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
  private activeBatchWindowId: number | undefined;
  private state: RevealViewState = { kind: 'IDLE' };
  private intent: RevealRecovery | undefined;
  private shutdownGeneration = 0;
  private statusUnavailable = false;
  private cancellationInProgress = false;
  private proFinish: { owner: AbortController; finish(): void } | undefined;
  private relayWrite: Promise<void> = Promise.resolve();

  public constructor(
    private readonly getCore: () => Promise<BrowserIntegrationCore>,
    private readonly storage: chrome.storage.StorageArea,
    private readonly keyOwner: () => 'Application' | 'Organisation' = () => 'Application',
    private readonly proOptions?: (signal: AbortSignal, batch?: AccessBatch) => Promise<ProOptions | undefined>,
    private readonly relayRecovery?: { storage: chrome.storage.StorageArea; owner(): Promise<RelayOwner | undefined> },
    private readonly overlayOriginAuthorized: (origin: string) => Promise<boolean> = async () => true,
  ) {}

  private async ownedRelay(): Promise<RelayRecovery | undefined> {
    if (!this.relayRecovery) return undefined;
    const stored = (await this.relayRecovery.storage.get(RELAY_KEY))[RELAY_KEY] as RelayRecovery | undefined;
    if (!stored || typeof stored.sessionId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stored.sessionId)
      || typeof stored.expiresAt !== 'string') return undefined;
    if (Date.parse(stored.expiresAt) <= Date.now()) {
      await this.relayRecovery.storage.remove(RELAY_KEY);
      return undefined;
    }
    const owner = await this.relayRecovery.owner();
    return owner?.issuer === stored.issuer && owner.subject === stored.subject
      && owner.organizationId === stored.organizationId ? stored : undefined;
  }

  private async relay(planId: string): Promise<RelayRecovery | undefined> {
    const relay = await this.ownedRelay();
    return relay?.planId === planId ? relay : undefined;
  }

  private async rememberRelay(planId: string, session: { sessionId: string; expiresAt: string | Date },
    isCurrent: () => boolean): Promise<void> {
    if (!this.relayRecovery) return;
    const write = this.relayWrite.then(async () => {
      if (!isCurrent()) throw stableError('access-request-failed');
      const owner = await this.relayRecovery!.owner();
      if (!owner || !isCurrent()) throw stableError('access-request-failed');
      await this.relayRecovery!.storage.set({ [RELAY_KEY]: {
        ...owner, planId, sessionId: session.sessionId, expiresAt: new Date(session.expiresAt).toISOString(),
      } satisfies RelayRecovery });
    });
    this.relayWrite = write.then(() => undefined, () => undefined);
    await write;
  }

  private async cancelRelay(planId: string): Promise<void> {
    await this.relayWrite;
    const relay = await this.relay(planId);
    if (!relay) return;
    await (await this.getCore()).cancelMasterKeyRelaySession(relay.sessionId);
    await this.clearRelay(planId, relay.sessionId);
  }

  private async cancelOwnedRelay(): Promise<void> {
    const relay = await this.ownedRelay();
    if (relay) await this.cancelRelay(relay.planId);
  }

  private async clearRelay(planId: string, sessionId?: string): Promise<void> {
    if (!sessionId) return;
    await this.relayWrite;
    const relay = await this.relay(planId);
    if (relay?.sessionId === sessionId) await this.relayRecovery!.storage.remove(RELAY_KEY);
  }

  public current(): RevealViewState { return this.state; }

  public async reconcile(planId: string): Promise<RevealViewState> {
    const recovery = await this.recovery();
    if (recovery?.planId === planId && Date.parse(recovery.deadline) <= Date.now()) await this.closeAbandoned();
    let activeRevealId: string | undefined;
    try { activeRevealId = (await (await this.getCore()).getActivePlanReveal(planId))?.id; }
    catch {
      this.statusUnavailable = true;
      this.state = { kind: 'RESUMABLE', planId,
        message: 'Could not check whether an access request is open. Check again before canceling it.' };
      return this.state;
    }
    this.statusUnavailable = false;
    if (activeRevealId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(activeRevealId)) {
      this.state = { kind: 'WARNING', code: 'active_access_open', planId, revealId: activeRevealId,
        message: 'This plan has an open access request. You can cancel it and start again.',
        detail: 'The previous reveal was interrupted. No fields were filled.' };
    } else if (this.active && this.intent?.planId === planId && this.state.kind === 'RUNNING') {
      return this.state;
    } else if ((recovery?.planId === planId && Date.parse(recovery.deadline) > Date.now()) || await this.relay(planId)) {
      this.state = { kind: 'RESUMABLE', planId,
        message: 'The previous attempt was interrupted while opening this plan. You can try again or cancel the pending request.' };
    } else if (this.state.kind === 'WARNING' && this.state.planId === planId) {
      this.state = { kind: 'DONE', message: 'No access remains open on this plan.' };
    }
    if (this.state.kind === 'RUNNING' && this.intent?.planId !== planId) return { kind: 'IDLE' };
    return this.state;
  }

  public async cancelPending(planId: string): Promise<RevealViewState> {
    if (this.cancellationInProgress) return this.state;
    if (this.active && this.intent?.planId !== planId) return this.state;
    this.cancellationInProgress = true;
    try {
      const status = await this.reconcile(planId);
      if (this.statusUnavailable) return status;
      if (status.kind === 'WARNING') return this.abortCurrentPlanAccess(planId);
      if (this.intent?.planId !== planId && (await this.recovery())?.planId !== planId && !await this.relay(planId)) return status;
      if (status.kind !== 'RESUMABLE' && !(status.kind === 'RUNNING' && this.intent?.planId === planId)) return status;
      const active = this.active;
      this.shutdownGeneration += 1;
      active?.abort();
      if (active) this.finishPro(active);
      try {
        await this.cancelRelay(planId);
        await this.forget();
      } finally {
        if (this.active === active) this.active = undefined;
      }
      this.state = { kind: 'DONE', message: 'Pending request canceled. You can start again.' };
      return this.state;
    } finally { this.cancellationInProgress = false; }
  }

  private ownsOperation(generation: number, abort: AbortController): boolean {
    return generation === this.shutdownGeneration && this.active === abort && !abort.signal.aborted;
  }

  private finishPro(owner: AbortController): void {
    if (this.proFinish?.owner !== owner) return;
    this.proFinish.finish();
    this.proFinish = undefined;
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
    if (this.active !== undefined || this.cancellationInProgress) return { kind: 'ERROR', message: 'A reveal is already in progress.' };
    const generation = this.shutdownGeneration;
    const plan = await this.planFor(input.planId);
    const moderators = moderatorsOf(plan);
    if (generation !== this.shutdownGeneration || this.cancellationInProgress) return { kind: 'ERROR', message: 'Reveal canceled.' };
    const options = this.fieldsOf(plan, input.planId, input.origin);
    const selected = options.kind === 'READY' ? options.fields.find((field) => field.selector === input.selector) : undefined;
    if (selected === undefined) return { kind: 'ERROR', message: 'That field is no longer available.' };

    if (this.cancellationInProgress) return { kind: 'ERROR', message: 'Reveal canceled.' };
    const pendingRelay = await this.ownedRelay();
    if (pendingRelay?.planId === input.planId) return { kind: 'RESUMABLE', planId: input.planId,
      message: 'An Organisation key request is still open. Cancel it before trying again.' };
    if (pendingRelay) await this.cancelOwnedRelay();
    if (generation !== this.shutdownGeneration || this.cancellationInProgress) return { kind: 'ERROR', message: 'Reveal canceled.' };
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
    let pro: ProOptions | undefined;
    let relaySessionId: string | undefined;
    try {
      const core = await this.getCore() as ChromeRevealCore;
      if (!this.ownsOperation(generation, abort)) throw stableError('access-request-failed');
      pro = await this.proOptions?.(abort.signal);
      if (!this.ownsOperation(generation, abort)) throw stableError('access-request-failed');
      if (pro) this.proFinish = { owner: abort, finish: pro.finish };
      await core.withReveal(input.planId, {
        mode: revealModeOf(plan),
        signal: abort.signal,
        ...(pro ? { selectCustodianDevice: pro.selectCustodianDevice, proDevice: pro.proDevice } : {}),
        onSession: (session) => { if (this.ownsOperation(generation, abort)) {
          void this.remember(session); void this.clearRelay(input.planId, relaySessionId).catch(() => undefined);
        } },
        onRelaySession: async (session: { sessionId: string; expiresAt: string | Date }) => {
          await this.rememberRelay(input.planId, session, () => this.ownsOperation(generation, abort));
          relaySessionId = session.sessionId;
        },
        onProgress: (progress) => {
          if (!this.ownsOperation(generation, abort)) return;
          lastProgress = progress;
          this.state = progressFor(progress, this.keyOwner(), moderators);
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
        const targetTab = await chrome.tabs.get(input.tabId);
        const [active] = await chrome.tabs.query({ active: true, windowId: targetTab.windowId });
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
        this.state = { kind: 'ERROR', message: messageFor(error, abort.signal.aborted, lastProgress, this.keyOwner(), moderators) };
      }
    } finally {
      this.finishPro(abort);
      if (this.active === abort && generation === this.shutdownGeneration) {
        await this.forget();
        if (this.active === abort) this.active = undefined;
      }
    }
    return generation === this.shutdownGeneration ? this.state : { kind: 'ERROR', message: 'Reveal canceled.' };
  }

  public async fillBatch(batch: AccessBatch, initiator: 'PANEL' | 'OVERLAY' = 'PANEL'): Promise<readonly AccessFieldResult[]> {
    if (this.active !== undefined || this.cancellationInProgress) throw stableError('access-request-failed');
    if (!validateAccessBatch(batch).valid) throw stableError('invalid-access-batch');
    const generation = this.shutdownGeneration;
    const plan = await this.planFor(batch.identity.planId);
    const moderators = moderatorsOf(plan);
    if (generation !== this.shutdownGeneration || this.cancellationInProgress) return resultsFor(batch, 'canceled');
    if (!batch.mappings.every((mapping) => protectedFieldExists(plan, mapping))) {
      return resultsFor(batch, 'field-unavailable');
    }
    for (const mapping of batch.mappings) {
      let current = false;
      try { current = await preflightPageTarget(mapping.pageTarget, revalidatePageTarget); } catch { /* stale frame */ }
      if (generation !== this.shutdownGeneration || this.cancellationInProgress) return resultsFor(batch, 'canceled');
      if (!current) {
        return resultsFor(batch, 'stale-page-context');
      }
    }

    if (this.cancellationInProgress) return resultsFor(batch, 'canceled');
    const pendingRelay = await this.ownedRelay();
    if (pendingRelay?.planId === batch.identity.planId) {
      this.state = { kind: 'RESUMABLE', planId: batch.identity.planId,
        message: 'An Organisation key request is still open. Cancel it before trying again.' };
      return resultsFor(batch, 'canceled');
    }
    if (pendingRelay) await this.cancelOwnedRelay();
    if (generation !== this.shutdownGeneration || this.cancellationInProgress) return resultsFor(batch, 'canceled');
    let targetWindowId: number | undefined;
    try { targetWindowId = (await chrome.tabs.get(batch.identity.tabId)).windowId; }
    catch { return resultsFor(batch, 'stale-page-context'); }
    if (targetWindowId === undefined) return resultsFor(batch, 'stale-page-context');
    if (generation !== this.shutdownGeneration || this.cancellationInProgress) return resultsFor(batch, 'canceled');
    const abort = new AbortController();
    this.active = abort;
    this.activeBatchWindowId = targetWindowId;
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
    let pro: ProOptions | undefined;
    let relaySessionId: string | undefined;
    try {
      const core = await this.getCore() as ChromeRevealCore;
      if (!this.ownsOperation(generation, abort)) throw stableError('access-request-failed');
      pro = await this.proOptions?.(abort.signal, initiator === 'OVERLAY' ? batch : undefined);
      if (!this.ownsOperation(generation, abort)) throw stableError('access-request-failed');
      if (pro) this.proFinish = { owner: abort, finish: pro.finish };
      await core.withReveal(batch.identity.planId, {
        mode: revealModeOf(plan), signal: abort.signal,
        ...(pro ? { selectCustodianDevice: pro.selectCustodianDevice, proDevice: pro.proDevice } : {}),
        onSession: (session) => { if (this.ownsOperation(generation, abort)) {
          void this.remember(session); void this.clearRelay(batch.identity.planId, relaySessionId).catch(() => undefined);
        } },
        onRelaySession: async (session: { sessionId: string; expiresAt: string | Date }) => {
          await this.rememberRelay(batch.identity.planId, session, () => this.ownsOperation(generation, abort));
          relaySessionId = session.sessionId;
        },
        onProgress: (progress) => {
          if (!this.ownsOperation(generation, abort)) return;
          lastProgress = progress;
          this.state = progressFor(progress, this.keyOwner(), moderators);
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
              const result = await fillPageTarget(mapping.pageTarget, value, writePageTarget,
                async () => this.ownsOperation(generation, abort)
                  && (initiator !== 'OVERLAY' || await this.overlayOriginAuthorized(batch.identity.origin))
                  && this.ownsOperation(generation, abort));
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
        const restartRevealId = (error as { revealId?: unknown })?.revealId;
        let activeRevealId: string | undefined;
        try { activeRevealId = (await (await this.getCore()).getActivePlanReveal(batch.identity.planId))?.id; }
        catch { /* Keep the original reveal error if active access cannot be checked. */ }
        const detail = messageFor(error, abort.signal.aborted, lastProgress, this.keyOwner(), moderators);
        this.state = typeof activeRevealId === 'string'
          && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(activeRevealId)
          ? { kind: 'WARNING', code: errorCode(error) === 'reveal_restart_required' ? 'reveal_restart_required' : 'active_access_open',
            planId: batch.identity.planId, revealId: activeRevealId,
            message: 'This plan has an open access request. You can cancel it and start again.', detail }
          : { kind: 'ERROR', message: detail,
            ...(errorCode(error) === 'reveal_restart_required' && typeof restartRevealId === 'string'
              ? { code: 'reveal_restart_required' as const } : {}) };
      }
    } finally {
      this.finishPro(abort);
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
  public async abortPlanAccess(planId: string, expectedRevealId?: string): Promise<RevealViewState> {
    if (this.cancellationInProgress) return this.state;
    if (this.active && this.intent?.planId !== planId) return this.state;
    this.cancellationInProgress = true;
    try { return await this.abortCurrentPlanAccess(planId, expectedRevealId); }
    finally { this.cancellationInProgress = false; }
  }

  private async abortCurrentPlanAccess(planId: string, expectedRevealId?: string): Promise<RevealViewState> {
    const active = this.active && this.intent?.planId === planId ? this.active : undefined;
    this.shutdownGeneration += 1;
    if (active) {
      active.abort();
      this.finishPro(active);
    }
    try {
      const { aborted } = await (await this.getCore()).abortPlanAccess(planId, expectedRevealId);
      await this.cancelRelay(planId);
      if (aborted || expectedRevealId === undefined) {
        if (this.intent?.planId === planId || (await this.recovery())?.planId === planId) await this.forget();
        this.state = { kind: 'DONE', message: aborted
          ? 'Access aborted. The next reveal of this plan will start a new request.'
          : 'No access remains open on this plan.' };
      } else this.state = await this.reconcile(planId);
      return this.state;
    } finally {
      if (this.active === active) this.active = undefined;
    }
  }

  public cancel(): RevealViewState {
    this.active?.abort();
    this.state = { kind: 'RUNNING', message: 'Canceling reveal…' };
    return this.state;
  }

  public cancelBatchOnTabChange(activeTabId: number, windowId: number): void {
    if (this.activeBatchWindowId === windowId && this.intent?.intent.kind === 'BATCH'
      && this.intent.intent.batch.identity.tabId !== activeTabId) this.active?.abort();
  }

  public ownsBatchInOtherWindow(windowId: number): boolean {
    return this.active !== undefined && this.intent?.intent.kind === 'BATCH'
      && this.activeBatchWindowId !== undefined && this.activeBatchWindowId !== windowId;
  }

  public cancelActiveBatch(): void {
    if (this.intent?.intent.kind === 'BATCH') this.active?.abort();
  }

  public cancelBatchForTab(tabId: number): void {
    if (this.intent?.intent.kind === 'BATCH' && this.intent.intent.batch.identity.tabId === tabId) this.active?.abort();
  }

  public cancelBatchForOrigin(origin: string): void {
    if (this.intent?.intent.kind === 'BATCH' && this.intent.intent.batch.identity.origin === origin) this.active?.abort();
  }

  /** Stops active and persisted reveal work before a coordinated Secure Logoff clears custody. */
  public async shutdown(): Promise<void> {
    this.shutdownGeneration += 1;
    this.active?.abort();
    if (this.active) this.finishPro(this.active);
    await this.cancelOwnedRelay();
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
function progressFor(progress: RevealProgress, keyOwner: 'Application' | 'Organisation', moderators: ReadonlyMap<string, string>): RevealViewState {
  const message = revealProgressMessage(progress, { keyOwner, moderators: [...moderators.values()], moderatorNamesById: moderators });
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

function errorCode(error: unknown): unknown {
  return (error as { code?: unknown; message?: unknown })?.code
    ?? (error as { message?: unknown })?.message;
}

function messageFor(
  error: unknown,
  canceled: boolean,
  lastProgress: RevealProgress | undefined,
  keyOwner: 'Application' | 'Organisation',
  moderators: ReadonlyMap<string, string>,
): string {
  // The server's own explanation outranks the transport error and the generic fallback below.
  if (lastProgress?.phase === 'STOPPED_BY_DMS') {
    return 'The dead man\'s switch subject stopped this reveal. Nothing was released.';
  }
  if (lastProgress !== undefined && hasRevealFailed(lastProgress.phase)) {
    return revealProgressMessage(lastProgress, { keyOwner, moderatorNamesById: moderators });
  }
  const code = errorCode(error);
  if (code === 'SAFEKEY_PANEL_REQUIRED' || code === 'SAFEKEY_PANEL_CLOSED')
    return 'The SafeKey PRO window closed. Start a new reveal. If the share was not saved, you can choose SafeKey Mobile or PRO again.';
  if (canceled) return 'Reveal canceled.';
  if (code === 'SAFEKEY_ABORTED') return 'SafeKey PRO operation canceled.';
  if (code === 'reveal_restart_required')
    return 'A previous access cannot continue after the browser closed. Restart it to open this plan again; approvals will be requested again.';
  if (code === 'merge_process_already_active')
    return 'Another access is open for this plan. Finish it in the integration where it started, then try again.';
  if (typeof code === 'string' && code.startsWith('SAFEKEY_'))
    return 'SafeKey PRO could not read this plan. Check the device and try again.';
  if (code === 'action_origin_denied') return 'This page origin is not approved for autofill.';
  if (code === 'stale_tab_context') return 'The page changed before autofill. Reveal again on the current page.';
  if ((error as { name?: unknown })?.name === 'MasterKeyRequired') {
    return `The ${keyOwner} key is not available from SafeKey Mobile for this account.`;
  }
  return 'Reveal could not continue. Try again.';
}

function moderatorsOf(plan: PlanForReveal): ReadonlyMap<string, string> {
  return new Map((plan.participants ?? [])
    .filter((participant) => participant.lifecycle === 'ACTIVE' && participant.relationships.includes('MODERATOR'))
    .map((participant) => [participant.id, participant.displayName]));
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
