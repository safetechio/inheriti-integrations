import { useEffect, useMemo, useState } from 'react';
import { AuthGate } from '@/modules/auth/ui';
import { UpdateGate } from '@modules/_shared/ui/components/UpdateStatus/UpdateGate';
import { SourceWarningsModal } from '@modules/importer-preview/SourceImportStatus/components/SourceWarningsModal';
import { AppHeader } from '@modules/import/ui/components/AppHeader';
import { openVaultFiles } from '@modules/_shared/infrastructure/files';
import { useImportLifecycle } from '@modules/import/application/use-import-lifecycle';
import { VaultContext } from '@modules/import/infrastructure/stores/vault-context';
import { importSessionFromVaultState } from '@modules/import/infrastructure/stores/vault-session-adapter';
import { AppShell } from '@modules/import/ui/components/AppShell';
import { ImportPanel } from '@modules/import/ui/components/ImportPanel';
import type { ReviewAsset } from '@modules/importer-preview/AssetReviewQueue';
import type { ChecklistItem } from '@modules/importer-preview/FinalStagingChecklist';
import { ImporterFlow } from '@modules/importer-preview/ImporterFlow';
import { projectImportSources } from '@modules/importer-preview/ImporterFlow/application/import-source-projection';
import {
  clearWorkspaceLiterals,
  useImporterWorkspace,
} from '@modules/importer-preview/ImporterFlow/application/importer-workspace';
import type { ImportFile } from '@modules/importer-preview/SourceImportStatus';
import {
  createHistory,
  getFolderHistoryControls,
  pushHistory,
  replaceHistory,
  resetHistory,
} from '@modules/plans/domain/workspace-history';
import { listPlanDrafts } from '@modules/plans/domain/workspace-selectors';
import type { WorkspaceState } from '@modules/plans/domain/workspace-model';
import { createEmptyWorkspace } from '@modules/plans/domain/workspace-model';
import { usePlanBatchController } from '@modules/batch/application/use-plan-batch-controller';
import { secureCleanup } from '@modules/_shared/application/secure-cleanup-controller';
import { useAuthProvider } from '@shared/infrastructure/importer-api';
import type { ElectronAuthProvider } from '@modules/auth/infrastructure/electron-auth-provider';
import { getImportablePlanAssetTypes } from '@modules/plans/domain/asset-metadata';
import type { ImporterWorkspaceAction } from '@modules/importer-preview/ImporterFlow/application/importer-workspace-types';
import { useImporterFolders } from '@modules/organization/application/use-importer-folders';
import { useGetSelectedOrganizationId } from '@modules/organization/infrastructure/selected-organization-api';

const stagingChecklist: ChecklistItem[] = [
  {
    label: 'Imported sources reviewed',
    detail: 'Warnings and source failures remain visible.',
    complete: false,
  },
  {
    label: 'Suggestions reviewed',
    detail: 'Every detected Asset needs an explicit decision.',
    complete: false,
  },
  {
    label: 'Plan assignment',
    detail: 'Every accepted Asset needs a valid Plan draft.',
    complete: false,
  },
  {
    label: 'Organization Key',
    detail: 'Release the Organization Key from SafeKey Mobile to continue.',
    complete: false,
  },
  {
    label: 'Encryption',
    detail: 'The Organization Key encrypts protected fields locally before staging.',
    complete: false,
  },
];

export function App() {
  return (
    <AuthGate>
      <UpdateGate>
        <AuthenticatedImporter />
      </UpdateGate>
    </AuthGate>
  );
}

function AuthenticatedImporter() {
  const organizationId = useGetSelectedOrganizationId();
  const folders = useImporterFolders();
  const authProvider = useAuthProvider() as ElectronAuthProvider;
  const imports = useImportLifecycle();
  const [workspaceHistory, setWorkspaceHistory] = useState(() =>
    createHistory(createEmptyWorkspace()),
  );
  const [warningFile, setWarningFile] = useState<ImportFile | null>(null);
  const [stagingComplete, setStagingComplete] = useState(false);
  const [reviewRevision, setReviewRevision] = useState(0);
  const planHistory = getFolderHistoryControls(workspaceHistory, organizationId ? folders : null);
  const planWorkspace = workspaceHistory.present;
  const importSession = useMemo(() => importSessionFromVaultState(imports.state), [imports.state]);
  const preservationRevision = useMemo(
    () => Symbol(),
    [planWorkspace, importSession, reviewRevision],
  );
  const files = useMemo(() => projectImportSources(imports.state), [imports.state]);

  function setPlanWorkspace(next: WorkspaceState | ((current: WorkspaceState) => WorkspaceState)) {
    setWorkspaceHistory((history) =>
      pushHistory(history, typeof next === 'function' ? next(history.present) : next),
    );
  }

  function replacePlanWorkspace(
    next: (current: WorkspaceState) => WorkspaceState,
    discard: (workspace: WorkspaceState) => void,
  ) {
    setWorkspaceHistory((history) => replaceHistory(history, next(history.present), discard));
  }

  const workspace = useImporterWorkspace(
    importSession,
    planWorkspace,
    setPlanWorkspace,
    replacePlanWorkspace,
    // Review state is separate; old plan snapshots must not restore excluded or remapped assets.
    () => {
      setWorkspaceHistory(resetHistory);
      setReviewRevision((revision) => revision + 1);
    },
  );
  const batchController = usePlanBatchController({
    plans: listPlanDrafts(planWorkspace),
    session: importSession,
    preservationReady: workspace.executionCoverage.ready,
    preservationRevision,
    onSuccess: () => setStagingComplete(true),
  });

  useEffect(() => {
    document.documentElement.classList.toggle('has-electron', Boolean(window.inheriti));
  }, []);

  function discardAll() {
    batchController.reset();
    setStagingComplete(false);
    imports.purge();
    workspace.resetReview();
    setWorkspaceHistory((history) =>
      replaceHistory(history, createEmptyWorkspace(), clearWorkspaceLiterals),
    );
    setWarningFile(null);
  }

  useEffect(() => secureCleanup.register(discardAll));
  useEffect(() =>
    authProvider.blockTransitionsWhile(
      () =>
        imports.busy ||
        files.length > 0 ||
        batchController.running ||
        Boolean(batchController.organizationKey.activePlanId),
    ),
  );

  const releaseCancelled =
    batchController.organizationKey.error === 'Organization Key release was cancelled.';
  const stagingFailed =
    batchController.result.failed.length > 0 ||
    batchController.result.createdUnconfigured.length > 0;
  const stagingState = stagingComplete
    ? 'staged'
    : batchController.organizationKey.activePlanId &&
        !batchController.organizationKey.localKeyAvailable
      ? 'releasing'
      : batchController.running
        ? 'encrypting'
        : stagingFailed
          ? 'retry'
          : batchController.organizationKey.localKeyAvailable
            ? 'configured'
            : releaseCancelled || batchController.result.cancelled.length
              ? 'waiting-release'
              : 'waiting-release';
  const stagingReady = batchController.ready;

  function reviewAsset(action: string, asset: ReviewAsset) {
    if (isSupportedReviewAction(action)) {
      workspace.reviewAsset(action, asset);
    }
  }

  function removeSource(file: ImportFile) {
    if (!file.id) return;
    workspace.removeSource(file.id);
    imports.removeSource(file.id);
    if (warningFile?.id === file.id) setWarningFile(null);
  }

  const content =
    files.length === 0 ? (
      <AppShell dirtyCount={0} accountActionsDisabled={imports.busy}>
        <ImportPanel
          key={organizationId}
          busy={imports.busy}
          error={null}
          onImport={async (selectedFiles) => {
            await imports.importFiles(selectedFiles);
          }}
        />
      </AppShell>
    ) : (
      <>
        <ImporterFlow
          showQuickGuideOnFirstVisit
          folders={folders}
          headerActions={
            <AppHeader
              dirtyCount={0}
              accountActionsDisabled={imports.busy || batchController.running}
            />
          }
          files={files}
          assets={workspace.assets}
          preservation={{
            coverage: workspace.coverage,
            fieldOperations: workspace.fieldOperations,
            onRenameAsset: workspace.renameAsset,
            noteSources: workspace.noteSources,
            onSetSourceNoteDestination: workspace.setSourceNoteDestination,
            onSetAssetNoteDestination: workspace.setAssetNoteDestination,
            onPreserveFields: workspace.preserveFields,
            onExcludeFields: workspace.excludeFields,
          }}
          executionCoverage={workspace.executionCoverage}
          unassigned={workspace.unassigned}
          plans={workspace.plans}
          checklist={stagingChecklist}
          stagingState={stagingState}
          stagingReady={stagingReady}
          organizationKeyLoaded={batchController.organizationKey.localKeyAvailable === true}
          organizationKeyError={releaseCancelled ? null : batchController.organizationKey.error}
          canSimulateOrganizationKeyRelease={batchController.organizationKey.canSimulateLocally}
          stagingBatch={{
            items: batchController.items,
            running: batchController.running,
            onRetryCreate: batchController.retryCreate,
            onRetryConfigure: batchController.retryConfigure,
            onCancel: batchController.cancel,
          }}
          callbacks={{
            onAddFiles: async () => imports.importFiles(await openVaultFiles()),
            onRetrySource: (file) => (file.id ? void imports.retrySource(file.id) : undefined),
            onUnlockSource: (file, password, keyFile) =>
              file.id ? void imports.unlockSource(file.id, password, keyFile) : undefined,
            onViewWarnings: setWarningFile,
            onRemoveSource: removeSource,
            onReviewAsset: reviewAsset,
            onReviewAssets: workspace.reviewAssets,
            onUndoReviewBatch: workspace.undoReviewBatch,
            canUndoReviewBatch: workspace.canUndoReviewBatch,
            onApplyMappings: workspace.applyMappings,
            onAcceptAllEligible: workspace.acceptAllEligible,
            onUndoAcceptAll: workspace.undoAcceptAll,
            resolveSourceValue: workspace.resolveSourceValue,
            onMapField: workspace.mapAssetField,
            onEditPlainText: workspace.editPlainText,
            onAssignAsset: workspace.assignAsset,
            onUnassignAsset: workspace.unassignAsset,
            onAssignAssets: workspace.assignAssets,
            onUnassignAssets: workspace.unassignAssets,
            onAutoGroupUnassigned: workspace.autoGroupUnassigned,
            canUndoPlans: planHistory.canUndo && !batchController.running,
            canRedoPlans: planHistory.canRedo && !batchController.running,
            onUndoPlans: () => {
              if (!batchController.running) setWorkspaceHistory(planHistory.undo);
            },
            onRedoPlans: () => {
              if (!batchController.running) setWorkspaceHistory(planHistory.redo);
            },
            onCreatePlan: workspace.createPlan,
            onCreatePlansFromAssets: workspace.createPlansFromAssets,
            onEnsureFirstPlan: workspace.ensureFirstPlan,
            onDeletePlan: workspace.deletePlan,
            onDeletePlans: workspace.deletePlans,
            onUpdatePlan: workspace.updatePlanMetadata,
            onMovePlans: workspace.movePlansToFolder,
            onCancel: discardAll,
            onRequestOrganizationKey: batchController.requestOrganizationKey,
            onCancelStage: batchController.cancelOrganizationKeyRequest,
            onSimulateOrganizationKeyRelease: batchController.organizationKey.simulateLocalRelease,
            onStage: batchController.execute,
            onStartAgain: discardAll,
          }}
        />
        <SourceWarningsModal
          file={warningFile}
          onDismiss={() => setWarningFile(null)}
        />
      </>
    );

  return (
    <VaultContext.Provider value={{ state: imports.state, dispatch: imports.dispatch }}>
      {content}
    </VaultContext.Provider>
  );
}

function isSupportedReviewAction(action: string): action is ImporterWorkspaceAction {
  return (
    action === 'accept' ||
    action === 'exclude' ||
    action === 'restore' ||
    action === 'restore-suggestion' ||
    getImportablePlanAssetTypes().some((type) => action === `alternate:${type}`)
  );
}
