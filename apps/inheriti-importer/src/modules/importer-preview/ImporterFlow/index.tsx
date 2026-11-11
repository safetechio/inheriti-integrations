import { useEffect, useState, type ReactNode } from 'react';
import { Box, Text } from '@main-components';
import type { ReviewAsset } from '../AssetReviewQueue';
import type { ChecklistItem, StagingState } from '../FinalStagingChecklist';
import type { GroupingAsset, PlanDraft } from '../PlanGroupingSurface';
import type { ImportFile } from '../SourceImportStatus';
import type { StagingBatchStatusProps } from '../StagingBatchStatus';
import type { ImporterFlowReadiness } from './application/flow-readiness';
import { FlowActions } from './components/FlowActions';
import { FlowHeader, CancelImportControl } from './components/FlowHeader';
import { FlowStepper } from './components/FlowStepper';
import { StageContent } from './components/StageContent';
import { LocalOrganizationKeyReleaseModal } from './components/LocalOrganizationKeyReleaseModal';
import { ModalPortal } from '@modules/_shared/ui/components/Base/Portal';
import { StagingSuccess } from '../FinalStagingChecklist/components/StagingSuccess';
import {
  importerFlowStages,
  type ImporterFlowStage,
  useImporterFlow,
  type ImporterFlowCallbacks,
} from './hooks/use-importer-flow';
import './styles.css';

export type ImporterFlowProps = {
  headerActions?: ReactNode;
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
  headerActions,
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
  useEffect(() => {
    if (stage === 'plans' && flow.plans.length === 0) flow.ensureFirstPlan();
  }, [stage, flow.plans.length, flow.ensureFirstPlan]);
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
    Number(
      flow.files.some((file) => file.status === 'unlock-required' || file.status === 'unlocking'),
    ) +
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

  if (stage === 'staging' && flow.stagingState === 'staged') {
    return (
      <ModalPortal visible>
        <Box
          position="fixed"
          top={0}
          right={0}
          bottom={0}
          left={0}
          alignItems="center"
          justifyContent="center"
          backgroundColor="gray5"
          padding="l"
        >
          <Box
            accessibilityRole="dialog"
            accessibilityLabel="Import staged"
            aria-modal="true"
            width="100%"
            maxWidth={640}
          >
            <StagingSuccess onStartAgain={flow.startAgain} />
          </Box>
        </Box>
      </ModalPortal>
    );
  }

  return (
    <Box className="importer-flow-page">
      <FlowHeader actions={headerActions} />
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
          <Box
            className="importer-flow-stage-header"
            flexDirection="row"
            alignItems="flex-start"
            justifyContent="space-between"
            flexWrap="wrap"
            gap="m"
          >
            <Box gap="xxs" style={{ flex: '1 1 360px', minWidth: 0 }}>
              <Box gap="xxs">
                <Text variant="importerEyebrow" color="gray">
                  Step {flow.index + 1} of {importerFlowStages.length}
                </Text>
                <Text className="stage-headline" variant="importerStageHeadline">
                  {stage === 'staging' && flow.stagingState === 'staged'
                    ? 'Import staged'
                    : stageHeadline(stage)}
                </Text>
              </Box>
              <Text variant="importerFooterNote" color="gray">
                {stageHelpers[stage]}
              </Text>
            </Box>
            {flow.stagingState !== 'staged' ? (
              <CancelImportControl
                fileCount={flow.files.length}
                planCount={flow.plans.length}
                onCancel={flow.cancel}
              />
            ) : null}
          </Box>
          <Box className={`importer-flow-scroll${stage === 'assets' ? ' is-asset-review' : ''}`}>
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
  sources: 'Confirm imported sources',
  assets: 'Review detected assets',
  plans: 'Draft plan creation',
  staging: 'Authorise plan staging',
};

const stageHelpers = {
  sources: 'Add or remove sources from the list below.',
  assets: 'Review each asset’s assigned type and data, then accept or exclude it from the import.',
  plans: 'Drag an asset onto a plan or select a plan, then click Assign on an asset.',
  staging: 'Secure your draft plans and data for transmission to Inheriti® Business.',
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
  if (stage === 'assets') return 'Accept or exclude every detected Asset before continuing.';
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
