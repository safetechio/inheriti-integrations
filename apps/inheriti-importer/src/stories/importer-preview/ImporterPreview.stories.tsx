import { useState } from 'react';
import { SourceImportStatus } from '@modules/importer-preview/SourceImportStatus';
import { FileRow } from '@modules/importer-preview/SourceImportStatus/components/FileRow';
import { AssetReviewQueue } from '@modules/importer-preview/AssetReviewQueue';
import { PlanGroupingSurface } from '@modules/importer-preview/PlanGroupingSurface';
import { FinalStagingChecklist } from '@modules/importer-preview/FinalStagingChecklist';
import { ImporterFlow } from '@modules/importer-preview/ImporterFlow';
import { PlanCard } from '@modules/importer-preview/PlanGroupingSurface/components/PlanCard';
import { SensitiveValue } from '@modules/import/domain/import-model';
import type { ReviewAsset } from '@modules/importer-preview/AssetReviewQueue';
import {
  assignedPlans,
  checklist,
  fullPlans,
  overCapacityPlans,
  plans,
  reviewAssets,
  sourceFiles,
  unassigned,
  validPlans,
  zeroUsagePlans,
} from './fixtures';

const noop = () => undefined;
const sourceActions = { onAddFiles: noop, onRetry: noop, onUnlock: noop, onViewWarnings: noop };
const assetActions = { onAction: noop, onSelect: noop };
const protectedStoryValues: Record<string, SensitiveValue> = {
  'asset-1:url': new SensitiveValue('https://database.example.test'),
  'asset-1:username': new SensitiveValue('database-user'),
  'asset-1:password': new SensitiveValue('example-password'),
  'asset-2:token': new SensitiveValue('example-api-key'),
  'asset-2:endpoint': new SensitiveValue('https://partner.example.test'),
  'asset-3:note': new SensitiveValue('Example recovery instructions'),
};
const planActions = { onAssign: noop, onCreatePlan: noop, onSelectPlan: noop, onUnassign: noop };
const stagingActions = { onRetry: noop, onStage: noop };
const readyFiles = sourceFiles.filter(
  (file) => file.status === 'warning' || file.status === 'imported',
);
const reviewedAssets = reviewAssets.map((asset, index) => ({
  ...asset,
  status: index === reviewAssets.length - 1 ? ('excluded' as const) : ('accepted' as const),
}));

export const SourceImport = () => <SourceImportStatus files={sourceFiles} {...sourceActions} />;
export const SourceImportEmpty = () => <SourceImportStatus files={[]} {...sourceActions} />;
export const SourceImportImported = () => (
  <SourceImportStatus
    files={sourceFiles.filter((file) => file.status === 'imported')}
    {...sourceActions}
  />
);
export const SourceImportWarning = () => (
  <SourceImportStatus
    files={sourceFiles.filter((file) => file.status === 'warning')}
    {...sourceActions}
  />
);
export const SourceImportUnlockRequired = () => (
  <SourceImportStatus
    files={sourceFiles.filter((file) => file.status === 'unlock-required')}
    {...sourceActions}
  />
);
export const SourceImportUnlockForm = () => (
  <FileRow
    file={sourceFiles.find((file) => file.status === 'unlock-required')!}
    initiallyShowUnlock
    onUnlock={noop}
  />
);
export const SourceImportRetrying = () => (
  <SourceImportStatus
    files={[{ name: 'legacy.csv', format: 'CSV', status: 'retrying' }]}
    {...sourceActions}
  />
);
export const SourceImportFailed = () => (
  <SourceImportStatus
    files={sourceFiles.filter((file) => file.status === 'failed')}
    {...sourceActions}
  />
);
export const SourceImportUnlockSucceeded = () => (
  <SourceImportStatus
    files={[{ name: 'vault.json', format: 'Vault', entries: 24, warnings: 0, status: 'imported' }]}
    {...sourceActions}
  />
);
export const SourceImportRetrySucceeded = () => (
  <SourceImportStatus
    files={[{ name: 'legacy.csv', format: 'CSV', entries: 12, warnings: 0, status: 'imported' }]}
    {...sourceActions}
  />
);

export const AssetReview = () => <AssetReviewQueue assets={reviewAssets} {...assetActions} />;
export const AssetReviewEmpty = () => <AssetReviewQueue assets={[]} {...assetActions} />;
export const AssetReviewSchemaMapping = () => {
  const [assets, setAssets] = useState<ReviewAsset[]>(reviewAssets);
  const [selectedId, setSelectedId] = useState(reviewAssets[0]?.id);
  const mapField = (asset: ReviewAsset, targetField: string, sourceFieldId?: string) => {
    setAssets((current) =>
      current.map((item) => {
        if (item.id !== asset.id) return item;
        const schemaFields = item.schemaFields?.map((field) => {
          if (field.key !== targetField) return field;
          return {
            key: field.key,
            label: field.label,
            required: field.required,
            sourceFieldId,
            sourceFieldName: field.candidates?.find((candidate) => candidate.id === sourceFieldId)
              ?.name,
            candidates: field.candidates,
          };
        });
        return { ...item, status: 'needs-review', schemaFields };
      }),
    );
  };
  const reviewAsset = (action: string, asset: ReviewAsset) => {
    if (action !== 'accept' && action !== 'exclude') return;
    setAssets((current) =>
      current.map((item) =>
        item.id === asset.id
          ? {
              ...item,
              status: action === 'accept' ? 'accepted' : 'excluded',
            }
          : item,
      ),
    );
  };
  return (
    <AssetReviewQueue
      assets={assets}
      selectedId={selectedId}
      onAction={reviewAsset}
      onSelect={(asset) => setSelectedId(asset.id)}
      onMapField={mapField}
      resolveSourceValue={(sourceFieldId) => protectedStoryValues[sourceFieldId]}
    />
  );
};
export const AssetReviewSuggested = () => (
  <AssetReviewQueue
    assets={reviewAssets.filter((asset) => asset.status === 'suggested')}
    {...assetActions}
  />
);
export const AssetReviewNeedsReview = () => (
  <AssetReviewQueue
    assets={reviewAssets.filter((asset) => asset.status === 'needs-review')}
    {...assetActions}
  />
);
export const AssetReviewFallback = () => (
  <AssetReviewQueue
    assets={reviewAssets.filter((asset) => asset.status === 'fallback')}
    {...assetActions}
  />
);
export const AssetReviewAccepted = () => (
  <AssetReviewQueue assets={[{ ...reviewAssets[0], status: 'accepted' }]} {...assetActions} />
);
export const AssetReviewExcluded = () => (
  <AssetReviewQueue assets={[{ ...reviewAssets[1], status: 'excluded' }]} {...assetActions} />
);
export const AssetReviewAcceptedAndExcluded = () => (
  <AssetReviewQueue
    assets={reviewAssets
      .slice(0, 2)
      .map((asset, index) => ({ ...asset, status: index === 0 ? 'accepted' : 'excluded' }))}
    {...assetActions}
  />
);
export const AssetReviewKeyboardHintsHidden = () => (
  <AssetReviewQueue assets={reviewAssets} showKeyboardHints={false} {...assetActions} />
);

export const PlanGrouping = () => (
  <PlanGroupingSurface
    unassigned={unassigned}
    plans={plans}
    selectedPlanId="plan-1"
    {...planActions}
  />
);
export const PlanGroupingEditable = () => {
  const [drafts, setDrafts] = useState(plans);
  return (
    <PlanGroupingSurface
      unassigned={unassigned}
      plans={drafts}
      selectedPlanId="plan-1"
      {...planActions}
      onUpdatePlan={(plan, values) =>
        setDrafts(
          drafts.map((draft) =>
            draft.id === plan.id
              ? { ...draft, name: values.name, description: values.description }
              : draft,
          ),
        )
      }
    />
  );
};
export const PlanGroupingAllAssigned = () => (
  <PlanGroupingSurface
    unassigned={[]}
    plans={validPlans}
    selectedPlanId="plan-ready"
    {...planActions}
  />
);
export const PlanGroupingNoDrafts = () => (
  <PlanGroupingSurface unassigned={[]} plans={[]} {...planActions} />
);
export const PlanGroupingNoAcceptedAssets = () => (
  <PlanGroupingSurface unassigned={[]} plans={zeroUsagePlans} {...planActions} />
);
export const PlanGroupingNoValidPlans = () => (
  <PlanGroupingSurface unassigned={[]} plans={overCapacityPlans} {...planActions} />
);
export const PlanGroupingAssigned = () => (
  <PlanGroupingSurface
    unassigned={unassigned.slice(1)}
    plans={assignedPlans}
    selectedPlanId="plan-1"
    {...planActions}
  />
);
export const PlanGroupingOverCapacity = () => (
  <PlanGroupingSurface
    unassigned={[]}
    plans={overCapacityPlans}
    selectedPlanId="plan-over"
    {...planActions}
  />
);
export const PlanGroupingFullCapacity = () => (
  <PlanGroupingSurface
    unassigned={unassigned}
    plans={fullPlans}
    selectedPlanId="plan-full"
    {...planActions}
  />
);
export const PlanGroupingEmptyDraft = () => (
  <PlanGroupingSurface
    unassigned={unassigned}
    plans={zeroUsagePlans}
    selectedPlanId="plan-empty"
    {...planActions}
  />
);
export const PlanGroupingReady = () => (
  <PlanGroupingSurface
    unassigned={[]}
    plans={validPlans}
    selectedPlanId="plan-ready"
    {...planActions}
  />
);
export const PlanDropAccepted = () => (
  <PlanCard
    plan={validPlans[0]}
    selected
    dropState="over-valid"
    onSelect={noop}
    onDragOver={noop}
    onDragLeave={noop}
    onDrop={noop}
  />
);
export const PlanDropRejected = () => (
  <PlanCard
    plan={overCapacityPlans[0]}
    selected
    dropState="over-invalid"
    onSelect={noop}
    onDragOver={noop}
    onDragLeave={noop}
    onDrop={noop}
  />
);

export const FinalReviewIdle = () => (
  <FinalStagingChecklist
    state="idle"
    items={checklist.map((item) => ({ ...item, complete: true }))}
    {...stagingActions}
  />
);
export const FinalReviewConfigured = () => (
  <FinalStagingChecklist state="configured" items={checklist} {...stagingActions} />
);
export const FinalReviewLocked = () => (
  <FinalStagingChecklist state="idle" canStage={false} items={checklist} {...stagingActions} />
);
export const FinalReviewVerified = () => (
  <FinalStagingChecklist
    state="verified"
    items={checklist.map((item) => ({ ...item, complete: true }))}
    {...stagingActions}
  />
);
export const FinalReviewFailedStage = () => (
  <FinalStagingChecklist state="failed-stage" items={checklist} {...stagingActions} />
);
export const FinalReviewReleasing = () => (
  <FinalStagingChecklist state="releasing" items={checklist} {...stagingActions} />
);
export const FinalReviewEncrypted = () => (
  <FinalStagingChecklist
    state="encrypted"
    items={checklist.map((item) => ({ ...item, complete: true }))}
    {...stagingActions}
  />
);
export const FinalReviewEncrypting = () => (
  <FinalStagingChecklist
    state="encrypting"
    items={checklist.map((item) => ({ ...item, complete: true }))}
    {...stagingActions}
  />
);
export const FinalReviewStaged = () => (
  <FinalStagingChecklist
    state="staged"
    items={checklist.map((item) => ({ ...item, complete: true }))}
    {...stagingActions}
  />
);
export const FinalReviewRetry = () => (
  <FinalStagingChecklist state="retry" items={checklist} {...stagingActions} />
);

export const WholeImporterFlow = () => (
  <ImporterFlow
    files={sourceFiles}
    assets={reviewAssets}
    unassigned={unassigned}
    plans={plans}
    checklist={checklist}
  />
);
export const WholeImporterFlowAssets = () => (
  <ImporterFlow
    initialStage="assets"
    files={sourceFiles}
    assets={reviewAssets}
    unassigned={unassigned}
    plans={plans}
    checklist={checklist}
  />
);
export const WholeImporterFlowAssetsManualAdvance = () => (
  <ImporterFlow
    initialStage="assets"
    autoAdvance={false}
    files={sourceFiles}
    assets={reviewAssets}
    unassigned={unassigned}
    plans={plans}
    checklist={checklist}
  />
);
export const WholeImporterFlowAssetsKeyboardHintsHidden = () => (
  <ImporterFlow
    initialStage="assets"
    showKeyboardHints={false}
    files={sourceFiles}
    assets={reviewAssets}
    unassigned={unassigned}
    plans={plans}
    checklist={checklist}
  />
);
export const WholeImporterFlowPlans = () => (
  <ImporterFlow
    initialStage="plans"
    files={sourceFiles}
    assets={reviewAssets}
    unassigned={unassigned}
    plans={plans}
    checklist={checklist}
  />
);
export const WholeImporterFlowStaging = () => (
  <ImporterFlow
    initialStage="staging"
    files={sourceFiles}
    assets={reviewAssets}
    unassigned={unassigned}
    plans={plans}
    checklist={checklist}
  />
);
export const WholeImporterFlowReadyToStage = () => (
  <ImporterFlow
    initialStage="staging"
    files={readyFiles}
    assets={reviewedAssets}
    unassigned={[]}
    plans={plans}
    checklist={checklist}
  />
);
export const WholeImporterFlowNoBlockers = () => (
  <ImporterFlow
    initialStage="staging"
    files={readyFiles}
    assets={reviewedAssets}
    unassigned={[]}
    plans={validPlans}
    checklist={checklist}
  />
);
export const WholeImporterFlowUnlockBlocker = () => (
  <ImporterFlow
    initialStage="staging"
    files={sourceFiles.filter((file) => file.status === 'unlock-required')}
    assets={reviewAssets.map((asset) => ({ ...asset, status: 'accepted' }))}
    unassigned={[]}
    plans={validPlans}
    checklist={checklist}
  />
);
export const WholeImporterFlowFailedSource = () => (
  <ImporterFlow
    initialStage="staging"
    files={sourceFiles.filter((file) => file.status === 'failed')}
    assets={reviewAssets.map((asset) => ({ ...asset, status: 'accepted' }))}
    unassigned={[]}
    plans={validPlans}
    checklist={checklist}
  />
);
export const WholeImporterFlowAssetsNeedsReview = () => (
  <ImporterFlow
    initialStage="staging"
    files={sourceFiles.filter((file) => file.status === 'imported')}
    assets={reviewAssets}
    unassigned={[]}
    plans={validPlans}
    checklist={checklist}
  />
);
export const WholeImporterFlowPlansNeedAssignment = () => (
  <ImporterFlow
    initialStage="staging"
    files={sourceFiles.filter((file) => file.status === 'imported')}
    assets={reviewAssets.map((asset) => ({ ...asset, status: 'accepted' }))}
    unassigned={unassigned}
    plans={validPlans}
    checklist={checklist}
  />
);
export const WholeImporterFlowOverCapacity = () => (
  <ImporterFlow
    initialStage="staging"
    files={sourceFiles.filter((file) => file.status === 'imported')}
    assets={reviewAssets.map((asset) => ({ ...asset, status: 'accepted' }))}
    unassigned={[]}
    plans={overCapacityPlans}
    checklist={checklist}
  />
);
export const WholeImporterFlowReleasing = () => (
  <ImporterFlow
    initialStage="staging"
    initialStagingState="releasing"
    files={readyFiles}
    assets={reviewedAssets}
    unassigned={[]}
    plans={validPlans}
    checklist={checklist}
  />
);
export const WholeImporterFlowEncrypting = () => (
  <ImporterFlow
    initialStage="staging"
    initialStagingState="encrypting"
    files={readyFiles}
    assets={reviewedAssets}
    unassigned={[]}
    plans={validPlans}
    checklist={checklist}
  />
);
export const WholeImporterFlowStaged = () => (
  <ImporterFlow
    initialStage="staging"
    initialStagingState="staged"
    files={readyFiles}
    assets={reviewedAssets}
    unassigned={[]}
    plans={validPlans}
    checklist={checklist}
  />
);
