import { Box, Card, Icon, InteractiveSurface, Text, theme } from '@main-components';
import { importerFlowStages, type ImporterFlowStage } from '../hooks/use-importer-flow';
import type { ReviewAsset } from '../../AssetReviewQueue';
import type { GroupingAsset, PlanDraft } from '../../PlanGroupingSurface';
import type { ImportFile } from '../../SourceImportStatus';
import { isPlanOverCapacity } from '../../PlanGroupingSurface/capacity';
import type { ImporterFlowReadiness } from '../application/flow-readiness';
import { UpdateStatus } from '@modules/_shared/ui/components/UpdateStatus';

type FlowStepperProps = {
  stage: ImporterFlowStage;
  onSelect: (stage: ImporterFlowStage) => void;
  files: ImportFile[];
  assets: ReviewAsset[];
  unassigned: GroupingAsset[];
  plans: PlanDraft[];
  readiness: ImporterFlowReadiness;
  organizationKeyLoaded: boolean;
  locked?: boolean;
};

export function FlowStepper({
  stage,
  onSelect,
  files,
  assets,
  unassigned,
  plans,
  readiness,
  organizationKeyLoaded,
  locked = false,
}: FlowStepperProps) {
  const active = importerFlowStages.findIndex((item) => item.id === stage);
  const undecided = assets.filter(
    (asset) => !['accepted', 'excluded'].includes(asset.status),
  ).length;
  const lockedSources = files.filter((file) => file.status === 'unlock-required').length;
  const failedSources = files.filter(
    (file) => file.status === 'failed' || file.status === 'retrying',
  ).length;
  const invalidPlans = plans.filter((plan) => !plan.valid || isPlanOverCapacity(plan)).length;
  const stepStatus = {
    sources: readiness.sources
      ? `${files.length} sources ready`
      : files.length
        ? `${lockedSources + failedSources} need attention`
        : 'Add a source',
    assets: readiness.assets
      ? 'All reviewed'
      : assets.length
        ? `${undecided} to review`
        : 'No Assets detected',
    plans: readiness.plans
      ? `${plans.length} plans ready`
      : plans.length
        ? unassigned.length
          ? `${unassigned.length} unassigned`
          : `${invalidPlans} plan${invalidPlans === 1 ? '' : 's'} need review`
        : 'Create a Plan',
    staging: readiness.staging
      ? organizationKeyLoaded
        ? 'Ready to stage'
        : 'Request Organization Key'
      : 'Complete previous steps',
  };

  return (
    <Card className="importer-flow-stepper" padding="m" gap="l">
      <Box gap="xxs">
        <Text variant="importerRailEyebrow" color="gray" style={{ padding: '0 6px 4px' }}>
          Import steps
        </Text>
        {importerFlowStages.map((item, index) => {
          const ready = readiness[item.id] && (item.id !== 'staging' || organizationKeyLoaded);
          const statusIcon = getStepStatusIcon(item.id, ready);
          const disabled =
            locked ||
            (index > active &&
              (item.id === 'assets'
                ? !readiness.sources
                : item.id === 'plans'
                  ? !readiness.sources || !readiness.assets
                  : item.id === 'staging'
                    ? !readiness.staging
                    : false));
          return (
            <InteractiveSurface
              key={item.id}
              onPress={() => onSelect(item.id)}
              disabled={disabled}
              className={`importer-flow-step ${index === active ? 'is-active' : ''} ${ready ? 'is-complete' : ''} ${disabled ? 'is-disabled' : ''}`}
              gap="xxs"
            >
              <Box flexDirection="row" alignItems="center" gap="s">
                <Text
                  className="importer-flow-step-number"
                  variant="importerStepNumber"
                  color={ready ? 'success120' : index === active ? 'white' : 'primary50'}
                >
                  {ready ? '✓' : index + 1}
                </Text>
                <Text className="importer-flow-step-label" variant="importerStepLabel">
                  {item.label}
                </Text>
              </Box>
              <Box
                className="importer-flow-step-status-row"
                flexDirection="row"
                alignItems="center"
                gap="xxs"
              >
                <Icon name={statusIcon.name} size={10} color={statusIcon.color} />
                <Text
                  variant="importerStepStatus"
                  color={ready ? 'success120' : item.id === 'staging' ? 'gray' : 'warning200'}
                >
                  {stepStatus[item.id]}
                </Text>
              </Box>
            </InteractiveSurface>
          );
        })}
      </Box>
      <Box className="importer-flow-counters" gap="s">
        {[
          ['Source files', files.length],
          ['Detected Assets', assets.length],
          ['Accepted', assets.filter((asset) => asset.status === 'accepted').length],
          ['Excluded', assets.filter((asset) => asset.status === 'excluded').length],
          ['Plan drafts', plans.length],
        ].map(([label, value]) => (
          <Box key={label} flexDirection="row" justifyContent="space-between">
            <Text
              className="importer-flow-counter-label"
              variant="importerCounterLabel"
              color="gray"
            >
              {label}
            </Text>
            <Text className="importer-flow-counter-value" variant="importerCounterValue">
              {value}
            </Text>
          </Box>
        ))}
      </Box>
      <UpdateStatus className="importer-flow-version" />
    </Card>
  );
}

function getStepStatusIcon(stage: ImporterFlowStage, ready: boolean) {
  if (ready) return { name: 'circle-check', color: theme.colors.success120 };

  switch (stage) {
    case 'plans':
      return { name: 'layer-group', color: theme.colors.warning200 };
    case 'staging':
      return { name: 'lock', color: theme.colors.gray };
    default:
      return { name: 'circle-exclamation', color: theme.colors.warning200 };
  }
}

export default FlowStepper;
