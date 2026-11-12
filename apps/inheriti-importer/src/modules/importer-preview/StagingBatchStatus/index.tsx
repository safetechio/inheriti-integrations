import { Box, Button, Text } from '@main-components';
import type { PlanBatchControllerItem } from '@modules/batch/application/use-plan-batch-controller';
import { projectStagingBatch } from './projection';
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
        <Box key={plan.planId} flexDirection="row" alignItems="center" gap="s">
          <Box flex={1}>
            <Box
              accessibilityRole="progressbar"
              accessibilityLabel={`${plan.name}: ${plan.outcome}`}
              aria-valuemin={plan.outcome === 'Staging' ? undefined : 0}
              aria-valuemax={plan.outcome === 'Staging' ? undefined : 100}
              aria-valuenow={
                plan.outcome === 'Staging' ? undefined : plan.outcome === 'Staged' ? 100 : 0
              }
              aria-valuetext={plan.outcome}
              ref={(element) => element?.setAttribute('title', `${plan.name}: ${plan.outcome}`)}
              height={22}
              backgroundColor="gray10"
              borderRadius="pill"
              overflow="hidden"
              className="staging-plan-track"
            >
              {plan.outcome === 'Staged' || plan.outcome === 'Staging' ? (
                <Box
                  width={plan.outcome === 'Staged' ? '100%' : 100}
                  height={22}
                  className={`staging-plan-fill ${plan.outcome === 'Staging' ? 'is-active' : ''}`}
                >
                  <Text variant="bodyRegular" color="white" className="staging-plan-label">
                    {embedded ? plan.name : `${plan.name} · ${plan.outcome}`}
                  </Text>
                </Box>
              ) : null}
              {plan.outcome !== 'Staged' && plan.outcome !== 'Staging' ? (
                <Text variant="bodyRegular" color="gray120" className="staging-plan-label">
                  {plan.name} · {plan.outcome}
                </Text>
              ) : null}
            </Box>
          </Box>
          {plan.retry ? (
            <Button
              title="Retry staging"
              variant="plain"
              size="sm"
              disabled={running}
              onPress={() =>
                plan.retry === 'create' ? onRetryCreate(plan.planId) : onRetryConfigure(plan.planId)
              }
            />
          ) : null}
        </Box>
      ))}
    </Box>
  );
}

export { projectStagingBatch, stagingOutcome } from './projection';
