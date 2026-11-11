import { Box, Button, Text } from '@main-components';
import type { PlanBatchControllerItem } from '@modules/batch/application/use-plan-batch-controller';
import { projectStagingBatch } from './projection';

export type StagingBatchStatusProps = {
  items: readonly PlanBatchControllerItem[];
  plans: readonly { id: string; name: string }[];
  running: boolean;
  onRetryCreate: (planId: string) => void;
  onRetryConfigure: (planId: string) => void;
  onCancel: () => void;
};

export function StagingBatchStatus({
  items,
  plans,
  running,
  onRetryCreate,
  onRetryConfigure,
  onCancel,
}: StagingBatchStatusProps) {
  if (!items.length) return null;
  const batch = projectStagingBatch(items, plans);
  if (!running && batch.completed === items.length) return null;
  return (
    <Box
      gap="s"
      padding="m"
      backgroundColor="gray5"
      borderColor="gray30"
      borderWidth={1}
      borderRadius="s"
    >
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap="s">
        <Text variant="bodySmall" bold>
          {batch.completed} of {items.length} {items.length === 1 ? 'plan' : 'plans'} staged
        </Text>
        {running ? (
          <Button title="Cancel staging" variant="plain" size="sm" onPress={onCancel} />
        ) : null}
      </Box>
      <Text variant="bodySmall" color="gray">
        {batch.current ? `Current: ${batch.current} · ` : ''}Pending: {batch.pending}
        {batch.cancelled ? ` · Cancelled: ${batch.cancelled}` : ''}
      </Text>
      {batch.plans.map((plan) => (
        <Box
          key={plan.planId}
          flexDirection="row"
          justifyContent="space-between"
          alignItems="center"
          gap="s"
          padding="s"
          backgroundColor="white"
          borderRadius="s"
        >
          <Box flex={1} gap="xs">
            <Text variant="bodySmall">
              {plan.name} · {plan.outcome}
            </Text>
            <Box
              accessibilityRole="progressbar"
              accessibilityLabel={`${plan.name} staging progress`}
              accessibilityValue={{ min: 0, max: 1, now: plan.outcome === 'Staged' ? 1 : 0 }}
              height={6}
              backgroundColor="gray10"
              borderRadius="s"
              overflow="hidden"
            >
              {plan.outcome === 'Staged' ? (
                <Box width="100%" height={6} backgroundColor="success" />
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
