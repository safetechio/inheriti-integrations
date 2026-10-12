import { useCallback, useRef } from 'react';
import type { ImportTelemetrySink } from '@shared/infrastructure/telemetry';
import { createCorrelationId } from '@shared/infrastructure/telemetry';
import type { PlanBatchEntry } from '../domain/plan-batch-input';
import type { OrganizationKeyRelease } from './use-organization-key-release';
import { freezeBatchSnapshot } from './batch-snapshot';

type BatchResult = {
  complete: readonly unknown[];
  createdUnconfigured: readonly unknown[];
  failed: readonly unknown[];
  cancelled: readonly unknown[];
};
type Batch = {
  run: (entries: readonly PlanBatchEntry[]) => Promise<BatchResult>;
  retryCreate: (planId: string) => Promise<void>;
  retryConfigure: (planId: string) => Promise<void>;
  cancel: () => void;
};

export function usePlanBatchExecution({
  entries,
  batch,
  telemetry,
  keyRelease,
}: {
  entries: PlanBatchEntry[];
  batch: Batch;
  telemetry: ImportTelemetrySink;
  keyRelease: OrganizationKeyRelease;
}) {
  const batchStartedAt = useRef<number | null>(null);
  const batchCorrelationId = useRef<string | null>(null);
  const execute = useCallback(() => {
    const snapshot = freezeBatchSnapshot(entries);
    batchStartedAt.current = Date.now();
    batchCorrelationId.current = createCorrelationId();
    telemetry.record({
      name: 'batch_started',
      at: batchStartedAt.current,
      count: snapshot.length,
      correlationId: batchCorrelationId.current,
    });
    void batch.run(snapshot).then((result) => {
      const correlationId = batchCorrelationId.current ?? createCorrelationId();
      result.complete.forEach(() => recordPlan(telemetry, 'complete', correlationId));
      result.createdUnconfigured.forEach(() =>
        recordPlan(telemetry, 'created-unconfigured', correlationId),
      );
      result.failed.forEach(() => recordPlan(telemetry, 'failed', correlationId));
      result.cancelled.forEach(() => recordPlan(telemetry, 'cancelled', correlationId));
      const completedAt = Date.now();
      telemetry.record({
        name: 'batch_completed',
        at: completedAt,
        durationMs: completedAt - (batchStartedAt.current ?? completedAt),
        correlationId,
      });
    });
  }, [entries, batch, telemetry]);
  const requestOrganizationKey = useCallback(() => {
    if (!entries.length || keyRelease.state.localKeyAvailable || keyRelease.state.activePlanId)
      return;
    void keyRelease.acquire().catch(() => undefined);
  }, [entries.length, keyRelease]);
  const retryCreate = useCallback((planId: string) => void batch.retryCreate(planId), [batch]);
  const retryConfigure = useCallback(
    (planId: string) => void batch.retryConfigure(planId),
    [batch],
  );
  const cancel = useCallback(() => {
    keyRelease.cancel();
    batch.cancel();
  }, [batch, keyRelease]);
  return { execute, requestOrganizationKey, retryCreate, retryConfigure, cancel };
}

function recordPlan(
  telemetry: ImportTelemetrySink,
  status: 'complete' | 'created-unconfigured' | 'failed' | 'cancelled',
  correlationId: string,
) {
  telemetry.record({
    name:
      status === 'complete' || status === 'created-unconfigured' ? 'plan_completed' : 'plan_failed',
    at: Date.now(),
    status,
    correlationId,
  });
}
