import { revealModeOf } from '@safetech/inheriti-elements-core/browser';
import type { BrowserIntegrationCore, RevealProgress } from '@safetech/inheriti-elements-core/browser';
import type { RevealFieldOption, RevealViewState } from '../../shared/messages.js';
import type { AccessBatch, AccessFieldResult, AccessFieldResultCode } from '../../shared/access-contract.js';
import { validateAccessBatch } from '../../shared/access-contract.js';
import { preflightPageTarget } from '../page-fill.js';
import { revalidatePageTarget } from '../page-target.js';
import { ALLOWED_FIELDS, DEADLINE_ALARM, RECOVERY_WINDOW_MS } from './contracts.js';
import type { ChromeRevealCore, PlanForReveal, ProOptions, RelayOwner, RevealRecovery, RevealSessionView } from './contracts.js';
import { batchErrorCode, deliveryFailureMessage, errorCode, messageFor, moderatorsOf, progressFor, protectedFieldExists, resultFor, resultsFor, stableError } from './presentation.js';
import { RevealRelayStore } from './relay-store.js';
import { RevealRecoveryStore } from './recovery-store.js';
import { deliverBatchFields, deliverField } from './delivery.js';

export class ChromeRevealController {
  private active: AbortController | undefined;
  private activeBatchWindowId: number | undefined;
  private state: RevealViewState = { kind: 'IDLE' };
  private readonly recoveryStore: RevealRecoveryStore;
  private get intent(): RevealRecovery | undefined { return this.recoveryStore.intent; }
  private set intent(value: RevealRecovery | undefined) { this.recoveryStore.intent = value; }
  private shutdownGeneration = 0;
  private statusUnavailable = false;
  private cancellationInProgress = false;
  private proFinish: { owner: AbortController; finish(): void } | undefined;
  private readonly relayStore: RevealRelayStore;

  public constructor(
    private readonly getCore: () => Promise<BrowserIntegrationCore>,
    storage: chrome.storage.StorageArea,
    private readonly keyOwner: () => 'Application' | 'Organisation' = () => 'Application',
    private readonly proOptions?: (signal: AbortSignal, batch?: AccessBatch) => Promise<ProOptions | undefined>,
    relayRecovery?: { storage: chrome.storage.StorageArea; owner(): Promise<RelayOwner | undefined> },
    private readonly overlayOriginAuthorized: (origin: string) => Promise<boolean> = async () => true,
  ) {
    this.relayStore = new RevealRelayStore(getCore, relayRecovery);
    this.recoveryStore = new RevealRecoveryStore(storage);
  }

  public current(): RevealViewState { return this.state; }

  public async reconcile(planId: string): Promise<RevealViewState> {
    const recovery = await this.recoveryStore.read();
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
    } else if ((recovery?.planId === planId && Date.parse(recovery.deadline) > Date.now()) || await this.relayStore.relay(planId)) {
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
      if (this.intent?.planId !== planId && (await this.recoveryStore.read())?.planId !== planId && !await this.relayStore.relay(planId)) return status;
      if (status.kind !== 'RESUMABLE' && !(status.kind === 'RUNNING' && this.intent?.planId === planId)) return status;
      const active = this.active;
      this.shutdownGeneration += 1;
      active?.abort();
      if (active) this.finishPro(active);
      try {
        await this.relayStore.cancelRelay(planId);
        await this.recoveryStore.forget();
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
    const pendingRelay = await this.relayStore.ownedRelay();
    if (pendingRelay?.planId === input.planId) return { kind: 'RESUMABLE', planId: input.planId,
      message: 'An Organisation key request is still open. Cancel it before trying again.' };
    if (pendingRelay) await this.relayStore.cancelOwnedRelay();
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
        await this.recoveryStore.forget();
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
          void this.remember(session); void this.relayStore.clearRelay(input.planId, relaySessionId).catch(() => undefined);
        } },
        onRelaySession: async (session: { sessionId: string; expiresAt: string | Date }) => {
          await this.relayStore.rememberRelay(input.planId, session, () => this.ownsOperation(generation, abort));
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
        await deliverField(input, selected.fieldName, value, () => this.ownsOperation(generation, abort));
      });
      if (this.ownsOperation(generation, abort)) this.state = { kind: 'DONE', message: 'Field filled. Reveal closed.' };
    } catch (error) {
      if (this.active === abort && generation === this.shutdownGeneration) {
        this.state = { kind: 'ERROR', message: messageFor(error, abort.signal.aborted, lastProgress, this.keyOwner(), moderators) };
      }
    } finally {
      this.finishPro(abort);
      if (this.active === abort && generation === this.shutdownGeneration) {
        await this.recoveryStore.forget();
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
      let current: Awaited<ReturnType<typeof preflightPageTarget>> = 'form-changed';
      try { current = await preflightPageTarget(mapping.pageTarget, revalidatePageTarget); } catch { /* stale frame */ }
      if (generation !== this.shutdownGeneration || this.cancellationInProgress) return resultsFor(batch, 'canceled');
      if (current !== 'ready') {
        this.state = { kind: 'ERROR', message: current === 'page-address-changed'
          ? 'The page address changed after you selected the fields. Open the fields again on the current page.'
          : current === 'form-changed' ? 'The login form was replaced after you selected the fields. Open the fields again.'
            : 'A selected input is no longer available. Open the fields again.' };
        return batch.mappings.map((one) => resultFor(one,
          one === mapping ? current : 'not-attempted'));
      }
    }

    if (this.cancellationInProgress) return resultsFor(batch, 'canceled');
    const pendingRelay = await this.relayStore.ownedRelay();
    if (pendingRelay?.planId === batch.identity.planId) {
      this.state = { kind: 'RESUMABLE', planId: batch.identity.planId,
        message: 'An Organisation key request is still open. Cancel it before trying again.' };
      return resultsFor(batch, 'canceled');
    }
    if (pendingRelay) await this.relayStore.cancelOwnedRelay();
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
        await this.recoveryStore.forget();
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
          void this.remember(session); void this.relayStore.clearRelay(batch.identity.planId, relaySessionId).catch(() => undefined);
        } },
        onRelaySession: async (session: { sessionId: string; expiresAt: string | Date }) => {
          await this.relayStore.rememberRelay(batch.identity.planId, session, () => this.ownsOperation(generation, abort));
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
        })), (fields) => deliverBatchFields(batch, fields, outcomes,
          () => this.ownsOperation(generation, abort),
          () => initiator !== 'OVERLAY' || this.overlayOriginAuthorized(batch.identity.origin)));
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
        const deliveryCode = [...outcomes.values()].find((one) => one !== 'filled' && one !== 'not-attempted');
        const detail = errorCode(error) === 'access-request-failed' && deliveryCode !== undefined
          ? deliveryFailureMessage(deliveryCode)
          : messageFor(error, abort.signal.aborted, lastProgress, this.keyOwner(), moderators);
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
        await this.recoveryStore.forget();
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
      await this.relayStore.cancelRelay(planId);
      if (aborted || expectedRevealId === undefined) {
        if (this.intent?.planId === planId || (await this.recoveryStore.read())?.planId === planId) await this.recoveryStore.forget();
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
    await this.relayStore.cancelOwnedRelay();
    await this.closeAbandoned();
    this.active = undefined;
    this.state = { kind: 'IDLE' };
  }

  public async closeAbandoned(): Promise<void> {
    const revealId = await this.recoveryStore.rawRevealId();
    if (revealId !== undefined) await this.closeReveal(revealId);
    await this.recoveryStore.forget();
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
    const generation = this.shutdownGeneration;
    const recovery = await this.recoveryStore.read();
    if (generation !== this.shutdownGeneration) return;
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
    const recovery = await this.recoveryStore.read();
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

  private async closeReveal(revealId: string): Promise<void> {
    const workflows = (await this.getCore()).reveals as unknown as {
      close(revealId: string, reason: 'CANCELED'): Promise<void>;
    } | undefined;
    try { await workflows?.close(revealId, 'CANCELED'); } catch { /* best effort */ }
  }


  private remember(session: Partial<Pick<RevealSessionView, 'id' | 'expiresAt'>>): Promise<void> {
    return this.recoveryStore.remember(session, this.state);
  }

}

export function isRevealDeadline(name: string): boolean { return name === DEADLINE_ALARM; }
