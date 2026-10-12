import { useEffect, useMemo, useState } from 'react';
import { AuthGate } from '@/modules/auth/ui';
import { BaseModal, Text } from '@modules/_shared/ui/components';
import Button from '@modules/_shared/ui/components/Base/Button';
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
  pushHistory,
  replaceHistory,
} from '@modules/plans/domain/workspace-history';
import { listPlanDrafts } from '@modules/plans/domain/workspace-selectors';
import type { WorkspaceState } from '@modules/plans/domain/workspace-model';
import { createEmptyWorkspace } from '@modules/plans/domain/workspace-model';
import { usePlanBatchController } from '@modules/batch/application/use-plan-batch-controller';

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
    detail: 'The Organization Key encrypts every field locally before staging.',
    complete: false,
  },
];

export function App() {
  return (
    <AuthGate>
      <AuthenticatedImporter />
    </AuthGate>
  );
}

function AuthenticatedImporter() {
  const imports = useImportLifecycle();
  const [workspaceHistory, setWorkspaceHistory] = useState(() =>
    createHistory(createEmptyWorkspace()),
  );
  const [warningFile, setWarningFile] = useState<ImportFile | null>(null);
  const [stagingComplete, setStagingComplete] = useState(false);
  const planWorkspace = workspaceHistory.present;
  const importSession = useMemo(() => importSessionFromVaultState(imports.state), [imports.state]);
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
  );
  const batchController = usePlanBatchController({
    plans: listPlanDrafts(planWorkspace),
    session: importSession,
    onSuccess: () => setStagingComplete(true),
  });

  useEffect(() => {
    document.documentElement.classList.toggle('has-electron', Boolean(window.inheriti));
  }, []);

  function discardAll() {
    batchController.cancel();
    setStagingComplete(false);
    imports.purge();
    workspace.resetReview();
    setWorkspaceHistory((history) =>
      replaceHistory(history, createEmptyWorkspace(), clearWorkspaceLiterals),
    );
    setWarningFile(null);
  }

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
    if (
      action === 'accept' ||
      action === 'exclude' ||
      action === 'alternate:PLAIN-TEXT' ||
      action === 'restore-suggestion'
    ) {
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
      <AppShell dirtyCount={0}>
        <ImportPanel
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
          files={files}
          assets={workspace.assets}
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
            resolveSourceValue: workspace.resolveSourceValue,
            onMapField: workspace.mapAssetField,
            onEditPlainText: workspace.editPlainText,
            onAssignAsset: workspace.assignAsset,
            onUnassignAsset: workspace.unassignAsset,
            onCreatePlan: workspace.createPlan,
            onDeletePlan: workspace.deletePlan,
            onUpdatePlan: workspace.updatePlanMetadata,
            onCancel: discardAll,
            onRequestOrganizationKey: batchController.requestOrganizationKey,
            onCancelStage: batchController.cancelOrganizationKeyRequest,
            onSimulateOrganizationKeyRelease: batchController.organizationKey.simulateLocalRelease,
            onStage: batchController.execute,
            onStartAgain: discardAll,
          }}
        />
        <BaseModal
          visible={Boolean(warningFile)}
          title={warningFile ? `Warnings from ${warningFile.name}` : 'Import warnings'}
          description="The source was imported. Review these parser warnings before continuing."
          onDismiss={() => setWarningFile(null)}
          footer={<Button title="Close" onPress={() => setWarningFile(null)} />}
        >
          {warningFile?.warningMessages?.map((warning, index) => (
            <Text
              key={`${warningFile.id ?? warningFile.name}-warning-${index}`}
              variant="bodySmall"
              color="warning200"
            >
              {warning}
            </Text>
          ))}
        </BaseModal>
      </>
    );

  return (
    <VaultContext.Provider value={{ state: imports.state, dispatch: imports.dispatch }}>
      {content}
    </VaultContext.Provider>
  );
}
