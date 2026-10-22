import { createAutomationSetupOperations, inspectCloudTargetForPairing, pairEcsAutomation, resolveAutomationImage, runningEcsServiceImage } from '@safetech/inheriti-elements-core/node-base';
import type { CliConfiguration } from '../configuration.js';
import type { CliContext } from '../session.js';
import type { Terminal } from '../output.js';
import { renderJson } from '../output.js';
import { promptSelect } from '../render/select.js';

const allowed = new Set(['--connection', '--region', '--cluster', '--service', '--container', '--image', '--cli-path', '--expect-revision']);
const usage = 'Usage: inheriti automations pair aws --connection ID --region REGION --cluster CLUSTER --service SERVICE [--image ECR_TAG_OR_DIGEST] [--container NAME] [--cli-path ABSOLUTE_PATH] [--expect-revision TASK_DEFINITION_ARN]';

export async function pairAwsAutomationService(
  context: CliContext, configuration: CliConfiguration, terminal: Terminal, argv: readonly string[],
  signal?: AbortSignal,
): Promise<number> {
  signal?.throwIfAborted();
  const entries = argv.filter((_, index) => index % 2 === 0).map((key, index) => [key, argv[index * 2 + 1]] as const);
  const options = Object.fromEntries(entries) as Record<string, string>;
  if (argv.length % 2 || entries.some(([key, value]) => !allowed.has(key) || !value || value.startsWith('--')) ||
      Object.keys(options).length !== entries.length ||
      !options['--connection'] || !options['--region'] || !options['--cluster'] || !options['--service'] ||
      (!terminal.interactive && !options['--expect-revision'])) {
    terminal.writeError(usage);
    return 1;
  }
  if (!(await context.core.getAccessToken())) { terminal.writeError('Sign in before pairing automation.'); return 1; }
  const operations = createAutomationSetupOperations({
    apiUrl: configuration.apiUrl, organizationId: context.organization!.id,
    getBearerToken: () => context.core.getAccessToken(),
  });
  const connection = await operations.getConnection(options['--connection']);
  if (connection.provider !== 'AWS' || connection.trust.method !== 'AWS_IAM_ROLE' || connection.status === 'DISABLED') {
    terminal.writeError('Select an AWS connection that is awaiting verification.');
    return 1;
  }
  const target = { provider: 'AWS' as const, region: options['--region'], cluster: options['--cluster'],
    service: options['--service'], ...(options['--container'] ? { container: options['--container'] } : {}) };
  const inspected = await inspectCloudTargetForPairing(target);
  if (inspected.identity !== connection.trust.roleArn) {
    terminal.writeError('The ECS task role does not match this connection.');
    return 1;
  }
  if (options['--expect-revision'] && options['--expect-revision'] !== inspected.revision) {
    terminal.writeError('The ECS task definition changed. Inspect the service again before pairing.');
    return 1;
  }
  const image = options['--image']
    ? await resolveAutomationImage(options['--image'], 'AWS', signal)
    : await runningEcsServiceImage(inspected);
  if (!options['--expect-revision']) {
    renderJson(terminal, { target, image, taskDefinition: inspected.revision,
      taskRoleArn: inspected.identity, action: 'Run one temporary ECS task to verify this connection.' });
    const choice = await promptSelect('Run this one-off ECS task?', [
      { value: 'cancel', description: 'Cancel' }, { value: 'run', description: 'Start pairing and run task' },
    ], signal);
    if (choice !== 'run') return 1;
  }
  const result = await pairEcsAutomation({
    target, expectedRevision: inspected.revision, expectedRoleArn: connection.trust.roleArn,
    image, cliPath: options['--cli-path'] ?? '/usr/local/bin/inheriti',
    environment: {
      INHERITI_AUTOMATION_PROVIDER: 'AWS',
      INHERITI_AUTOMATION_CONNECTION_ID: connection.id,
      AWS_REGION: target.region,
    },
    startPairing: async () => { await operations.startPairing(connection.id); },
    ...(signal ? { signal } : {}),
  });
  const verified = await operations.getConnection(connection.id);
  if (verified.status !== 'VERIFIED') {
    terminal.writeError('The ECS task finished, but Business has not confirmed the connection. Check its status before proceeding.');
    return 1;
  }
  renderJson(terminal, { ...result, image, connectionId: connection.id, connectionStatus: verified.status });
  return 0;
}
