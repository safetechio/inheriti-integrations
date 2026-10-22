import { automationRuntimeInstallInstructions } from './automation-setup.js';
import { runAws } from './automation-ec2-pair.js';
import type { Ec2PairRunner } from './automation-ec2-pair.js';

const parse = (value: string): Record<string, unknown> => {
  try {
    const result: unknown = JSON.parse(value);
    if (result && typeof result === 'object' && !Array.isArray(result)) return result as Record<string, unknown>;
  } catch { /* handled below */ }
  throw new Error('automation_ec2_cli_install_response_invalid');
};
const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
const pending = (error: unknown, commandId?: string): Error & { artifactPending: true; commandId?: string } =>
  Object.assign(error instanceof Error ? error : new Error('automation_ec2_cli_install_failed'),
    { artifactPending: true as const, ...(commandId ? { commandId } : {}) });
const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
const ensureNodeAndNpm = (minimumNodeMajor: number): string => [
  'cli_node_major=',
  'current_node_major=',
  'if command -v node >/dev/null 2>&1; then current_node_major=$(node -p "process.versions.node.split(\'.\')[0]" 2>/dev/null) || current_node_major=; fi',
  `if test -n "$current_node_major" && test "$current_node_major" -ge ${minimumNodeMajor} 2>/dev/null && command -v npm >/dev/null 2>&1; then`,
  '  cli_npm=$(command -v npm)',
  'else',
  '  test -r /etc/os-release || exit 77',
  '  . /etc/os-release',
  '  test "$ID" = amzn && test "$VERSION_ID" = 2023 || exit 77',
  `  if test -n "$current_node_major" && test "$current_node_major" -ge ${minimumNodeMajor} 2>/dev/null; then`,
  '    dnf install -y "nodejs${current_node_major}-npm" >/dev/null 2>&1 || exit 77',
  '    cli_npm="/usr/bin/npm-$current_node_major"',
  '  else',
  `    node_npm=$(dnf -q repoquery --available --qf "%{name}" "nodejs*-npm" 2>/dev/null | awk -v min=${minimumNodeMajor} '{ name=$0; sub(/^nodejs/, ""); sub(/-npm$/, ""); if ($0 ~ /^[0-9]+$/ && $0+0 >= min) print name }' | sort -V | tail -n 1)`,
  '    test -n "$node_npm" || exit 77',
  '    cli_node_major=${node_npm#nodejs}',
  '    cli_node_major=${cli_node_major%-npm}',
  '    dnf install -y "${node_npm%-npm}" "$node_npm" >/dev/null 2>&1 || exit 77',
  '    cli_npm="/usr/bin/npm-$cli_node_major"',
  `    test -x "/usr/bin/node-$cli_node_major" && /usr/bin/node-$cli_node_major -e "process.exit(Number(process.versions.node.split('.')[0]) >= ${minimumNodeMajor} ? 0 : 1)" || exit 77`,
  '  fi',
  '  test -x "$cli_npm" || exit 77',
  'fi',
].join('\n');
const pinCliNode = [
  'if test -n "$cli_node_major"; then',
  '  main=/usr/local/lib/node_modules/@safetech/inheriti-cli/dist/main.js',
  '  test -f "$main" && test -x "/usr/bin/node-$cli_node_major" || exit 79',
  '  first_line=$(head -n 1 "$main") || exit 79',
  '  if test "$first_line" = "#!/usr/bin/env node"; then',
  '    sed -i "1s|^#!/usr/bin/env node$|#!/usr/bin/node-$cli_node_major|" "$main" || exit 79',
  '  elif test "$first_line" != "#!/usr/bin/node-$cli_node_major"; then exit 79; fi',
  '  test "$(head -n 1 "$main")" = "#!/usr/bin/node-$cli_node_major" || exit 79',
  'fi',
].join('\n');

export async function installEc2Cli(
  input: { region: string; instanceId: string; cliVersion: string; minimumNodeMajor: number; artifact?: { id: string; url: string; sha256: string }; signal?: AbortSignal; onProgress?: (phase: 'checking' | 'sending' | 'waiting' | 'installing' | 'verified') => void },
  run: Ec2PairRunner = runAws,
  pause: (ms: number) => Promise<void> = wait,
): Promise<{ commandId: string; instanceId: string }> {
  const { region, instanceId, cliVersion, minimumNodeMajor, artifact, signal, onProgress } = input;
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region) || !/^i-(?:[0-9a-f]{8}|[0-9a-f]{17})$/.test(instanceId) ||
      !Number.isSafeInteger(minimumNodeMajor) || minimumNodeMajor < 1)
    throw new Error('automation_ec2_cli_install_input_invalid');
  const instructions = automationRuntimeInstallInstructions({ cliVersion });
  if (artifact) {
    let download: URL;
    try { download = new URL(artifact.url); } catch { throw new Error('automation_ec2_cli_install_input_invalid'); }
    if (download.protocol !== 'https:' || download.pathname !== `/test/cli-artifacts/${artifact.id}` ||
        download.searchParams.size !== 2 || !download.searchParams.get('signature') ||
        !/^\d+$/.test(download.searchParams.get('expires') ?? '') ||
        download.username || download.password || download.hash || !/^[A-Za-z0-9_-]{1,128}$/.test(artifact.id) ||
        !/^[0-9a-f]{64}$/.test(artifact.sha256) || !/-dev\./.test(cliVersion))
      throw new Error('automation_ec2_cli_install_input_invalid');
  }
  signal?.throwIfAborted();
  const call = async (args: string[]): Promise<Record<string, unknown>> => {
    let output: string;
    try { output = await run(['ssm', ...args, '--region', region, '--output', 'json'], signal); }
    catch (error) {
      if ((error as Error).message === 'automation_ec2_pair_invocation_pending') throw error;
      if (['aws_cli_required', 'aws_authentication_required'].includes((error as Error).message)) throw error;
      throw new Error('automation_ec2_cli_install_provider_failed');
    }
    return parse(output);
  };
  onProgress?.('checking');
  const managed = await call(['describe-instance-information', '--filters', `Key=InstanceIds,Values=${instanceId}`]);
  const instances = managed.InstanceInformationList;
  if (!Array.isArray(instances) || instances.length !== 1 ||
      (instances[0] as Record<string, unknown>).InstanceId !== instanceId ||
      (instances[0] as Record<string, unknown>).PlatformType !== 'Linux' ||
      (instances[0] as Record<string, unknown>).PingStatus !== 'Online')
    throw new Error('automation_ec2_pair_target_unavailable');
  const command = artifact ? [
    'set -eu',
    'tarball=$(mktemp /tmp/inheriti-cli-XXXXXXXX.tgz)',
    'trap \'rm -f "$tarball"\' EXIT',
    'command -v curl >/dev/null 2>&1 || exit 76',
    ensureNodeAndNpm(minimumNodeMajor),
    `curl -fLsS ${quote(artifact.url)} -o "$tarball" >/dev/null 2>&1 || exit 78`,
    `echo '${artifact.sha256}  '"$tarball" | sha256sum -c - >/dev/null 2>&1 || exit 80`,
    '"$cli_npm" install --engine-strict --global --prefix /usr/local "$tarball" >/dev/null 2>&1 || exit 78',
    pinCliNode,
    `test -x /usr/local/bin/inheriti && test "$(/usr/local/bin/inheriti --version)" = '${cliVersion}' || exit 79`,
  ].join('\n') : [
    'set -eu',
    `if test -x /usr/local/bin/inheriti && test "$(/usr/local/bin/inheriti --version)" = '${cliVersion}'; then exit 0; fi`,
    ensureNodeAndNpm(minimumNodeMajor),
    `"$cli_npm" install --engine-strict --global --prefix /usr/local '${instructions.packageSpec}' >/dev/null 2>&1 || exit 78`,
    pinCliNode,
    `test -x /usr/local/bin/inheriti && test "$(/usr/local/bin/inheriti --version)" = '${cliVersion}' || exit 79`,
  ].join('\n');
  let sent: Record<string, unknown>;
  onProgress?.('sending');
  try {
    sent = await call(['send-command', '--instance-ids', instanceId, '--document-name', 'AWS-RunShellScript',
      '--parameters', JSON.stringify({ commands: [command], executionTimeout: ['600'] }), '--timeout-seconds', '600']);
  } catch (error) { throw pending(error); }
  const commandId = (sent.Command as Record<string, unknown> | undefined)?.CommandId;
  if (typeof commandId !== 'string' || !/^[0-9a-f-]{36}$/i.test(commandId))
    throw pending(new Error('automation_ec2_cli_install_response_invalid'));
  onProgress?.('waiting');
  let lastStatus: string | undefined;
  let terminalStatus = false;
  try { for (let attempt = 0; attempt < 135; attempt++) {
    signal?.throwIfAborted();
    await pause(5_000);
    let invocation: Record<string, unknown>;
    try { invocation = await call(['get-command-invocation', '--command-id', commandId, '--instance-id', instanceId]); }
    catch (error) {
      if ((error as Error).message === 'automation_ec2_pair_invocation_pending') continue;
      throw error;
    }
    if (invocation.Status === 'InProgress' && lastStatus !== 'InProgress') onProgress?.('installing');
    lastStatus = String(invocation.Status);
    if (invocation.Status === 'Success' && invocation.ResponseCode === 0) { onProgress?.('verified'); return { commandId, instanceId }; }
    if (invocation.Status === 'Failed') {
      terminalStatus = true;
      if (invocation.ResponseCode === 76) throw new Error('automation_ec2_cli_install_curl_missing');
      if (invocation.ResponseCode === 77) throw new Error('automation_ec2_cli_install_npm_missing');
      if (invocation.ResponseCode === 78) throw new Error(artifact ? 'automation_ec2_cli_install_artifact_failed' : 'automation_ec2_cli_install_npm_failed');
      if (invocation.ResponseCode === 79) throw new Error('automation_ec2_cli_install_version_mismatch');
      if (invocation.ResponseCode === 80) throw new Error('automation_ec2_cli_install_checksum_mismatch');
    }
    if (['Failed', 'Cancelled', 'TimedOut'].includes(String(invocation.Status))) {
      terminalStatus = true;
      throw new Error('automation_ec2_cli_install_failed');
    }
  }
  throw new Error('automation_ec2_cli_install_wait_failed');
  } catch (error) { throw terminalStatus ? error : pending(error, commandId); }
}
