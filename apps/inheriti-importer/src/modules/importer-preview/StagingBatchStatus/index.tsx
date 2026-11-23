import { Box, Button, Text } from '@main-components';
import type { PlanBatchControllerItem } from '@modules/batch/application/use-plan-batch-controller';
import { useCallback, useLayoutEffect, useRef } from 'react';
import { PlanStatusRow } from './components/PlanStatusRow';
import { projectStagingBatch, type StagingBatchPlan } from './projection';
import './styles.css';

export type StagingBatchStatusProps = {
  items: readonly PlanBatchControllerItem[];
  plans: readonly { id: string; name: string }[];
  running: boolean;
  onRetryCreate: (planId: string) => void;
  onRetryConfigure: (planId: string) => void;
  onCancel: () => void;
  embedded?: boolean;
};

export function StagingBatchStatus({
  items,
  plans,
  running,
  onRetryCreate,
  onRetryConfigure,
  onCancel,
  embedded = false,
}: StagingBatchStatusProps) {
  const retryHandlers = useRef({ create: onRetryCreate, configure: onRetryConfigure });
  useLayoutEffect(() => {
    retryHandlers.current = { create: onRetryCreate, configure: onRetryConfigure };
  }, [onRetryCreate, onRetryConfigure]);
  const onRetry = useCallback((retry: NonNullable<StagingBatchPlan['retry']>, planId: string) => {
    retryHandlers.current[retry](planId);
  }, []);

  if (!items.length) return null;
  const batch = projectStagingBatch(items, plans);
  if (!running && batch.completed === items.length) return null;
  return (
    <Box gap="m" className={embedded ? 'staging-batch-embedded' : 'staging-batch-standalone'}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="s">
        <Text variant={embedded ? 'heading3' : 'bodySmall'} bold>
          {batch.completed} of {items.length} {items.length === 1 ? 'plan' : 'plans'} staged
        </Text>
        {running && !embedded ? (
          <Button
            title="Cancel staging"
            variant="outlined"
            color="gray"
            size="sm"
            onPress={onCancel}
          />
        ) : null}
      </Box>
      {!embedded ? (
        <Text variant="bodySmall" color="gray">
          {batch.current ? `Current: ${batch.current} · ` : ''}Pending: {batch.pending}
          {batch.cancelled ? ` · Cancelled: ${batch.cancelled}` : ''}
        </Text>
      ) : null}
      {batch.plans.map((plan) => (
        <PlanStatusRow
          key={plan.planId}
          {...plan}
          embedded={embedded}
          retryDisabled={running && plan.retry !== null}
          onRetry={onRetry}
        />
      ))}
    </Box>
  );
}

export { projectStagingBatch, stagingOutcome } from './projection';
