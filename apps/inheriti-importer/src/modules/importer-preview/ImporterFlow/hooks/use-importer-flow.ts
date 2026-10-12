import { useReducer, useRef } from 'react';
import type { StagingState } from '../../FinalStagingChecklist';
import type { ReviewAsset } from '../../AssetReviewQueue';
import type { SensitiveValue } from '@modules/import/domain/import-model';
import type { GroupingAsset, PlanDraft, PlanMetadataValues } from '../../PlanGroupingSurface';
import type { ImportFile } from '../../SourceImportStatus';
import { flowReducer, type FlowState } from './flow-reducer';
import { getImporterFlowReadiness } from '../application/flow-readiness';

export type ImporterFlowStage = 'sources' | 'assets' | 'plans' | 'staging';
export const importerFlowStages: Array<{
  id: ImporterFlowStage;
  label: string;
}> = [
  { id: 'sources', label: 'Import sources' },
  { id: 'assets', label: 'Review Assets' },
  { id: 'plans', label: 'Group Plans' },
  { id: 'staging', label: 'Review & stage' },
];
type InitialState = {
  initialStage?: ImporterFlowStage;
  initialStagingState?: StagingState;
  autoAdvance?: boolean;
  files: ImportFile[];
  assets: ReviewAsset[];
  unassigned: GroupingAsset[];
  plans: PlanDraft[];
};
export type ImporterFlowCallbacks = {
  onAddFiles?: () => void;
  onRetrySource?: (file: ImportFile) => void;
  onUnlockSource?: (file: ImportFile, password: string, keyFile?: ArrayBuffer) => void;
  onViewWarnings?: (file: ImportFile) => void;
  onRemoveSource?: (file: ImportFile) => void;
  onSelectAsset?: (asset: ReviewAsset) => void;
  onReviewAsset?: (action: string, asset: ReviewAsset) => void;
  resolveSourceValue?: (sourceFieldId: string) => SensitiveValue | undefined;
  onMapField?: (asset: ReviewAsset, targetField: string, sourceFieldId?: string) => void;
  onEditPlainText?: (asset: ReviewAsset, value: string) => void;
  onAssignAsset?: (asset: GroupingAsset, plan: PlanDraft) => void;
  onUnassignAsset?: (asset: GroupingAsset, plan: PlanDraft) => void;
  onCreatePlan?: () => void;
  onDeletePlan?: (plan: PlanDraft) => void;
  onUpdatePlan?: (plan: PlanDraft, values: PlanMetadataValues) => void;
  onStage?: () => void;
  onRetryStage?: () => void;
  onCancel?: () => void;
  onRequestOrganizationKey?: () => void;
  onCancelStage?: () => void;
  onSimulateOrganizationKeyRelease?: (recoveryCode: string) => Promise<void> | void;
  onStartAgain?: () => void;
};

export type ControlledImporterFlow = {
  stagingState?: StagingState;
  callbacks: ImporterFlowCallbacks;
};

export function useImporterFlow(initial: InitialState, controlled?: ControlledImporterFlow) {
  const stagingRevision = useRef(0);
  const [state, dispatch] = useReducer(flowReducer, {
    stage: initial.initialStage ?? 'sources',
    files: initial.files,
    stagingState: initial.initialStagingState ?? 'idle',
    selectedAssetId: undefined,
    assets: initial.assets,
    unassigned: initial.unassigned,
    plans: initial.plans,
  } as FlowState);
  const index = importerFlowStages.findIndex((item) => item.id === state.stage);
  const isControlled = Boolean(controlled);
  const files = isControlled ? initial.files : state.files;
  const assets = isControlled ? initial.assets : state.assets;
  const unassigned = isControlled ? initial.unassigned : state.unassigned;
  const plans = isControlled ? initial.plans : state.plans;
  const stagingState = isControlled
    ? (controlled?.stagingState ?? state.stagingState)
    : state.stagingState;
  const selectedAssetId = (() => {
    if (!isControlled || !state.selectedAssetId) return state.selectedAssetId;
    if (assets.some((asset) => asset.id === state.selectedAssetId)) return state.selectedAssetId;
    const separator = state.selectedAssetId.lastIndexOf(':');
    if (separator < 0) return state.selectedAssetId;
    const nodeId = state.selectedAssetId.slice(0, separator);
    return assets.find((asset) => asset.id.slice(0, asset.id.lastIndexOf(':')) === nodeId)?.id;
  })();
  const readiness = getImporterFlowReadiness({ files, assets, unassigned, plans });
  const currentReady = canEnterNextStage(state.stage, readiness);
  return {
    ...state,
    selectedAssetId,
    files,
    assets,
    unassigned,
    plans,
    stagingState,
    index,
    isControlled,
    cancel: controlled?.callbacks.onCancel,
    onAddFiles: () => controlled?.callbacks.onAddFiles?.(),
    onViewWarnings: (file: ImportFile) => controlled?.callbacks.onViewWarnings?.(file),
    removeSource: (file: ImportFile) => controlled?.callbacks.onRemoveSource?.(file),
    retryStage: () => controlled?.callbacks.onRetryStage?.(),
    requestOrganizationKey: () => controlled?.callbacks.onRequestOrganizationKey?.(),
    startAgain: () => controlled?.callbacks.onStartAgain?.(),
    cancelStage: () => controlled?.callbacks.onCancelStage?.(),
    simulateOrganizationKeyRelease: (recoveryCode: string) =>
      controlled?.callbacks.onSimulateOrganizationKeyRelease?.(recoveryCode),
    canGoBack: index > 0,
    readiness,
    canGoNext: index < importerFlowStages.length - 1 && currentReady,
    goBack: () =>
      dispatch({
        type: 'stage',
        stage: importerFlowStages[Math.max(0, index - 1)].id,
      }),
    goNext: () => {
      if (!currentReady) return;
      dispatch({
        type: 'stage',
        stage: importerFlowStages[Math.min(importerFlowStages.length - 1, index + 1)].id,
      });
    },
    goTo: (stage: ImporterFlowStage) => {
      const target = importerFlowStages.findIndex((item) => item.id === stage);
      if (target > index && !canEnterStage(stage, readiness)) return;
      dispatch({ type: 'stage', stage });
    },
    selectAsset: (asset: ReviewAsset) => {
      controlled?.callbacks.onSelectAsset?.(asset);
      dispatch({ type: 'select-asset', asset });
    },
    reviewAsset: (action: string, asset: ReviewAsset) => {
      if (isControlled) {
        controlled?.callbacks.onReviewAsset?.(action, asset);
        return;
      }
      stagingRevision.current += 1;
      dispatch({
        type: 'review-asset',
        action,
        asset,
        autoAdvance: initial.autoAdvance ?? true,
      });
    },
    resolveSourceValue: controlled?.callbacks.resolveSourceValue,
    mapField: (asset: ReviewAsset, targetField: string, sourceFieldId?: string) => {
      controlled?.callbacks.onMapField?.(asset, targetField, sourceFieldId);
    },
    editPlainText: (asset: ReviewAsset, value: string) => {
      controlled?.callbacks.onEditPlainText?.(asset, value);
    },
    assignAsset: (asset: GroupingAsset, plan: PlanDraft) => {
      if (isControlled) {
        controlled?.callbacks.onAssignAsset?.(asset, plan);
        return;
      }
      stagingRevision.current += 1;
      dispatch({ type: 'assign-asset', asset, plan });
    },
    unassignAsset: (asset: GroupingAsset, plan: PlanDraft) => {
      if (isControlled) {
        controlled?.callbacks.onUnassignAsset?.(asset, plan);
        return;
      }
      stagingRevision.current += 1;
      dispatch({ type: 'unassign-asset', asset, plan });
    },
    createPlan: () => {
      if (isControlled) {
        controlled?.callbacks.onCreatePlan?.();
        return;
      }
      const id = `plan-${Math.max(0, ...plans.map((plan) => Number(plan.id.match(/^plan-(\d+)$/)?.[1] ?? 0))) + 1}`;
      stagingRevision.current += 1;
      dispatch({ type: 'create-plan', id });
      return id;
    },
    deletePlan: (plan: PlanDraft) => {
      if (isControlled) controlled?.callbacks.onDeletePlan?.(plan);
      else dispatch({ type: 'delete-plan', id: plan.id });
    },
    updatePlan: isControlled ? controlled?.callbacks.onUpdatePlan : undefined,
    markStaged: () => {
      if (!readiness.staging) return;
      if (isControlled) {
        controlled?.callbacks.onStage?.();
        return;
      }
      const revision = stagingRevision.current + 1;
      stagingRevision.current = revision;
      dispatch({ type: 'stage-import' });
      window.setTimeout(() => {
        if (stagingRevision.current === revision)
          dispatch({ type: 'set-staging', state: 'encrypting' });
      }, 900);
      window.setTimeout(() => {
        if (stagingRevision.current === revision)
          dispatch({ type: 'set-staging', state: 'staged' });
      }, 2900);
    },
    unlockSource: (file: ImportFile, password: string, keyFile?: ArrayBuffer) => {
      if (isControlled) {
        controlled?.callbacks.onUnlockSource?.(file, password, keyFile);
        return;
      }
      stagingRevision.current += 1;
      dispatch({
        type: 'source-status',
        name: file.name,
        status: 'imported',
        entries: 24,
        warnings: 0,
      });
    },
    retrySource: (file: ImportFile) => {
      if (isControlled) {
        controlled?.callbacks.onRetrySource?.(file);
        return;
      }
      stagingRevision.current += 1;
      dispatch({ type: 'source-status', name: file.name, status: 'retrying' });
      window.setTimeout(
        () =>
          dispatch({
            type: 'source-status',
            name: file.name,
            status: 'imported',
            entries: 12,
            warnings: 0,
          }),
        1100,
      );
    },
  };
}

function canEnterNextStage(
  stage: ImporterFlowStage,
  readiness: ReturnType<typeof getImporterFlowReadiness>,
) {
  switch (stage) {
    case 'sources':
      return readiness.sources;
    case 'assets':
      return readiness.sources && readiness.assets;
    case 'plans':
      return readiness.staging;
    default:
      return false;
  }
}

function canEnterStage(
  stage: ImporterFlowStage,
  readiness: ReturnType<typeof getImporterFlowReadiness>,
) {
  switch (stage) {
    case 'assets':
      return readiness.sources;
    case 'plans':
      return readiness.sources && readiness.assets;
    case 'staging':
      return readiness.staging;
    default:
      return true;
  }
}
