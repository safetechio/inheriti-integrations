import { runAws } from './automation-ec2-pair.js';
import type { Ec2PairRunner } from './automation-ec2-pair.js';
import type { Ec2ServicePreparation } from './automation-ec2-service.js';

const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
const parse = (value: string): Record<string, unknown> => {
  try {
    const result: unknown = JSON.parse(value);
    if (result && typeof result === 'object' && !Array.isArray(result)) return result as Record<string, unknown>;
  } catch { /* handled below */ }
  throw new Error('automation_ec2_install_response_invalid');
};
const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export async function installEc2AutomationService(
  input: { region: string; instanceId: string; runAsUser: string; launcherPath: string;
    launcher: string; prepared: Ec2ServicePreparation; applicationCommand: string[]; replace?: boolean; signal?: AbortSignal },
  run: Ec2PairRunner = runAws,
  pause: (ms: number) => Promise<void> = wait,
): Promise<{ commandId: string; unitName: string }> {
  const { region, instanceId, runAsUser, launcherPath, launcher, prepared, applicationCommand, replace, signal } = input;
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region) || !/^i-[0-9a-f]{8,17}$/.test(instanceId) ||
      !/^[a-z_][a-z0-9_-]{0,31}$/.test(runAsUser) ||
      !/^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(launcherPath) ||
      !/^\/opt\/inheriti\/[A-Za-z0-9_.@-]+-run\.sh$/.test(prepared.runScriptPath) ||
      !/^[A-Za-z0-9_.@-]+\.service$/.test(prepared.unitName) || !applicationCommand.length ||
      applicationCommand.some(arg => !arg || /[\x00-\x1f\x7f]/.test(arg)))
    throw new Error('automation_ec2_input_invalid');
  const unitPath = `/etc/systemd/system/${prepared.unitName}`;
  const targets = [launcherPath, prepared.runScriptPath, unitPath];
  if (new Set(targets).size !== 3) throw new Error('automation_ec2_input_invalid');
  const call = async (args: string[]): Promise<Record<string, unknown>> => {
    try { return parse(await run(['ssm', ...args, '--region', region, '--output', 'json'], signal)); }
    catch (error) {
      if ((error as Error).message === 'automation_ec2_pair_provider_failed')
        throw new Error('automation_ec2_install_provider_failed');
      throw error;
    }
  };
  const managed = await call(['describe-instance-information', '--filters', `Key=InstanceIds,Values=${instanceId}`]);
  const instances = managed.InstanceInformationList;
  if (!Array.isArray(instances) || instances.length !== 1 ||
      (instances[0] as Record<string, unknown>).InstanceId !== instanceId ||
      (instances[0] as Record<string, unknown>).PlatformType !== 'Linux' ||
      (instances[0] as Record<string, unknown>).PingStatus !== 'Online')
    throw new Error('automation_ec2_pair_target_unavailable');
  const previousUnit = prepared.unit.replace('RestartPreventExitStatus=77\n', '');
  const contents = [launcher, prepared.runScript, prepared.unit, ...(replace ? [previousUnit] : [])]
    .map(value => Buffer.from(value).toString('base64'));
  const executable = applicationCommand[0]!;
  const script = /^(?:node|nodejs|python\d*|sh|bash)$/.test(executable.split('/').at(-1)!) &&
    applicationCommand[1]?.startsWith('/') ? applicationCommand[1] : undefined;
  const command = [
    'set -eu',
    'PATH=${PATH:+$PATH:}/usr/local/bin:/usr/bin:/bin',
    'cli_path=$(command -v inheriti 2>/dev/null) || exit 78',
    'case "$cli_path" in /*) ;; *) exit 78;; esac',
    'case "$cli_path" in *[!A-Za-z0-9_./-]*) exit 78;; esac',
    'test -x "$cli_path" || exit 78',
    `id -u ${quote(runAsUser)} >/dev/null 2>&1 || exit 79`,
    `runuser -u ${quote(runAsUser)} -- /bin/sh -c 'test -x "$1"' sh "$cli_path" || exit 78`,
    'cli_dir=${cli_path%/*}; test -n "$cli_dir" || cli_dir=/',
    `${executable.startsWith('/')
      ? `runuser -u ${quote(runAsUser)} -- /bin/sh -c 'test -x "$1"' sh ${quote(executable)}`
      : `runuser -u ${quote(runAsUser)} -- /bin/sh -c 'command -v "$1" >/dev/null 2>&1 && test -x "$(command -v "$1")"' sh ${quote(executable)}`} || exit 84`,
    ...(script ? [`runuser -u ${quote(runAsUser)} -- /bin/sh -c 'test -f "$1" && test -r "$1"' sh ${quote(script)} || exit 84`] : []),
    ...(!replace ? targets.map(path => `test ! -e ${quote(path)} && test ! -L ${quote(path)} || exit 80`)
      : targets.map(path => `test -f ${quote(path)} && test ! -L ${quote(path)} || exit 80`)),
    'umask 077',
    'tmp=$(mktemp -d)',
    'trap \'rm -rf "$tmp"\' EXIT',
    ...contents.map((content, index) => `printf '%s' ${quote(content)} | base64 -d > "$tmp/${index}"`),
    // The generated run script resets PATH; prepend the verified CLI directory after that reset.
    'sed -i "3a export PATH=$cli_dir:\\${PATH:-}" "$tmp/1"',
    ...(replace ? [
      `cmp -s "$tmp/0" ${quote(launcherPath)} || exit 83`,
      `if cmp -s "$tmp/2" ${quote(unitPath)}; then unit_changed=0; elif cmp -s "$tmp/3" ${quote(unitPath)}; then unit_changed=1; else exit 83; fi`,
      `if systemctl is-active --quiet ${quote(prepared.unitName)}; then exit 82; fi`,
      `new=${quote(`${prepared.runScriptPath}.inheriti-new-`)}$$`,
      `new_unit=${quote(`${unitPath}.inheriti-new-`)}$$`,
      'trap \'rm -f "$new" "$new_unit"; rm -rf "$tmp"\' EXIT',
      `install -m 0700 -o ${quote(runAsUser)} -g "$(id -gn ${quote(runAsUser)})" "$tmp/1" "$new"`,
      'if test "$unit_changed" = 1; then install -m 0644 "$tmp/2" "$new_unit"; fi',
      `mv -f "$new" ${quote(prepared.runScriptPath)}`,
      `if test "$unit_changed" = 1; then mv -f "$new_unit" ${quote(unitPath)}; systemctl daemon-reload; fi`,
    ] : [
      `install -D -m 0755 "$tmp/0" ${quote(launcherPath)}`,
      `install -D -m 0700 -o ${quote(runAsUser)} -g "$(id -gn ${quote(runAsUser)})" "$tmp/1" ${quote(prepared.runScriptPath)}`,
      `install -m 0644 "$tmp/2" ${quote(unitPath)}`,
      'systemctl daemon-reload',
    ]),
  ].join('\n');
  signal?.throwIfAborted();
  const sent = await call(['send-command', '--instance-ids', instanceId, '--document-name', 'AWS-RunShellScript',
    '--parameters', JSON.stringify({ commands: [command], executionTimeout: ['120'] }), '--timeout-seconds', '120']);
  const commandId = (sent.Command as Record<string, unknown> | undefined)?.CommandId;
  if (typeof commandId !== 'string' || !/^[0-9a-f-]{36}$/i.test(commandId)) throw new Error('automation_ec2_install_response_invalid');
  for (let attempt = 0; attempt < 30; attempt++) {
    signal?.throwIfAborted();
    await pause(5_000);
    let invocation: Record<string, unknown>;
    try { invocation = await call(['get-command-invocation', '--command-id', commandId, '--instance-id', instanceId]); }
    catch (error) {
      if (String((error as Error).message).includes('invocation_pending')) continue;
      throw error;
    }
    if (invocation.Status === 'Success' && invocation.ResponseCode === 0) return { commandId, unitName: prepared.unitName };
    if (invocation.Status === 'Failed') {
      if (invocation.ResponseCode === 78) throw new Error('automation_ec2_install_cli_missing');
      if (invocation.ResponseCode === 79) throw new Error('automation_ec2_install_user_missing');
      if (invocation.ResponseCode === 80) throw new Error('automation_ec2_install_files_exist');
      if (invocation.ResponseCode === 82) throw new Error('automation_ec2_install_service_active');
      if (invocation.ResponseCode === 83) throw new Error('automation_ec2_install_files_changed');
      if (invocation.ResponseCode === 84) throw new Error('automation_ec2_install_application_missing');
    }
    if (['Failed', 'Cancelled', 'TimedOut', 'Cancelling'].includes(String(invocation.Status)))
      throw new Error('automation_ec2_install_failed');
  }
  throw new Error('automation_ec2_install_wait_failed');
}
