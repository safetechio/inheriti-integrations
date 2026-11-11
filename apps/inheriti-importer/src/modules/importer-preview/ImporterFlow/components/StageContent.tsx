import { AssetReviewQueue } from '../../AssetReviewQueue';
import { FinalStagingChecklist, type ChecklistItem } from '../../FinalStagingChecklist';
import { PlanGroupingSurface, type PlanDraft } from '../../PlanGroupingSurface';
import { SourceImportStatus } from '../../SourceImportStatus';
import { StagingBatchStatus, type StagingBatchStatusProps } from '../../StagingBatchStatus';
import { Stack } from '@main-components';
import type { ImporterFlowReadiness } from '../application/flow-readiness';
import { type ImporterFlowStage, useImporterFlow } from '../hooks/use-importer-flow';

type ImporterFlowState = ReturnType<typeof useImporterFlow>;
type StageContentProps = {
  stage: ImporterFlowStage;
  description: string;
  checklist: ChecklistItem[];
  flow: ImporterFlowState;
  selectedPlanId?: string;
  onSelectPlan: (id: string) => void;
  onCreatePlan: () => void;
  onDeletePlan: (plan: PlanDraft) => void;
  showKeyboardHints?: boolean;
  onAddFiles?: () => void;
  onViewWarnings?: (file: import('../../SourceImportStatus').ImportFile) => void;
  organizationKeyLoaded: boolean;
  organizationKeyError?: string | null;
  canSimulateOrganizationKeyRelease?: boolean;
  onOpenLocalReleaseSimulator?: () => void;
  readiness: ImporterFlowReadiness;
  blockerCount: number;
  stagingBatch?: Omit<StagingBatchStatusProps, 'plans'>;
};

export function StageContent({
  stage,
  description,
  checklist,
  flow,
  selectedPlanId,
  onSelectPlan,
  onCreatePlan,
  onDeletePlan,
  showKeyboardHints,
  onAddFiles,
  onViewWarnings,
  organizationKeyLoaded,
  organizationKeyError,
  canSimulateOrganizationKeyRelease,
  onOpenLocalReleaseSimulator,
  readiness,
  blockerCount,
  stagingBatch,
}: StageContentProps) {
  if (stage === 'sources')
    return (
      <SourceImportStatus
        files={flow.files}
        description={description}
        onAddFiles={onAddFiles ?? flow.onAddFiles}
        onRetry={flow.retrySource}
        onUnlock={flow.unlockSource}
        onViewWarnings={onViewWarnings ?? flow.onViewWarnings}
        onRemove={flow.removeSource}
      />
    );
  if (stage === 'assets')
    return (
      <AssetReviewQueue
        assets={flow.assets}
        description={description}
        selectedId={flow.selectedAssetId}
        onSelect={flow.selectAsset}
        onAction={flow.reviewAsset}
        showKeyboardHints={showKeyboardHints}
        resolveSourceValue={flow.resolveSourceValue}
        onMapField={flow.mapField}
        onEditPlainText={flow.editPlainText}
      />
    );
  if (stage === 'plans')
    return (
      <PlanGroupingSurface
        unassigned={flow.unassigned}
        plans={flow.plans}
        description={description}
        selectedPlanId={selectedPlanId}
        onSelectPlan={(plan) => onSelectPlan(plan.id)}
        onAssign={flow.assignAsset}
        onUnassign={flow.unassignAsset}
        onCreatePlan={onCreatePlan}
        onDeletePlan={onDeletePlan}
        onUpdatePlan={flow.updatePlan}
      />
    );

  const keyReady = organizationKeyLoaded;
  const keyError =
    organizationKeyError === 'master_key_not_claimed'
      ? 'The Organization Key has not been claimed yet. Claim it on your SafeKey device, then retry the release.'
      : organizationKeyError;
  const encryptionReady = ['encrypted', 'staged'].includes(flow.stagingState);
  const items = checklist.map((item) => {
    if (item.label === 'Imported sources reviewed')
      return {
        ...item,
        complete: readiness.sources,
        detail: readiness.sources
          ? 'Every source is imported; warnings remain visible.'
          : 'Unlock or retry every blocked source.',
        fixLabel: 'Review sources',
        onFix: () => flow.goTo('sources'),
      };
    if (item.label === 'Suggestions reviewed')
      return {
        ...item,
        complete: readiness.assets,
        detail: readiness.assets
          ? 'Every Asset is accepted or intentionally excluded.'
          : 'Accept or exclude every detected Asset.',
        fixLabel: 'Review Assets',
        onFix: () => flow.goTo('assets'),
      };
    if (item.label === 'Plan assignment')
      return {
        ...item,
        complete: readiness.plans,
        detail: flow.unassigned.length
          ? `${flow.unassigned.length} Assets still need a Plan assignment.`
          : readiness.plans
            ? 'Every accepted Asset has a valid Plan draft.'
            : 'Resolve the invalid Plan draft.',
        fixLabel: 'Review Plans',
        onFix: () => flow.goTo('plans'),
      };
    if (item.label === 'Organization Key' || item.label === 'Load Organisation Key')
      return {
        ...item,
        label: 'Load Organisation Key',
        complete: keyReady,
        loading: flow.stagingState === 'releasing',
        error: keyReady ? undefined : (keyError ?? undefined),
        detail: keyReady
          ? 'Key securely loaded.'
          : keyError
            ? 'The Organization Key could not be loaded from SafeKey Mobile.'
            : flow.stagingState === 'releasing'
              ? 'Waiting for SafeKey Mobile to release the key.'
              : 'Send a key release request to SafeKey Mobile.',
        fixLabel:
          flow.stagingState === 'releasing'
            ? 'Cancel request'
            : keyError
              ? 'Retry release'
              : 'Send request to SafeKey Mobile',
        onFix:
          flow.stagingState === 'releasing'
            ? flow.cancelStage
            : !keyReady
              ? flow.requestOrganizationKey
              : undefined,
        fixDisabled: flow.stagingState !== 'releasing' && !readiness.staging,
        secondaryFixLabel: 'Simulate locally',
        onSecondaryFix:
          flow.stagingState === 'releasing' && canSimulateOrganizationKeyRelease
            ? onOpenLocalReleaseSimulator
            : undefined,
      };
    if (item.label === 'Encryption' || item.label === 'Secure staging')
      return {
        ...item,
        label: 'Secure staging',
        complete: encryptionReady,
        loading: flow.stagingState === 'encrypting',
        error:
          flow.stagingState === 'retry' || flow.stagingState === 'failed-stage'
            ? 'Some Plans were not staged. Retry only the affected Plans below.'
            : undefined,
        detail:
          flow.stagingState === 'encrypting'
            ? 'Encrypting data & transmitting to Inheriti® Business for staging.'
            : encryptionReady
              ? 'Every field was encrypted locally with the Organization Key.'
              : keyReady
                ? 'Locally encrypt all data prior to transmission to Inheriti® Business.'
                : 'Locally encrypt all data prior to transmission to Inheriti® Business.',
      };
    return item;
  });

  return (
    <Stack gap="m">
      <FinalStagingChecklist
        state={flow.stagingState}
        items={items}
        description={description}
        canStage={readiness.staging && keyReady}
        onStage={flow.markStaged}
        onStartAgain={flow.startAgain}
        showActions={true}
        blockerCount={blockerCount}
        progress={
          stagingBatch ? (
            <StagingBatchStatus
              items={stagingBatch.items}
              plans={flow.plans}
              running={stagingBatch.running}
              onRetryCreate={stagingBatch.onRetryCreate}
              onRetryConfigure={stagingBatch.onRetryConfigure}
              onCancel={stagingBatch.onCancel}
            />
          ) : null
        }
      />
    </Stack>
  );
}

export default StageContent;
