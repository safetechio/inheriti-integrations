import { Box, Text } from 'ink';
import { Field, Heading } from './table.js';

export function Ec2PairReview({ instanceId, region, roleArn }: { instanceId: string; region: string; roleArn: string }) {
  return <Box flexDirection="column">
    <Heading>EC2 instance to pair</Heading>
    <Field label="instance" value={instanceId} />
    <Field label="region" value={region} />
    <Text dimColor>IAM role</Text>
    <Text wrap="wrap">{roleArn}</Text>
  </Box>;
}

export function Ec2PairSuccess({ instanceId, connectionId, commandId }: {
  instanceId: string; connectionId: string; commandId: string;
}) {
  return <Box flexDirection="column">
    <Text bold color="green">EC2 connection verified</Text>
    <Field label="instance" value={instanceId} />
    <Field label="connection" value={connectionId} />
    <Field label="SSM command" value={commandId} />
  </Box>;
}
