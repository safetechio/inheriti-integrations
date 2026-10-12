import { Box, Stack, Text } from '@main-components';
import { ChecklistRows } from './components/ChecklistRows';
import { StageActions } from './components/StageActions';
import { StagingSuccess } from './components/StagingSuccess';
import type { FinalStagingChecklistProps } from './types';
import './styles.css';

export type { ChecklistItem, FinalStagingChecklistProps, StagingState } from './types';
export function FinalStagingChecklist({
  state,
  items,
  description,
  canStage = true,
  onStage,
  onRetry,
  onStartAgain,
  showActions = true,
}: FinalStagingChecklistProps) {
  if (state === 'staged')
    return <StagingSuccess description={description} onStartAgain={onStartAgain} />;

  const failed = state === 'failed-stage' || state === 'retry';
  return (
    <Stack gap="m" className="staging-checklist-surface">
      <Box gap="s">
        <Box gap="xs">
          <Text variant="heading3">Pre-flight</Text>
          {description ? (
            <Text variant="bodySmall" color="gray" style={{ fontSize: 13, opacity: 0.8 }}>
              {description}
            </Text>
          ) : null}
        </Box>
        <Stack gap="m" className="staging-checklist-list">
          <ChecklistRows items={items} />
        </Stack>
      </Box>
      {showActions ? (
        <StageActions
          failed={failed}
          canStage={canStage}
          state={state}
          onStage={onStage}
          onRetry={onRetry}
        />
      ) : null}
    </Stack>
  );
}
export default FinalStagingChecklist;
