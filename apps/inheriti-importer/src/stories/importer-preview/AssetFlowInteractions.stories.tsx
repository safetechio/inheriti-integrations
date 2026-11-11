import { useState } from 'react';
import { ImporterFlow } from '@modules/importer-preview/ImporterFlow';
import type { ReviewAsset } from '@modules/importer-preview/AssetReviewQueue';
import { useImporterWorkspace } from '@modules/importer-preview/ImporterFlow/application/importer-workspace';
import type { ImporterWorkspaceAction } from '@modules/importer-preview/ImporterFlow/application/importer-workspace-types';
import { AppHeader } from '@modules/import/ui/components/AppHeader';
import { getCorePlanAssetTypes } from '@modules/plans/domain/asset-metadata';
import { createEmptyWorkspace, type WorkspaceState } from '@modules/plans/domain/workspace-model';
import {
  createHistory,
  pushHistory,
  replaceHistory,
} from '@modules/plans/domain/workspace-history';
import { clearWorkspaceLiterals } from '@modules/importer-preview/ImporterFlow/application/importer-workspace';
import { ShellFixture } from './shell-fixtures';
import { createAssetFlowFixture } from './asset-flow-fixture';

export const SyntheticControlledAssetFlow = () => {
  const [{ session, files }] = useState(createAssetFlowFixture);
  const [history, setHistory] = useState(() => createHistory(createEmptyWorkspace()));
  const setWorkspace = (next: WorkspaceState | ((current: WorkspaceState) => WorkspaceState)) =>
    setHistory((current) =>
      pushHistory(current, typeof next === 'function' ? next(current.present) : next),
    );
  const replaceWorkspace = (
    next: (current: WorkspaceState) => WorkspaceState,
    discard: (workspace: WorkspaceState) => void,
  ) => setHistory((current) => replaceHistory(current, next(current.present), discard));
  const workspace = useImporterWorkspace(session, history.present, setWorkspace, replaceWorkspace);
  const reviewAsset = (action: string, asset: ReviewAsset) => {
    if (
      action === 'accept' ||
      action === 'exclude' ||
      action === 'restore-suggestion' ||
      getCorePlanAssetTypes().some((type) => action === `alternate:${type}`)
    )
      workspace.reviewAsset(action as ImporterWorkspaceAction, asset);
  };
  const reset = () => {
    workspace.resetReview();
    setHistory((current) =>
      replaceHistory(current, createEmptyWorkspace(), clearWorkspaceLiterals),
    );
  };

  return (
    <ShellFixture>
      <ImporterFlow
        headerActions={<AppHeader dirtyCount={0} />}
        initialStage="assets"
        autoAdvance={false}
        files={files}
        assets={workspace.assets}
        unassigned={workspace.unassigned}
        plans={workspace.plans}
        checklist={[]}
        stagingState="waiting-release"
        stagingReady={false}
        callbacks={{
          onReviewAsset: reviewAsset,
          resolveSourceValue: workspace.resolveSourceValue,
          onMapField: workspace.mapAssetField,
          onEditPlainText: workspace.editPlainText,
          onAssignAsset: workspace.assignAsset,
          onUnassignAsset: workspace.unassignAsset,
          onCreatePlan: workspace.createPlan,
          onEnsureFirstPlan: workspace.ensureFirstPlan,
          onDeletePlan: workspace.deletePlan,
          onUpdatePlan: workspace.updatePlanMetadata,
          onCancel: reset,
          onStartAgain: reset,
        }}
      />
    </ShellFixture>
  );
};
