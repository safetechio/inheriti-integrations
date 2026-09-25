import type { createPlanEditOperations } from '@safetech/inheriti-elements-core/node';
import type { ProtectedCheckpoint } from '../../launcher/main/protected-checkpoint.js';

export type EditAttempt = { actor: string; organizationId: string; planId: string; idempotencyKey: string; mode: 'DIRECT' | 'GOVERNED'; totalShares: number; masterKeyEncrypted?: boolean; editId?: string; startedAdd?: boolean };
type Operations = ReturnType<typeof createPlanEditOperations>;

/** Owns the persisted opening of a Business plan edit session. */
export class PlanEditSessionCoordinator {
  constructor(private readonly checkpoint: ProtectedCheckpoint, private readonly operations: Operations, private readonly organizationId: string, private readonly actor: () => Promise<string>, private readonly acquireKey?: (signal?: AbortSignal, onRelaySession?: () => void) => Promise<string>) {}

  saved(): EditAttempt | undefined {
    return this.checkpoint.getItem<EditAttempt>('plan-edit/attempt') ?? undefined;
  }

  save(attempt: EditAttempt): void {
    this.checkpoint.setItem('plan-edit/attempt', attempt);
  }

  async open(planId: string, allowStartedAdd: boolean, onPhase: (phase: 'loading_context' | 'acquiring_key' | 'opening_edit') => void, onAttempt: (attempt: EditAttempt) => void, signal?: AbortSignal, onRelaySession?: () => void): Promise<EditAttempt> {
    const actor = await this.actor();
    const saved = this.saved();
    if (saved && (saved.actor !== actor || saved.organizationId !== this.organizationId || saved.planId !== planId || (!allowStartedAdd && saved.startedAdd))) throw new Error('unresolved_edit_attempt');
    let attempt = saved;
    if (!attempt) {
      onPhase('loading_context');
      const context = await this.operations.context(planId);
      if (typeof context.masterKeyEncrypted !== 'boolean') throw new Error('invalid_plan_edit_context');
      attempt = {
        actor,
        organizationId: this.organizationId,
        planId,
        idempotencyKey: context.idempotencyKey,
        mode: context.mode,
        totalShares: context.totalShares,
        masterKeyEncrypted: context.masterKeyEncrypted,
      };
    }
    onAttempt(attempt);
    this.save(attempt);
    if (!attempt.editId) {
      if (attempt.masterKeyEncrypted === undefined) {
        onPhase('loading_context');
        attempt.masterKeyEncrypted = (await this.operations.context(planId)).masterKeyEncrypted;
        if (typeof attempt.masterKeyEncrypted !== 'boolean') throw new Error('invalid_plan_edit_context');
        this.save(attempt);
      }
      if (attempt.masterKeyEncrypted) {
        if (!this.acquireKey) throw new Error('organization_key_unavailable');
        onPhase('acquiring_key');
        await this.acquireKey(signal, onRelaySession);
      }
      onPhase('opening_edit');
      attempt.editId = (await this.operations.start(planId, attempt.mode, attempt.idempotencyKey)).id;
    }
    this.save(attempt);
    return attempt;
  }

  async abort(attempt?: EditAttempt): Promise<void> {
    const pending = attempt ?? this.saved();
    if (pending && (pending.actor !== await this.actor() || pending.organizationId !== this.organizationId)) throw new Error('unresolved_edit_attempt');
    if (pending?.startedAdd) throw new Error('edit_recovery_required');
    if (pending?.editId) await this.operations.discard(pending.planId, pending.editId);
    if (pending && !pending.editId) await this.operations.discardLocal(pending.planId);
  }
}
