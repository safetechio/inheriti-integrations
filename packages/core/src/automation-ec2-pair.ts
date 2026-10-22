import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { providerCliError } from './provider-cli-error.js';

const execFileAsync = promisify(execFile);
export type Ec2PairRunner = (args: string[], signal?: AbortSignal) => Promise<string>;
export const runAws: Ec2PairRunner = async (args, signal) => {
  try {
    const { stdout } = await execFileAsync('aws', args, { maxBuffer: 1024 * 1024, timeout: 30_000, windowsHide: true, signal });
    return stdout;
  } catch (error) {
    if (args[0] === 'ssm' && args[1] === 'get-command-invocation' &&
        String((error as { stderr?: unknown }).stderr).includes('InvocationDoesNotExist'))
      throw new Error('automation_ec2_pair_invocation_pending');
    throw providerCliError('aws', error, 'automation_ec2_pair_provider_failed');
  }
};
const parse = (value: string): Record<string, unknown> => {
  try {
    const result: unknown = JSON.parse(value);
    if (result && typeof result === 'object' && !Array.isArray(result)) return result as Record<string, unknown>;
  } catch { /* handled below */ }
  throw new Error('automation_ec2_pair_response_invalid');
};
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
// Reserve an exit code for the executable check so SSM can report it without exposing remote output.
const missingCliExitCode = 78;

export async function pairEc2Automation(
  input: { region: string; instanceId: string; connectionId: string; startPairing: () => Promise<void>; signal?: AbortSignal },
  run: Ec2PairRunner = runAws,
  pause: (ms: number) => Promise<void> = wait,
): Promise<{ commandId: string; status: 'paired' }> {
  const { region, instanceId, connectionId, signal } = input;
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region) || !/^i-[0-9a-f]{8,17}$/.test(instanceId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(connectionId))
    throw new Error('automation_ec2_pair_input_invalid');
  signal?.throwIfAborted();
  const call = async (args: string[]): Promise<Record<string, unknown>> =>
    parse(await run(['ssm', ...args, '--region', region, '--output', 'json'], signal));
  const managed = await call(['describe-instance-information', '--filters', `Key=InstanceIds,Values=${instanceId}`]);
  const instances = managed.InstanceInformationList;
  if (!Array.isArray(instances) || instances.length !== 1 ||
      (instances[0] as Record<string, unknown>).InstanceId !== instanceId ||
      (instances[0] as Record<string, unknown>).PlatformType !== 'Linux' ||
      (instances[0] as Record<string, unknown>).PingStatus !== 'Online')
    throw new Error('automation_ec2_pair_target_unavailable');
  // SSM executes this on the instance; connection and region are validated above.
  const command = `PATH=${'${PATH:+$PATH:}'}/usr/local/bin:/usr/bin:/bin; cli_path=$(command -v inheriti 2>/dev/null) || exit ${missingCliExitCode}; case "$cli_path" in /*) ;; *) exit ${missingCliExitCode};; esac; test -x "$cli_path" || exit ${missingCliExitCode}; INHERITI_AUTOMATION_PROVIDER=AWS INHERITI_AUTOMATION_CONNECTION_ID=${quote(connectionId)} AWS_REGION=${quote(region)} "$cli_path" automations pair redeem`;
  await input.startPairing();
  signal?.throwIfAborted();
  const sent = await call(['send-command', '--instance-ids', instanceId, '--document-name', 'AWS-RunShellScript',
    '--parameters', JSON.stringify({ commands: [command], executionTimeout: ['540'] }), '--timeout-seconds', '540']);
  const commandId = (sent.Command as Record<string, unknown> | undefined)?.CommandId;
  if (typeof commandId !== 'string' || !/^[0-9a-f-]{36}$/i.test(commandId)) throw new Error('automation_ec2_pair_response_invalid');
  for (let attempt = 0; attempt < 108; attempt++) {
    signal?.throwIfAborted();
    await pause(5_000);
    let invocation: Record<string, unknown>;
    try { invocation = await call(['get-command-invocation', '--command-id', commandId, '--instance-id', instanceId]); }
    catch (error) {
      if ((error as Error).message === 'automation_ec2_pair_invocation_pending') continue;
      throw error;
    }
    if (invocation.Status === 'Success' && invocation.ResponseCode === 0) return { commandId, status: 'paired' };
    if (invocation.Status === 'Failed' && invocation.ResponseCode === missingCliExitCode)
      throw new Error('automation_ec2_pair_cli_missing');
    if (['Failed', 'Cancelled', 'TimedOut', 'Cancelling'].includes(String(invocation.Status)))
      throw new Error('automation_ec2_pair_failed');
  }
  throw new Error('automation_ec2_pair_wait_failed');
}
