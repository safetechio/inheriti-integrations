import type { PlanDraft } from '@modules/plans/domain/workspace-model';

/**
 * The per-Plan payload the batch controller feeds into the local
 * `runPlanBatch` executor (`plan-batch-executor.ts`). Built once per
 * snapshot and frozen — see `batch-snapshot.ts`.
 */
export interface PlanBatchInput {
  readonly plan: PlanDraft;
  readonly assets: readonly unknown[];
  readonly payload: Readonly<Record<string, unknown>>;
  readonly totalShares: number;
}

export interface PlanBatchEntry {
  readonly planId: string;
  readonly input: PlanBatchInput;
}

/**
 * Identity scope the Importer's `OrganizationKeyVault` keys its (in-memory-only)
 * cache by. Note this does NOT include a Plan id — the vault caches "the
 * Organization Key for this org+session", not "for this Plan".
 * Plan-boundedness of a *release* is enforced by the controller, not the
 * vault — see `use-organization-key-release.ts`.
 */
export interface OrganizationKeyIdentity {
  readonly organizationId: string;
  readonly sessionFamilyId: string;
  readonly userId: string;
}
