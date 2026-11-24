import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text } from '@main-components';
import { useImportLifecycle } from '@modules/import/application/use-import-lifecycle';
import { importSessionFromVaultState } from '@modules/import/infrastructure/stores/vault-session-adapter';
import { ImporterFlow } from '@modules/importer-preview/ImporterFlow';
import { useImporterWorkspace } from '@modules/importer-preview/ImporterFlow/application/importer-workspace';
import { projectImportSources } from '@modules/importer-preview/ImporterFlow/application/import-source-projection';
import type { ImportFile } from '@modules/importer-preview/SourceImportStatus';
import { SourceWarningsModal } from '@modules/importer-preview/SourceImportStatus/components/SourceWarningsModal';
import { createEmptyWorkspace } from '@modules/plans/domain/workspace-model';
import { listPlanDrafts } from '@modules/plans/domain/workspace-selectors';
import { usePlanBatch } from '@modules/batch/application/use-plan-batch';
import { usePlanBatchEntries } from '@modules/batch/application/use-plan-batch-entries';
import { usePlanBatchStaging } from '@modules/batch/application/use-plan-batch-staging';
import { freezeBatchSnapshot } from '@modules/batch/application/batch-snapshot';
import type { OrganizationKeyRelease } from '@modules/batch/application/use-organization-key-release';
import { ImporterToolRepo } from '@modules/batch/infrastructure/importer-tool-repo';
import {
  auditStaged,
  memberId,
  organizationId,
  StagingTransport,
  syntheticKey,
} from './staging-transport';
import type { ImporterWorkspaceAction } from '@modules/importer-preview/ImporterFlow/application/importer-workspace';
import type { StagingState } from '@modules/importer-preview/FinalStagingChecklist';

const keyRelease: OrganizationKeyRelease = {
  state: {
    activePlanId: null,
    step: 'idle',
    error: null,
    localKeyAvailable: true,
    canSimulateLocally: false,
  },
  acquire: async () => syntheticKey,
  cancel: () => {},
  simulateLocalRelease: async () => {},
};

export function PreservationContext({ onReset }: { onReset: () => void }) {
  const imports = useImportLifecycle();
  const [state, setState] = useState(createEmptyWorkspace);
  const [reviewRevision, setReviewRevision] = useState(0);
  const [warnings, setWarnings] = useState<ImportFile | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const session = useMemo(() => importSessionFromVaultState(imports.state), [imports.state]);
  const files = useMemo(() => projectImportSources(imports.state), [imports.state]);
  const preservationRevision = useMemo(() => Symbol(), [state, session, reviewRevision]);
  const workspace = useImporterWorkspace(session, state, setState, undefined, () =>
    setReviewRevision((revision) => revision + 1),
  );
  const [{ transport, repo }] = useState(() => {
    const transport = new StagingTransport();
    return { transport, repo: new ImporterToolRepo(transport) };
  });
  const plans = useMemo(() => listPlanDrafts(state), [state]);
  const entries = usePlanBatchEntries({
    plans,
    session,
    organizationId,
    currentMemberId: memberId,
    approvalMode: undefined,
    totalShares: 3,
    preservationRevision,
  });
  const batch = usePlanBatch(
    usePlanBatchStaging({
      session,
      organizationId,
      currentMemberId: memberId,
      keyRelease,
      importerToolRepo: repo,
      preservationReady: workspace.executionCoverage.ready,
      preservationRevision,
    }),
  );
  const staged =
    !batch.running &&
    workspace.executionCoverage.ready &&
    batch.items.length > 0 &&
    batch.items.length === entries.length &&
    batch.items.every(
      (item) =>
        item.status === 'COMPLETE' && item.input.preservationRevision === preservationRevision,
    );
  const failed = batch.result.failed.length + batch.result.createdUnconfigured.length;
  const stagingState: StagingState = batch.running
    ? 'encrypting'
    : staged
      ? 'staged'
      : failed
        ? 'retry'
        : 'configured';
  const [audit, setAudit] = useState<Awaited<ReturnType<typeof auditStaged>>>();
  const [auditError, setAuditError] = useState('');
  useEffect(() => {
    if (!staged) return;
    let active = true;
    void auditStaged(transport, batch.items, session, workspace.executionCoverage)
      .then((result) => {
        if (active) setAudit(result);
      })
      .catch((error: Error) => {
        if (active) setAuditError(error.message);
      });
    return () => {
      active = false;
    };
  }, [staged, transport, batch.items, session, workspace.executionCoverage]);

  const showFixtureControls =
    files.length === 0 && new URLSearchParams(window.location.search).has('fixture-controls');
  return (
    <>
      <Box
        flexDirection="row"
        alignItems="center"
        gap="m"
        padding="xs"
        flexWrap="wrap"
        style={{ display: showFixtureControls ? 'flex' : 'none' }}
      >
        <label>
          Import fixture files
          <input
            ref={input}
            aria-label="Import fixture files"
            type="file"
            multiple
            onChange={async (event) => {
              const files = [...(event.currentTarget.files ?? [])];
              event.currentTarget.value = '';
              await imports.importFiles(
                await Promise.all(
                  files.map(async (file) => ({
                    name: file.name,
                    data: await file.arrayBuffer(),
                  })),
                ),
              );
            }}
          />
        </label>
        <label>
          <input
            type="checkbox"
            defaultChecked
            onChange={(event) => {
              transport.failSecond = event.currentTarget.checked;
            }}
          />
          Fail the second staged write once
        </label>
      </Box>
      <Box style={{ display: 'none' }}>
        <Text testID="fixture-import-count">{imports.state.entries.length}</Text>
        <Text testID="fixture-stage-result">
          {JSON.stringify({
            ready: workspace.executionCoverage.ready,
            entries: entries.length,
            running: batch.running,
            attempts: transport.attempts,
            writes: transport.writes.size,
            failed,
            audit,
            auditError,
          })}
        </Text>
      </Box>
      {files.length > 0 ? (
        <ImporterFlow
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
          checklist={[
            {
              label: 'Organization Key',
              detail: 'Synthetic organization key available',
              complete: true,
            },
            { label: 'Secure staging', detail: 'Encrypted local transport', complete: staged },
          ]}
          stagingState={stagingState}
          stagingReady={workspace.executionCoverage.ready}
          organizationKeyLoaded
          stagingBatch={{
            items: batch.items,
            running: batch.running,
            onRetryCreate: batch.retryCreate,
            onRetryConfigure: batch.retryConfigure,
            onCancel: batch.cancel,
          }}
          callbacks={{
            onAddFiles: () => input.current?.click(),
            onViewWarnings: setWarnings,
            onRemoveSource: (file) => {
              if (!file.id) return;
              workspace.removeSource(file.id);
              imports.removeSource(file.id);
            },
            onReviewAsset: (action, asset) =>
              workspace.reviewAsset(action as ImporterWorkspaceAction, asset),
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
            onAssignAssets: workspace.assignAssets,
            onUnassignAsset: workspace.unassignAsset,
            onUnassignAssets: workspace.unassignAssets,
            onAutoGroupUnassigned: workspace.autoGroupUnassigned,
            onCreatePlan: workspace.createPlan,
            onCreatePlansFromAssets: workspace.createPlansFromAssets,
            onDeletePlan: workspace.deletePlan,
            onDeletePlans: workspace.deletePlans,
            onUpdatePlan: workspace.updatePlanMetadata,
            onStage: () => {
              void batch.run(freezeBatchSnapshot(entries));
            },
            onCancel: onReset,
            onStartAgain: onReset,
          }}
        />
      ) : null}
      <SourceWarningsModal
        file={warnings}
        onDismiss={() => setWarnings(null)}
      />
    </>
  );
}
