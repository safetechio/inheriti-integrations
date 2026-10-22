import { createAutomationSetupOperations, inspectEc2AutomationInstance, pairEc2Automation } from '@safetech/inheriti-elements-core/node-base';
import type { CliConfiguration } from '../configuration.js';
import type { CliContext } from '../session.js';
import type { Terminal } from '../output.js';
import { renderJson } from '../output.js';
import { renderTo } from '../render/ink.js';
import { Ec2PairReview, Ec2PairSuccess } from '../render/automation-ec2-pair.js';
import { promptSelect } from '../render/select.js';

const usage = 'Usage: inheriti automations pair ec2 --connection ID --region REGION --instance INSTANCE_ID [--expect-role IAM_ROLE_ARN]';

export async function pairEc2AutomationInstance(
  context: CliContext, configuration: CliConfiguration, terminal: Terminal, argv: readonly string[], signal?: AbortSignal,
): Promise<number> {
  const entries = argv.filter((_, index) => index % 2 === 0).map((key, index) => [key, argv[index * 2 + 1]] as const);
  const options = Object.fromEntries(entries) as Record<string, string>;
  if (argv.length % 2 || entries.some(([key, value]) =>
    !['--connection', '--region', '--instance', '--expect-role'].includes(key) || !value || value.startsWith('--')) ||
    Object.keys(options).length !== entries.length || !options['--connection'] || !options['--region'] ||
    !options['--instance'] || (!terminal.interactive && !options['--expect-role'])) {
    terminal.writeError(usage); return 1;
  }
  if (!(await context.core.getAccessToken())) { terminal.writeError('Sign in before pairing automation.'); return 1; }
  const operations = createAutomationSetupOperations({ apiUrl: configuration.apiUrl, organizationId: context.organization!.id,
    getBearerToken: () => context.core.getAccessToken() });
  const connection = await operations.getConnection(options['--connection']);
  if (connection.provider !== 'AWS' || connection.trust.method !== 'AWS_IAM_ROLE' || connection.status === 'DISABLED') {
    terminal.writeError('Select an AWS connection that is awaiting verification.'); return 1;
  }
  const instance = await inspectEc2AutomationInstance({ region: options['--region'], instanceId: options['--instance'] });
  if (instance.roleArn !== connection.trust.roleArn) {
    terminal.writeError('The EC2 instance role does not match this connection.'); return 1;
  }
  if (options['--expect-role'] && options['--expect-role'] !== instance.roleArn) {
    terminal.writeError('The EC2 instance role changed. Inspect it again before pairing.'); return 1;
  }
  if (!options['--expect-role']) {
    renderTo(terminal, <Ec2PairReview instanceId={instance.instanceId} region={instance.region} roleArn={instance.roleArn} />);
    const choice = await promptSelect('Run pairing command on this instance?', [
      { value: 'cancel', description: 'Cancel' }, { value: 'run', description: 'Start pairing and run remote command' },
    ], signal);
    if (choice !== 'run') return 1;
  }
  const result = await pairEc2Automation({ region: instance.region, instanceId: instance.instanceId,
    connectionId: connection.id, startPairing: async () => { await operations.startPairing(connection.id); },
    ...(signal ? { signal } : {}) });
  const verified = await operations.getConnection(connection.id);
  if (verified.status !== 'VERIFIED') {
    terminal.writeError('The EC2 command finished, but Business has not confirmed the connection. Check its status before proceeding.');
    return 1;
  }
  if (terminal.interactive) renderTo(terminal, <Ec2PairSuccess instanceId={instance.instanceId} connectionId={connection.id} commandId={result.commandId} />);
  else renderJson(terminal, { ...result, connectionId: connection.id, connectionStatus: verified.status });
  return 0;
}
