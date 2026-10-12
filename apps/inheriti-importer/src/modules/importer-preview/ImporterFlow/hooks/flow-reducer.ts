import type { StagingState } from '../../FinalStagingChecklist';
import type { ReviewAsset } from '../../AssetReviewQueue';
import type { GroupingAsset, PlanDraft } from '../../PlanGroupingSurface';
import type { ImporterFlowStage } from './use-importer-flow';
import type { ImportFile } from '../../SourceImportStatus';
import { assignAsset, unassignAsset } from './flow-assignment';
import { reviewAsset } from './flow-review';
import { getImporterFlowReadiness } from '../application/flow-readiness';

export type FlowState = {
  files: ImportFile[];
  stage: ImporterFlowStage;
  stagingState: StagingState;
  selectedAssetId?: string;
  assets: ReviewAsset[];
  unassigned: GroupingAsset[];
  plans: PlanDraft[];
};
export type FlowAction =
  | { type: 'stage'; stage: ImporterFlowStage }
  | { type: 'select-asset'; asset: ReviewAsset }
  | { type: 'review-asset'; action: string; asset: ReviewAsset; autoAdvance: boolean }
  | { type: 'assign-asset'; asset: GroupingAsset; plan: PlanDraft }
  | { type: 'unassign-asset'; asset: GroupingAsset; plan: PlanDraft }
  | { type: 'create-plan'; id: string }
  | { type: 'delete-plan'; id: string }
  | { type: 'stage-import' }
  | {
      type: 'source-status';
      name: string;
      status: ImportFile['status'];
      entries?: number;
      warnings?: number;
    }
  | { type: 'set-staging'; state: StagingState };
export function flowReducer(state: FlowState, action: FlowAction): FlowState {
  if (action.type === 'stage') return { ...state, stage: action.stage };
  if (action.type === 'source-status')
    return {
      ...state,
      stagingState: 'configured',
      files: state.files.map((file) =>
        file.name === action.name
          ? {
              ...file,
              status: action.status,
              entries: action.entries ?? file.entries,
              warnings: action.warnings ?? file.warnings,
            }
          : file,
      ),
    };
  if (action.type === 'set-staging') return { ...state, stagingState: action.state };
  if (action.type === 'select-asset') return { ...state, selectedAssetId: action.asset.id };
  if (action.type === 'review-asset')
    return reviewAsset(state, action.action, action.asset, action.autoAdvance);
  if (action.type === 'assign-asset') return assignAsset(state, action.asset, action.plan);
  if (action.type === 'unassign-asset') return unassignAsset(state, action.asset, action.plan);
  if (action.type === 'create-plan')
    return {
      ...state,
      stagingState: 'configured',
      plans: [
        ...state.plans,
        {
          id: action.id,
          name: `Plan draft ${state.plans.length + 1}`,
          assets: 0,
          capacity: '0 / 10 Assets',
          valid: true,
          assignedAssets: [],
        },
      ],
    };
  if (action.type === 'delete-plan') {
    const removed = state.plans.find((plan) => plan.id === action.id);
    if (!removed) return state;
    return {
      ...state,
      stagingState: 'configured',
      plans: state.plans.filter((plan) => plan.id !== action.id),
      unassigned: [...state.unassigned, ...(removed.assignedAssets ?? [])],
    };
  }
  return getImporterFlowReadiness(state).staging ? { ...state, stagingState: 'releasing' } : state;
}
