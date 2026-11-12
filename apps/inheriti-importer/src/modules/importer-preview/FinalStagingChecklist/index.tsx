import { Stack } from '@main-components';
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
  progress,
  secureHeaderAction,
  planProgress = false,
}: FinalStagingChecklistProps) {
  if (state === 'staged')
    return <StagingSuccess description={description} onStartAgain={onStartAgain} />;

  const failed = state === 'failed-stage' || state === 'retry';
  return (
    <Stack gap="m" className="staging-checklist-surface">
      <Stack gap="m" className="staging-checklist-list">
        <ChecklistRows
          items={items.slice(-2)}
          secureHeaderAction={
            secureHeaderAction ??
            (showActions ? (
              <StageActions
                failed={failed}
                canStage={canStage}
                state={state}
                onStage={onStage}
                onRetry={onRetry}
              />
            ) : null)
          }
          planProgress={planProgress}
          secureAction={progress}
        />
      </Stack>
    </Stack>
  );
}
export default FinalStagingChecklist;
