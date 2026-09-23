import { createPlanEditOperations } from '@safetech/inheriti-elements-core/node';
import type { QuickPlanInput } from '@safetech/inheriti-elements-core/node';
import { ProtectedCheckpoint } from '../../launcher/main/protected-checkpoint.js';
import { trayMessages as messages } from '../../../messages.js';

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
  status: PlanEditStatuses[keyof PlanEditStatuses];
  available: boolean;
  canRecover: boolean;
  actorMismatch: boolean;
  message?: string;
  planId?: string;
};

type Operations = ReturnType<typeof createPlanEditOperations>;

export class TrayPlanEdit {
  private organizationId: string | undefined;
  private operations: Operations | undefined;
  private checkpoint: ProtectedCheckpoint | undefined;
  private plans: PlanEditState['plans'] = [];
  private status: PlanEditState['status'] = PLAN_EDIT_STATUS.idle;
  private message: string | undefined;
  private planId: string | undefined;
  private pending = false;
  private canRecover = false;
  private actorMismatch = false;
  private attempt: { actor: string; organizationId: string; planId: string; idempotencyKey: string; mode: 'DIRECT' | 'GOVERNED'; totalShares: number; editId?: string; startedAdd?: boolean } | undefined;

  constructor(private readonly apiUrl: string, private readonly environment: 'TEST' | 'LIVE', private readonly getAccessToken: () => Promise<string | undefined>) {}

  state(): PlanEditState {
    let available = false;
    try { available = !!this.checkpoint && this.checkpoint.isAvailable(); } catch {}
    return { plans: this.plans, status: this.status, available, canRecover: this.canRecover, actorMismatch: this.actorMismatch, ...(this.message ? { message: this.message } : {}), ...(this.planId ? { planId: this.planId } : {}) };
  }

  assertIdle(): void { if (this.pending) throw new Error('edit_in_progress'); }

  async selectOrganization(id: string): Promise<void> {
    this.assertIdle();
    if (this.organizationId !== id && this.status === PLAN_EDIT_STATUS.recoveryRequired) throw new Error('edit_recovery_required');
    if (this.organizationId !== id) await this.abort();
    this.organizationId = id;
    this.operations = undefined;
    this.plans = [];
    this.status = PLAN_EDIT_STATUS.idle;
    this.planId = undefined;
    this.canRecover = false;
    this.actorMismatch = false;
    this.message = undefined;
    this.checkpoint = new ProtectedCheckpoint();
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
    this.assertIdle();
    const saved = this.checkpoint?.getItem<typeof this.attempt>('plan-edit/attempt');
    const attempt = this.attempt ?? saved;
    if (attempt) {
      const operations = this.selectedOperations();
      if (attempt.actor === await this.actor() && attempt.organizationId === this.organizationId && attempt.editId) {
        await operations.discard(attempt.planId, attempt.editId);
      } else {
        await operations.discardLocal(attempt.planId, attempt.editId);
      }
    }
    this.attempt = undefined;
    this.status = PLAN_EDIT_STATUS.idle;
    this.message = undefined;
    this.planId = undefined;
    this.canRecover = false;
    this.actorMismatch = false;
  }

  reset(): void {
    this.organizationId = undefined;
    this.operations = undefined;
    this.checkpoint = undefined;
    this.plans = [];
    this.status = PLAN_EDIT_STATUS.idle;
    this.message = undefined;
    this.planId = undefined;
    this.canRecover = false;
    this.actorMismatch = false;
    this.attempt = undefined;
  }

  async load(onChange: () => void): Promise<void> {
    const operations = this.selectedOperations();
    this.status = PLAN_EDIT_STATUS.loading;
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
      this.message = error && typeof error === 'object' && 'status' in error && error.status === 403
        ? messages.editListDenied : messages.editListFailed;
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
    onChange();
    try {
      const actor = await this.actor();
      const saved = this.checkpoint.getItem<typeof this.attempt>('plan-edit/attempt');
      if (saved && (saved.actor !== actor || saved.organizationId !== this.organizationId || saved.planId !== planId)) throw new Error('unresolved_edit_attempt');
      this.attempt = saved ?? undefined;
      if (!this.attempt) this.attempt = { actor, organizationId: this.organizationId!, planId, ...await operations.context(planId) };
      const attempt = this.attempt;
      if (!attempt) throw new Error('plan_edit_unavailable');
      this.checkpoint.setItem('plan-edit/attempt', attempt);
      if (!attempt.editId) attempt.editId = (await operations.start(planId, attempt.mode, attempt.idempotencyKey)).id;
      this.checkpoint.setItem('plan-edit/attempt', attempt);
      if (attempt.startedAdd) {
        const recovered = await operations.recover(planId, attempt.editId);
        this.status = recovered.status === 'UPDATED' ? PLAN_EDIT_STATUS.updated : PLAN_EDIT_STATUS.recoveryRequired;
        if (this.status === PLAN_EDIT_STATUS.updated) { this.attempt = undefined; }
        return;
      }
      attempt.startedAdd = true;
      this.canRecover = true;
      this.checkpoint.setItem('plan-edit/attempt', attempt);
      const result = await operations.add(planId, attempt.editId, attempt.totalShares, asset);
      this.status = result.status === 'UPDATED' ? PLAN_EDIT_STATUS.updated : PLAN_EDIT_STATUS.recoveryRequired;
      if (this.status === PLAN_EDIT_STATUS.updated) { this.attempt = undefined; }
      if (this.status === PLAN_EDIT_STATUS.recoveryRequired) this.message = messages.editNeedsRecovery;
    } catch (error) {
      this.status = this.attempt?.startedAdd ? PLAN_EDIT_STATUS.recoveryRequired : PLAN_EDIT_STATUS.error;
      this.message = error && typeof error === 'object' && 'status' in error && error.status === 403
        ? messages.editDenied : messages.editSaveFailed;
    } finally {
      this.pending = false;
      onChange();
    }
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
      secureSessionStorage: this.checkpoint, payloadStorage: this.checkpoint, editRecoveryStore: this.checkpoint,
    });
    return this.operations;
  }

  private async abort(): Promise<void> {
    const saved = this.checkpoint?.getItem<typeof this.attempt>('plan-edit/attempt');
    const attempt = this.attempt ?? saved;
    if (attempt && (attempt.actor !== await this.actor() || attempt.organizationId !== this.organizationId)) throw new Error('unresolved_edit_attempt');
    if (attempt?.startedAdd) throw new Error('edit_recovery_required');
    if (attempt?.editId) await this.selectedOperations().discard(attempt.planId, attempt.editId);
    if (attempt && !attempt.editId) await this.selectedOperations().discardLocal(attempt.planId);
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
