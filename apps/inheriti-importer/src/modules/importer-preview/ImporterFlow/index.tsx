import { useState } from 'react';
import { Box, Icon, Text, theme } from '@main-components';
import type { ReviewAsset } from '../AssetReviewQueue';
import type { ChecklistItem, StagingState } from '../FinalStagingChecklist';
import type { GroupingAsset, PlanDraft } from '../PlanGroupingSurface';
import type { ImportFile } from '../SourceImportStatus';
import type { StagingBatchStatusProps } from '../StagingBatchStatus';
import type { ImporterFlowReadiness } from './application/flow-readiness';
import { FlowActions } from './components/FlowActions';
import { FlowHeader } from './components/FlowHeader';
import { FlowStepper } from './components/FlowStepper';
import { StageContent } from './components/StageContent';
import { LocalOrganizationKeyReleaseModal } from './components/LocalOrganizationKeyReleaseModal';
import {
  importerFlowStages,
  type ImporterFlowStage,
  useImporterFlow,
  type ImporterFlowCallbacks,
} from './hooks/use-importer-flow';
import './styles.css';

export type ImporterFlowProps = {
  files: ImportFile[];
  assets: ReviewAsset[];
  unassigned: GroupingAsset[];
  plans: PlanDraft[];
  checklist: ChecklistItem[];
  initialStage?: ImporterFlowStage;
  initialStagingState?: StagingState;
  showKeyboardHints?: boolean;
  autoAdvance?: boolean;
  callbacks?: ImporterFlowCallbacks;
  stagingState?: StagingState;
  stagingReady?: boolean;
  organizationKeyLoaded?: boolean;
  organizationKeyError?: string | null;
  canSimulateOrganizationKeyRelease?: boolean;
  stagingBatch?: Omit<StagingBatchStatusProps, 'plans'>;
};

export function ImporterFlow({
  files,
  assets,
  unassigned,
  plans,
  checklist,
  initialStage,
  initialStagingState,
  showKeyboardHints = true,
  autoAdvance = true,
  callbacks,
  stagingState,
  stagingReady = true,
  organizationKeyLoaded,
  organizationKeyError,
  canSimulateOrganizationKeyRelease = false,
  stagingBatch,
}: ImporterFlowProps) {
  const controlled =
    callbacks || stagingState ? { callbacks: callbacks ?? {}, stagingState } : undefined;
  const flow = useImporterFlow(
    {
      files,
      assets,
      unassigned,
      plans,
      initialStage,
      initialStagingState,
      autoAdvance,
    },
    controlled,
  );
  const [selectedPlanId, setSelectedPlanId] = useState<string | undefined>(plans[0]?.id);
  const [localReleaseSimulatorVisible, setLocalReleaseSimulatorVisible] = useState(false);
  const stage = flow.stage;
  const flowLocked = ['releasing', 'encrypting', 'retry', 'failed-stage', 'staged'].includes(
    flow.stagingState,
  );
  const keyLoaded =
    organizationKeyLoaded ??
    [
      'configured',
      'verified',
      'encrypted',
      'encrypting',
      'staged',
      'failed-stage',
      'retry',
    ].includes(flow.stagingState);
  const undecided = flow.assets.filter(
    (item) => !['accepted', 'excluded'].includes(item.status),
  ).length;
  const sourceIssueGroups =
    Number(flow.files.length === 0) +
    Number(flow.files.some((file) => file.status === 'unlock-required')) +
    Number(flow.files.some((file) => file.status === 'failed' || file.status === 'retrying'));
  const planIssueGroups = Number(flow.unassigned.length > 0) + Number(!flow.readiness.plans);
  const assetIssueGroups = Number(!flow.assets.length || undecided > 0);
  const blockerCount = sourceIssueGroups + assetIssueGroups + planIssueGroups;
  const readiness: ImporterFlowReadiness = {
    sources: flow.readiness.sources,
    assets: flow.readiness.assets,
    plans: flow.readiness.plans,
    staging: flow.readiness.staging && stagingReady,
  };
  const stageDescription = getStageDescription({
    stage,
    stagingState: flow.stagingState,
    sourceIssueGroups,
    planIssueGroups,
    blockerCount,
    keyLoaded,
  });

  return (
    <Box className="importer-flow-page">
      <FlowHeader
        fileCount={flow.files.length}
        planCount={flow.plans.length}
        onCancel={flow.cancel}
      />
      <Box className="importer-flow-workspace">
        <FlowStepper
          stage={stage}
          onSelect={flow.goTo}
          files={flow.files}
          assets={flow.assets}
          unassigned={flow.unassigned}
          plans={flow.plans}
          readiness={readiness}
          organizationKeyLoaded={keyLoaded}
          locked={flowLocked}
        />
        <Box className="importer-flow-center">
          <Box className="importer-flow-stage-header" gap="xxs">
            <Box gap="xxs">
              <Text variant="importerEyebrow" color="gray">
                Step {flow.index + 1} of {importerFlowStages.length}
              </Text>
              <Text className="stage-headline" variant="importerStageHeadline">
                {stage === 'staging' && flow.stagingState === 'staged'
                  ? 'Your import is ready'
                  : stageHeadline(stage)}
              </Text>
            </Box>
            <Box
              className="importer-flow-security-note"
              flexDirection="row"
              alignItems="flex-start"
              gap="s"
            >
              <Icon name="lock" size={13} color={theme.colors.primary120} />
              <Text
                className="importer-flow-security-copy"
                variant="importerFooterNote"
                color="gray"
              >
                Files are parsed locally. Nothing leaves this computer until you choose Encrypt and
                stage. Fields are encrypted locally before transmission to Inheriti® Business.
              </Text>
            </Box>
          </Box>
          <Box className="importer-flow-scroll">
            <StageContent
              stage={stage}
              description={stageDescription}
              checklist={checklist}
              flow={flow}
              selectedPlanId={selectedPlanId}
              onSelectPlan={setSelectedPlanId}
              onCreatePlan={() => {
                const id = flow.createPlan();
                if (id) setSelectedPlanId(id);
              }}
              onDeletePlan={(plan) => {
                flow.deletePlan(plan);
                if (selectedPlanId === plan.id)
                  setSelectedPlanId(flow.plans.find((item) => item.id !== plan.id)?.id);
              }}
              showKeyboardHints={showKeyboardHints}
              onAddFiles={flow.onAddFiles}
              onViewWarnings={flow.onViewWarnings}
              organizationKeyLoaded={keyLoaded}
              organizationKeyError={organizationKeyError}
              canSimulateOrganizationKeyRelease={canSimulateOrganizationKeyRelease}
              onOpenLocalReleaseSimulator={() => setLocalReleaseSimulatorVisible(true)}
              readiness={readiness}
              blockerCount={blockerCount}
              stagingBatch={stagingBatch}
            />
          </Box>
          <FlowActions
            canGoBack={flow.canGoBack && !flowLocked}
            canGoNext={flow.canGoNext}
            onBack={flow.goBack}
            onNext={flow.goNext}
            showComplete={stage !== 'staging'}
            nextLabel={nextAction[stage]}
            isStaging={stage === 'staging'}
            canStage={readiness.staging && keyLoaded}
            onStage={flow.isControlled && !callbacks?.onStage ? undefined : flow.markStaged}
            stagingState={flow.stagingState}
          />
        </Box>
      </Box>
      <LocalOrganizationKeyReleaseModal
        visible={localReleaseSimulatorVisible}
        onDismiss={() => setLocalReleaseSimulatorVisible(false)}
        onRelease={async (recoveryCode) => {
          await flow.simulateOrganizationKeyRelease(recoveryCode);
          setLocalReleaseSimulatorVisible(false);
        }}
      />
    </Box>
  );
}

const nextAction = {
  sources: 'Continue',
  assets: 'Continue',
  plans: 'Continue',
  staging: 'Encrypt and stage',
};

const stageDescriptions = {
  sources: 'Confirm what was imported',
  assets: 'Decide which assets to import',
  plans: 'Put every Asset in a plan draft',
  staging: 'Encrypt and stage for Inheriti® Business',
};

function stageHeadline(stage: keyof typeof stageDescriptions) {
  return stageDescriptions[stage];
}

function getStageDescription({
  stage,
  stagingState,
  sourceIssueGroups,
  planIssueGroups,
  blockerCount,
  keyLoaded,
}: {
  stage: ImporterFlowStage;
  stagingState: StagingState;
  sourceIssueGroups: number;
  planIssueGroups: number;
  blockerCount: number;
  keyLoaded: boolean;
}) {
  if (stage === 'sources' && sourceIssueGroups)
    return 'Unlock, retry, remove, or add a source before continuing.';
  if (stage === 'assets')
    return 'Accept or exclude every detected Asset before continuing.';
  if (stage === 'plans' && planIssueGroups)
    return 'Create valid Plans and assign every accepted Asset before continuing.';
  if (stage !== 'staging') return 'This step is clear.';
  if (stagingState === 'staged')
    return 'Import complete. Continue in Inheriti® Business to review it.';
  if (stagingState === 'releasing') return 'Waiting for release from SafeKey Mobile.';
  if (stagingState === 'retry' || stagingState === 'failed-stage')
    return 'Retry failed Plans below; staged Plans will not run again.';
  if (blockerCount)
    return `${blockerCount} blocker${blockerCount === 1 ? '' : 's'} left — review the previous steps.`;
  if (stagingState === 'waiting-release')
    return 'Request the Organization Key from SafeKey Mobile to continue.';
  if (!keyLoaded) return 'Request the Organization Key from SafeKey Mobile to continue.';
  return 'Nothing blocking. Encryption runs locally before transmission.';
}

export default ImporterFlow;
