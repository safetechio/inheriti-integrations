import { validatePlanForExecution } from '@modules/plans/domain/workspace-validation';
import type { ImportSession } from '@modules/import/domain/import-model';
import type { PlanBatchInput } from '../domain/plan-batch-input';

/**
 * Everything the preflight (architecture §6.1) needs beyond the Plan itself:
 * organization context, staging authorization, and draft integrity readiness.
 * Refreshed by the controller's repository queries before every run.
 */
export interface BatchPreflightContext {
  organizationId: string | undefined;
}

/**
 * Throws with a user-facing message when a staging gate fails. The validation
 * callback runs before the staging request, guaranteeing zero writes for that
 * staged item.
 */
export function assertPlanBatchPreflight(
  input: PlanBatchInput,
  session: ImportSession,
  context: BatchPreflightContext,
): void {
  if (!context.organizationId) {
    throw new Error('No organization is selected.');
  }
  const result = validatePlanForExecution(input.plan, session);
  if (!result.valid) {
    throw new Error(result.issues.map((issue) => issue.message).join(' '));
  }
}
