export type StagingState =
  | 'idle'
  | 'configured'
  | 'waiting-release'
  | 'releasing'
  | 'verified'
  | 'encrypted'
  | 'encrypting'
  | 'staged'
  | 'failed-stage'
  | 'retry';
export interface ChecklistItem {
  label: string;
  detail: string;
  complete: boolean;
  loading?: boolean;
  error?: string;
  onFix?: () => void;
  fixLabel?: string;
  onSecondaryFix?: () => void;
  secondaryFixLabel?: string;
}
export interface FinalStagingChecklistProps {
  state: StagingState;
  items: ChecklistItem[];
  description?: string;
  canStage?: boolean;
  onStage?: () => void;
  onRetry?: () => void;
  onStartAgain?: () => void;
  showActions?: boolean;
  blockerCount?: number;
}
