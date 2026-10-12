import type { PlanBatchEntry, PlanBatchInput } from '../domain/plan-batch-input';

/**
 * Freezes an immutable batch snapshot with the (already client-generated,
 * per `PlanDraft.clientId`) Plan ids — architecture §6.1 step 7. Executing a
 * batch always runs against a frozen copy, never the live, still-editable
 * `entries` derived from current workspace state, so nothing mutates
 * mid-run.
 */
export function freezeBatchSnapshot(entries: readonly PlanBatchEntry[]): readonly PlanBatchEntry[] {
  return Object.freeze(
    entries.map((entry) =>
      Object.freeze<PlanBatchEntry>({
        planId: entry.planId,
        input: Object.freeze<PlanBatchInput>({
          plan: entry.input.plan,
          assets: Object.freeze([...entry.input.assets]),
          payload: Object.freeze({ ...entry.input.payload }),
          totalShares: entry.input.totalShares,
        }),
      }),
    ),
  );
}
