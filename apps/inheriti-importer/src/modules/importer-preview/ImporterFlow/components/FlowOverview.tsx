import { Box, Card, Text } from '@main-components';
import { OverviewRow } from './OverviewRow';
import type { ReviewAsset } from '../../AssetReviewQueue';
import type { GroupingAsset, PlanDraft } from '../../PlanGroupingSurface';
import type { ImportFile } from '../../SourceImportStatus';
import { importerFlowStages, type ImporterFlowStage } from '../hooks/use-importer-flow';

type FlowOverviewProps = {
  stage: ImporterFlowStage;
  files: ImportFile[];
  assets: ReviewAsset[];
  plans: PlanDraft[];
  unassigned: GroupingAsset[];
};

export function FlowOverview({ stage, files, assets, plans, unassigned }: FlowOverviewProps) {
  const currentStage = importerFlowStages.find((item) => item.id === stage)?.label ?? '';

  return (
    <Card className="importer-flow-overview" gap="m">
      <Text variant="heading3">Import overview</Text>
      <OverviewRow label="Current stage" value={currentStage} />
      <OverviewRow label="Source files" value={String(files.length)} />
      <OverviewRow label="Detected Assets" value={String(assets.length)} />
      <OverviewRow label="Plan drafts" value={String(plans.length)} />
      <OverviewRow label="Unassigned Assets" value={String(unassigned.length)} />
      <Box className="importer-flow-overview-note">
        <Text variant="bodySmall" color="gray">
          Secrets remain local and masked until encrypted staging.
        </Text>
      </Box>
    </Card>
  );
}

export default FlowOverview;
