import { Box, Button, Text } from '@main-components';
import { memo } from 'react';
import type { StagingBatchPlan } from '../../projection';

type PlanStatusRowProps = StagingBatchPlan & {
  embedded: boolean;
  retryDisabled: boolean;
  onRetry: (retry: NonNullable<StagingBatchPlan['retry']>, planId: string) => void;
};

export const PlanStatusRow = memo(function PlanStatusRow({
  planId,
  name,
  outcome,
  retry,
  embedded,
  retryDisabled,
  onRetry,
}: PlanStatusRowProps) {
  return (
    <Box flexDirection="row" alignItems="center" gap="s">
      <Box flex={1}>
        <Box
          accessibilityRole="progressbar"
          accessibilityLabel={`${name}: ${outcome}`}
          aria-valuemin={outcome === 'Staging' ? undefined : 0}
          aria-valuemax={outcome === 'Staging' ? undefined : 100}
          aria-valuenow={outcome === 'Staging' ? undefined : outcome === 'Staged' ? 100 : 0}
          aria-valuetext={outcome}
          ref={(element) => element?.setAttribute('title', `${name}: ${outcome}`)}
          height={22}
          backgroundColor="gray10"
          borderRadius="pill"
          overflow="hidden"
          className="staging-plan-track"
        >
          {outcome === 'Staged' || outcome === 'Staging' ? (
            <Box
              width={outcome === 'Staged' ? '100%' : 100}
              height={22}
              className={`staging-plan-fill ${outcome === 'Staging' ? 'is-active' : ''}`}
            >
              <Text variant="bodySmall" color="white" className="staging-plan-label">
                {embedded ? name : `${name} · ${outcome}`}
              </Text>
            </Box>
          ) : null}
          {outcome !== 'Staged' && outcome !== 'Staging' ? (
            <Text variant="bodySmall" color="gray120" className="staging-plan-label">
              {name} · {outcome}
            </Text>
          ) : null}
        </Box>
      </Box>
      {retry ? (
        <Button
          title="Retry staging"
          variant="plain"
          size="sm"
          disabled={retryDisabled}
          onPress={() => onRetry(retry, planId)}
        />
      ) : null}
    </Box>
  );
});
