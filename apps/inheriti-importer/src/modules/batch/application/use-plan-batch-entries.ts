import { useMemo } from 'react';
import type { ImportSession } from '@modules/import/domain/import-model';
import type { PlanDraft } from '@modules/plans/domain/workspace-model';
import type { PlanBatchEntry } from '../domain/plan-batch-input';
import { buildPlanBatchInput } from './batch-payload';

export function usePlanBatchEntries({
  plans,
  session,
  organizationId,
  currentMemberId,
  approvalMode,
  totalShares,
}: {
  plans: PlanDraft[];
  session: ImportSession;
  organizationId: string | undefined;
  currentMemberId: string | undefined;
  approvalMode: Parameters<typeof buildPlanBatchInput>[0]['approvalModeFallback'];
  totalShares: number;
}) {
  return useMemo<PlanBatchEntry[]>(
    () =>
      plans.map((plan) => ({
        planId: plan.clientId,
        input: buildPlanBatchInput({
          plan,
          session,
          organizationId: organizationId ?? '',
          creatorMemberId: currentMemberId,
          approvalModeFallback: approvalMode,
          totalShares,
        }),
      })),
    [plans, session, organizationId, currentMemberId, approvalMode, totalShares],
  );
}
