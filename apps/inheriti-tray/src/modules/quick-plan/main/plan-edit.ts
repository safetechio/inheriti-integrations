import { createPlanEditOperations } from '@safetech/inheriti-elements-core/node';
import type { QuickPlanEditPhase, QuickPlanInput } from '@safetech/inheriti-elements-core/node';
import { ProtectedCheckpoint } from '../../launcher/main/protected-checkpoint.js';
import { trayMessages as messages } from '../../../messages.js';
import { PlanEditSessionCoordinator } from './plan-edit-session.js';
import type { EditAttempt } from './plan-edit-session.js';

interface PlanEditStatuses {
  idle: 'idle';
  loading: 'loading';
  saving: 'saving';
  updated: 'updated';
  error: 'error';
  recoveryRequired: 'recovery-required';
}

const PLAN_EDIT_STATUS: PlanEditStatuses = {
  idle: 'idle', loading: 'loading', saving: 'saving', updated: 'updated', error: 'error', recoveryRequired: 'recovery-required',
};

export type PlanEditState = {
  plans: { id: string; name: string }[];
  assets: { id: string; type: string; name: string; isMedia: boolean }[];
  status: PlanEditStatuses[keyof PlanEditStatuses];
  phase?: EditPhase;
  phaseHistory: EditPhase[];
  keyStatus?: 'accessing' | 'awaiting';
  available: boolean;
  canRecover: boolean;
  canDiscard: boolean;
  needsSignIn: boolean;
  actorMismatch: boolean;
  message?: string;
  planId?: string;
  editId?: string;
};

type Operations = ReturnType<typeof createPlanEditOperations>;
type EditPhase = 'loading_context' | 'opening_edit' | QuickPlanEditPhase;

export class TrayPlanEdit {
  private organizationId: string | undefined;
  private operations: Operations | undefined;
  private checkpoint: ProtectedCheckpoint | undefined;
  private plans: PlanEditState['plans'] = [];
  private assets: PlanEditState['assets'] = [];
  private status: PlanEditState['status'] = PLAN_EDIT_STATUS.idle;
  private phase: EditPhase | undefined;
  private phaseHistory: EditPhase[] = [];
  private keyStatus: PlanEditState['keyStatus'];
  private message: string | undefined;
  private planId: string | undefined;
  private pending = false;
  private canRecover = false;
  private needsSignIn = false;
  private actorMismatch = false;
  private revealGeneration = 0;
  private dismissed = false;
  private attempt: EditAttempt | undefined;
  private accessAbort: AbortController | undefined;
  private accessPromise: Promise<void> | undefined;

  constructor(private readonly apiUrl: string, private readonly environment: 'TEST' | 'LIVE', private readonly getAccessToken: () => Promise<string | undefined>, private readonly acquireKey?: (organizationId: string, signal?: AbortSignal, onRelaySession?: () => void) => Promise<string>, private readonly custodian?: Pick<Parameters<typeof createPlanEditOperations>[0], 'selectCustodianDevice' | 'proDevice'>) {}

  state(): PlanEditState {
    let available = false;
    try { available = !!this.checkpoint && this.checkpoint.isAvailable(); } catch {}
    return { plans: this.plans, assets: this.assets, status: this.status, available, canRecover: this.canRecover, canDiscard: !!this.attempt, needsSignIn: this.needsSignIn, actorMismatch: this.actorMismatch, phaseHistory: this.phaseHistory, ...(this.phase ? { phase: this.phase } : {}), ...(this.keyStatus ? { keyStatus: this.keyStatus } : {}), ...(this.message ? { message: this.message } : {}), ...(this.planId ? { planId: this.planId } : {}) };
  }

  assertIdle(): void { if (this.pending) throw new Error('edit_in_progress'); }

  clearRevealed(): void {
    this.revealGeneration += 1;
    this.dismissed = true;
    this.operations?.clearRevealed();
    this.assets = [];
  }

  async selectOrganization(id: string): Promise<void> {
    this.assertIdle();
    if (this.organizationId !== id && this.status === PLAN_EDIT_STATUS.recoveryRequired) throw new Error('edit_recovery_required');
    if (this.organizationId !== id) await this.abort();
    this.clearRevealed();
    this.organizationId = id;
    this.operations = undefined;
    this.plans = [];
    this.assets = [];
    this.status = PLAN_EDIT_STATUS.idle;
    this.planId = undefined;
    this.canRecover = false;
    this.needsSignIn = false;
    this.actorMismatch = false;
    this.message = undefined;
    this.checkpoint = new ProtectedCheckpoint();
    this.phase = undefined;
    this.phaseHistory = [];
    this.keyStatus = undefined;
  }

  async clear(): Promise<void> {
    this.assertIdle();
    const saved = this.attempt ?? this.checkpoint?.getItem<typeof this.attempt>('plan-edit/attempt');
    if (saved) {
      let sameActor = false;
      try { sameActor = saved.actor === await this.actor() && saved.organizationId === this.organizationId; } catch {}
      if (saved.startedAdd || !sameActor) { this.reset(); return; }
    }
    await this.discard();
    this.reset();
  }

  async discard(): Promise<void> {
    await this.discardAttempt(false);
  }

  private async discardAttempt(cancel: boolean): Promise<void> {
    this.assertIdle();
    this.clearRevealed();
    const saved = this.checkpoint?.getItem<typeof this.attempt>('plan-edit/attempt');
    const attempt = this.attempt ?? saved;
    if (attempt) {
      const operations = this.selectedOperations();
      if (attempt.actor === await this.actor() && attempt.organizationId === this.organizationId && attempt.editId) {
        try {
          if (cancel) await operations.cancel(attempt.planId, attempt.editId);
          else await operations.discard(attempt.planId, attempt.editId);
        } catch (error) {
          if ((error as Error).message !== 'edit_checkpoint_session_mismatch') throw error;
          await operations.discardLocal(attempt.planId, attempt.editId);
        }
      } else {
        await operations.discardLocal(attempt.planId, attempt.editId);
      }
    }
    this.attempt = undefined;
    this.dismissed = false;
    this.status = PLAN_EDIT_STATUS.idle;
    this.message = undefined;
    this.planId = undefined;
    this.canRecover = false;
    this.needsSignIn = false;
    this.actorMismatch = false;
    this.phase = undefined;
    this.phaseHistory = [];
    this.keyStatus = undefined;
  }

  async cancelAccess(): Promise<void> {
    if (this.pending && !this.accessPromise) throw new Error('edit_in_progress');
    if (this.status === PLAN_EDIT_STATUS.recoveryRequired || this.attempt?.startedAdd) throw new Error('edit_recovery_required');
    const access = this.accessPromise;
    this.accessAbort?.abort();
    this.clearRevealed();
    if (access && this.attempt?.editId) {
      await this.selectedOperations().cancel(this.attempt.planId, this.attempt.editId);
      this.attempt = undefined;
    }
    await access;
    if (this.state().status === PLAN_EDIT_STATUS.recoveryRequired || this.attempt?.startedAdd) throw new Error('edit_recovery_required');
    await this.discardAttempt(true);
  }

  reset(): void {
    this.clearRevealed();
    this.organizationId = undefined;
    this.operations = undefined;
    this.checkpoint = undefined;
    this.plans = [];
    this.assets = [];
    this.status = PLAN_EDIT_STATUS.idle;
    this.message = undefined;
    this.planId = undefined;
    this.canRecover = false;
    this.needsSignIn = false;
    this.actorMismatch = false;
    this.attempt = undefined;
    this.dismissed = false;
    this.phase = undefined;
    this.phaseHistory = [];
    this.keyStatus = undefined;
  }

  async load(onChange: () => void): Promise<void> {
    const operations = this.selectedOperations();
    this.status = PLAN_EDIT_STATUS.loading;
    this.plans = [];
    this.phase = undefined;
    this.phaseHistory = [];
    this.message = undefined;
    this.needsSignIn = false;
    onChange();
    try {
      const plans: PlanEditState['plans'] = [];
      let cursor: string | undefined;
      do {
        const page: { items: { id: string; name: string; status: string }[]; nextCursor: string | null } = await operations.list(cursor);
        plans.push(...page.items.filter((plan) => plan.status === 'PROTECTED').map(({ id, name }) => ({ id, name })));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      this.plans = plans;
      this.status = PLAN_EDIT_STATUS.idle;
      this.message = undefined;
      const saved = this.checkpoint?.getItem<typeof this.attempt>('plan-edit/attempt');
      if (saved) {
        this.attempt = saved;
        this.planId = saved.planId;
        this.status = saved.startedAdd ? PLAN_EDIT_STATUS.recoveryRequired : PLAN_EDIT_STATUS.error;
        const sameActor = saved.actor === await this.actor() && saved.organizationId === this.organizationId;
        this.canRecover = sameActor && !!saved.startedAdd;
        this.actorMismatch = !sameActor;
        this.message = sameActor
          ? messages.editSaved : messages.editOtherAccount;
      }
    } catch (error) {
      this.status = PLAN_EDIT_STATUS.error;
      const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : undefined;
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      const reason = error instanceof Error ? error.message : '';
      this.needsSignIn = status === 401 || code === 'reauthentication_required' || reason === 'operator_reauthentication_required' || reason === 'reauthentication_required';
      this.message = this.needsSignIn ? messages.sessionExpired : status === 403 ? messages.editListDenied : messages.editListFailed;
    }
    onChange();
  }

  async add(planId: string, asset: QuickPlanInput['asset'], onChange: () => void): Promise<void> {
    this.assertIdle();
    if (!this.checkpoint?.isAvailable()) throw new Error(messages.checkpointUnavailable);
    if (!this.plans.some((plan) => plan.id === planId)) throw new Error('plan_unavailable');
    const operations = this.selectedOperations();
    this.pending = true;
    this.planId = planId;
    this.status = PLAN_EDIT_STATUS.saving;
    this.message = undefined;
    this.phase = undefined;
    this.phaseHistory = [];
    onChange();
    try {
      if (this.dismissed) {
        await this.abort();
        this.dismissed = false;
      }
      this.attempt = await this.session().open(planId, true, (phase) => this.reportPhase(phase, onChange), (attempt) => { this.attempt = attempt; }, undefined, () => { this.keyStatus = 'awaiting'; onChange(); });
      const attempt = this.attempt;
      if (attempt.startedAdd) {
        const recovered = await operations.recover(planId, attempt.editId!);
        this.status = recovered.status === 'UPDATED' ? PLAN_EDIT_STATUS.updated : PLAN_EDIT_STATUS.recoveryRequired;
        if (this.status === PLAN_EDIT_STATUS.updated) { this.attempt = undefined; }
        return;
      }
      attempt.startedAdd = true;
      this.canRecover = true;
      this.checkpoint.setItem('plan-edit/attempt', attempt);
      this.phase = undefined;
      const result = await operations.add(planId, attempt.editId!, attempt.totalShares, asset, (phase: EditPhase) => this.reportPhase(phase, onChange), () => { this.keyStatus = 'awaiting'; onChange(); });
      this.status = result.status === 'UPDATED' ? PLAN_EDIT_STATUS.updated : PLAN_EDIT_STATUS.recoveryRequired;
      if (this.status === PLAN_EDIT_STATUS.updated) { this.attempt = undefined; }
      if (this.status === PLAN_EDIT_STATUS.recoveryRequired) this.message = messages.editNeedsRecovery;
    } catch (error) {
      this.status = this.attempt?.startedAdd ? PLAN_EDIT_STATUS.recoveryRequired : PLAN_EDIT_STATUS.error;
      this.message = this.errorMessage(error);
    } finally {
      this.pending = false;
      this.keyStatus = undefined;
      onChange();
    }
  }

  listAssets(planId: string, onChange: () => void): Promise<void> {
    const access = this.runListAssets(planId, onChange);
    this.accessPromise = access;
    const clear = () => { if (this.accessPromise === access) this.accessPromise = undefined; };
    void access.then(clear, clear);
    return access;
  }

  private async runListAssets(planId: string, onChange: () => void): Promise<void> {
    this.assertIdle();
    if (!this.checkpoint?.isAvailable()) throw new Error(messages.checkpointUnavailable);
    if (!this.plans.some((plan) => plan.id === planId)) throw new Error('plan_unavailable');
    this.pending = true;
    this.planId = planId;
    this.assets = [];
    this.status = PLAN_EDIT_STATUS.loading;
    this.message = undefined;
    this.phase = undefined;
    this.phaseHistory = [];
    const generation = this.revealGeneration;
    const request = new AbortController();
    this.accessAbort = request;
    const report = (phase: EditPhase) => {
      if (!request.signal.aborted && generation === this.revealGeneration) this.reportPhase(phase, onChange);
    };
    const awaitingKey = () => {
      if (request.signal.aborted || generation !== this.revealGeneration) return;
      this.keyStatus = 'awaiting';
      onChange();
    };
    onChange();
    try {
      if (this.dismissed) {
        await this.abort();
        this.dismissed = false;
      }
      const attempt = await this.session().open(planId, false, report, (attempt) => { this.attempt = attempt; }, request.signal, awaitingKey);
      this.attempt = attempt;
      if (generation !== this.revealGeneration) throw new Error('edit_dismissed');
      this.phase = undefined;
      let stopWaiting!: () => void;
      const canceled = new Promise<never>((_, reject) => {
        stopWaiting = () => reject(new Error('edit_dismissed'));
        request.signal.addEventListener('abort', stopWaiting, { once: true });
      });
      try {
        this.assets = await Promise.race([
          this.selectedOperations().listAssets(planId, attempt.editId!, awaitingKey, report, request.signal),
          canceled,
        ]);
      } finally { request.signal.removeEventListener('abort', stopWaiting); }
      this.keyStatus = undefined;
      if (generation !== this.revealGeneration) {
        this.assets = [];
        throw new Error('edit_dismissed');
      }
      this.status = PLAN_EDIT_STATUS.idle;
      this.phase = undefined;
    } catch (error) {
      if (process.env.INHERITI_DEPLOYMENT === 'local' && error instanceof Error) {
        const code = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(error.message) ? error.message : 'unclassified';
        console.error('Plan edit access failed:', error.name, code);
      }
      this.status = request.signal.aborted ? PLAN_EDIT_STATUS.idle : PLAN_EDIT_STATUS.error;
      const message = this.errorMessage(error);
      this.message = request.signal.aborted ? undefined : message === messages.editSaveFailed
        ? (this.phase === 'configuring_custodian_share' || (this.phase === 'connecting_safekey_pro' && this.phaseHistory.includes('configuring_custodian_share')))
          ? messages.editCustodianConfigurationFailed : messages.editAccessFailed
        : message;
    } finally {
      this.pending = false;
      if (this.accessAbort === request) this.accessAbort = undefined;
      this.keyStatus = undefined;
      onChange();
    }
  }

  async getAsset(planId: string, assetId: string): Promise<QuickPlanInput['asset'] & { id: string }> {
    this.assertIdle();
    const attempt = this.attempt;
    if (!attempt?.editId || attempt.planId !== planId || !this.assets.some((asset) => asset.id === assetId)) throw new Error('asset_unavailable');
    this.pending = true;
    const generation = this.revealGeneration;
    try {
      const asset = await this.selectedOperations().getAsset(planId, attempt.editId, assetId);
      if (generation !== this.revealGeneration) throw new Error('edit_dismissed');
      const data = (asset.secret as { data?: unknown }).data;
      if (typeof Blob !== 'undefined' && data instanceof Blob) {
        const encoded = Buffer.from(await data.arrayBuffer()).toString('base64');
        if (generation !== this.revealGeneration) throw new Error('edit_dismissed');
        return { id: asset.id, type: asset.type, meta: asset.meta, secret: Object.assign({}, asset.secret, { data: encoded }) };
      }
      return asset;
    } finally {
      this.pending = false;
    }
  }

  async replace(planId: string, assetId: string, asset: QuickPlanInput['asset'], onChange: () => void): Promise<void> {
    this.assertIdle();
    const attempt = this.attempt;
    const selected = this.assets.find((item) => item.id === assetId);
    if (!attempt?.editId || attempt.planId !== planId || !selected || selected.type !== asset.type) throw new Error('asset_unavailable');
    this.pending = true;
    this.status = PLAN_EDIT_STATUS.saving;
    this.message = undefined;
    this.phase = undefined;
    this.phaseHistory = [];
    onChange();
    try {
      attempt.startedAdd = true;
      this.canRecover = true;
      this.checkpoint!.setItem('plan-edit/attempt', attempt);
      const result = await this.selectedOperations().replace(planId, attempt.editId, attempt.totalShares, assetId, asset, (phase: EditPhase) => this.reportPhase(phase, onChange), () => { this.keyStatus = 'awaiting'; onChange(); });
      this.status = result.status === 'UPDATED' ? PLAN_EDIT_STATUS.updated : PLAN_EDIT_STATUS.recoveryRequired;
      if (this.status === PLAN_EDIT_STATUS.updated) this.attempt = undefined;
      if (this.status === PLAN_EDIT_STATUS.recoveryRequired) this.message = messages.editNeedsRecovery;
      this.assets = [];
    } catch (error) {
      this.status = attempt.startedAdd ? PLAN_EDIT_STATUS.recoveryRequired : PLAN_EDIT_STATUS.error;
      this.message = attempt.startedAdd ? `${this.errorMessage(error)} ${messages.editNeedsRecovery}` : this.errorMessage(error);
      this.assets = [];
    } finally {
      this.pending = false;
      this.keyStatus = undefined;
      onChange();
    }
  }

  private errorMessage(error: unknown): string {
    const code = error instanceof Error ? error.message : '';
    if (code === 'SAFEKEY_NO_SPACE') return messages.safeKeyProNoSpace;
    if (this.phaseHistory.includes('configuring_custodian_share') && /^SAFEKEY_COMMAND_FAILED_3_[0-9A-F]{2}$/.test(code)) return messages.safeKeyProWriteRejected(code.slice(-2));
    if (code === 'SAFEKEY_DEVICE_NOT_CONNECTED' || code === 'safekey_pro_local_device_required') return messages.safeKeyProNotConnected;
    if (code === 'SAFEKEY_DEVICE_INFO_MISSING' || (code === 'SAFEKEY_NOT_FOUND' && this.phaseHistory.includes('configuring_custodian_share'))) return messages.safeKeyProDeviceInfoMissing;
    if (code === 'SAFEKEY_INVALID_PIN') return messages.safeKeyProInvalidPin;
    if (code === 'SAFEKEY_NOT_FOUND' || code === 'custodian_share_unavailable') return messages.safeKeyProShareUnavailable;
    if (error && typeof error === 'object' && 'status' in error) {
      if (error.status === 403) return messages.editDenied;
      if (error.status === 409) return messages.editConflict;
      if (error.status === 410) return messages.editExpired;
    }
    return messages.editSaveFailed;
  }

  private reportPhase(phase: EditPhase, onChange: () => void): void {
    this.phase = phase;
    if (!this.phaseHistory.includes(phase)) this.phaseHistory = this.phaseHistory.concat(phase);
    this.keyStatus = phase === 'acquiring_key' ? 'accessing' : undefined;
    onChange();
  }

  async recover(onChange: () => void): Promise<void> {
    this.assertIdle();
    const attempt = this.checkpoint?.getItem<typeof this.attempt>('plan-edit/attempt');
    if (!attempt?.editId || !attempt.startedAdd || attempt.actor !== await this.actor() || attempt.organizationId !== this.organizationId) throw new Error('edit_recovery_unavailable');
    this.pending = true;
    this.status = PLAN_EDIT_STATUS.saving;
    onChange();
    try {
      const result = await this.selectedOperations().recover(attempt.planId, attempt.editId);
      this.status = result.status === 'UPDATED' ? PLAN_EDIT_STATUS.updated : PLAN_EDIT_STATUS.recoveryRequired;
      this.message = this.status === PLAN_EDIT_STATUS.updated ? undefined : messages.editStillNeedsRecovery;
      if (this.status === PLAN_EDIT_STATUS.updated) { this.attempt = undefined; }
    } catch {
      this.status = PLAN_EDIT_STATUS.recoveryRequired;
      this.message = messages.editStillNeedsRecovery;
    } finally {
      this.pending = false;
      onChange();
    }
  }

  private selectedOperations(): Operations {
    if (!this.organizationId || !this.checkpoint) throw new Error('organization_required');
    this.operations ??= createPlanEditOperations({
      apiUrl: this.apiUrl, environment: this.environment, organizationId: this.organizationId,
      getBearerToken: this.getAccessToken,
      selectCustodianDevice: this.custodian?.selectCustodianDevice,
      proDevice: this.custodian?.proDevice,
      ...(this.acquireKey ? { acquireKey: (signal?: AbortSignal, onRelaySession?: () => void) => this.acquireKey!(this.organizationId!, signal, onRelaySession) } : {}),
      secureSessionStorage: this.checkpoint, payloadStorage: this.checkpoint, editRecoveryStore: this.checkpoint,
    });
    return this.operations;
  }

  private session(): PlanEditSessionCoordinator {
    if (!this.organizationId || !this.checkpoint) throw new Error('organization_required');
    return new PlanEditSessionCoordinator(this.checkpoint, this.selectedOperations(), this.organizationId, () => this.actor(), this.acquireKey ? (signal, onRelaySession) => this.acquireKey!(this.organizationId!, signal, onRelaySession) : undefined);
  }

  private async abort(): Promise<void> {
    if (!this.organizationId || !this.checkpoint) return;
    const attempt = this.attempt ?? this.checkpoint.getItem<EditAttempt>('plan-edit/attempt');
    if (!attempt) return;
    await this.session().abort(attempt);
    this.attempt = undefined;
  }

  private async actor(): Promise<string> {
    const token = await this.getAccessToken();
    const segment = token?.split('.')[1];
    if (!segment) throw new Error('reauthentication_required');
    const claims: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    if (!claims || typeof claims !== 'object' || !('sub' in claims) || typeof claims.sub !== 'string' || !claims.sub) throw new Error('reauthentication_required');
    return claims.sub;
  }
}
