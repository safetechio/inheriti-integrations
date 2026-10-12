import { Box, Text } from '@main-components';
import type { ImporterFlowStage } from '../../hooks/use-importer-flow';

type FlowStageHeaderProps = { stage: ImporterFlowStage; index: number };
const securityCopy = 'Your imported secrets stay local and masked until staging.';

export function FlowStageHeader({ stage, index }: FlowStageHeaderProps) {
  return (
    <Box className="importer-flow-stage-header" gap="xs">
      <Text variant="smallUppercase" color="primary">
        Step {index + 1} of 4
      </Text>
      <Text variant="heading2">{stageLabel[stage]}</Text>
      <Text variant="bodySmall" color="gray">
        {securityCopy}
      </Text>
    </Box>
  );
}

const stageLabel: Record<ImporterFlowStage, string> = {
  sources: 'Import sources',
  assets: 'Review Assets',
  plans: 'Group Plans',
  staging: 'Review & stage',
};

export default FlowStageHeader;
