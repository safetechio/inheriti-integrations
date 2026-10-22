import { spawnSync } from 'node:child_process';
import { expect, it, vi } from 'vitest';
import { installEc2Cli } from '../src/automation-ec2-cli-install.js';

const commandId = '11111111-1111-4111-8111-111111111111';
const input = { region: 'us-east-1', instanceId: 'i-09ce8440ae7294ab9', cliVersion: '0.0.19-dev.0', minimumNodeMajor: 22 };
const managed = JSON.stringify({ InstanceInformationList: [{ InstanceId: input.instanceId, PlatformType: 'Linux', PingStatus: 'Online' }] });
const sent = JSON.stringify({ Command: { CommandId: commandId } });

it('installs the exact CLI version through SSM and confirms completion', async () => {
  const run = vi.fn(async (args: string[]) => args[1] === 'describe-instance-information' ? managed
    : args[1] === 'send-command' ? sent : JSON.stringify({ Status: 'Success', ResponseCode: 0 }));
  expect(await installEc2Cli(input, run, async () => {})).toEqual({ commandId, instanceId: input.instanceId });
  const command = JSON.parse(run.mock.calls.find(([args]) => args[1] === 'send-command')![0][7]!);
  expect(command.commands[0]).toContain('@safetech/inheriti-cli@0.0.19-dev.0');
  expect(command.commands[0]).toContain('test -x /usr/local/bin/inheriti');
  expect(command.commands[0]).toContain('test "$current_node_major" -ge 22');
  expect(command.commands[0]).toContain('test "$ID" = amzn && test "$VERSION_ID" = 2023');
  expect(command.commands[0]).toContain('dnf -q repoquery --available --qf "%{name}" "nodejs*-npm"');
  expect(command.commands[0]).toContain('awk -v min=22');
  expect(command.commands[0]).toContain('dnf install -y "nodejs${current_node_major}-npm"');
  expect(command.commands[0]).toContain('dnf install -y "${node_npm%-npm}" "$node_npm"');
  expect(command.commands[0]).toContain('cli_npm="/usr/bin/npm-$cli_node_major"');
  expect(command.commands[0]).toContain('main=/usr/local/lib/node_modules/@safetech/inheriti-cli/dist/main.js');
  expect(command.commands[0]).toContain('sed -i "1s|^#!/usr/bin/env node$|#!/usr/bin/node-$cli_node_major|" "$main"');
  expect(command.commands[0]).toContain('test "$(head -n 1 "$main")" = "#!/usr/bin/node-$cli_node_major"');
  expect(command.commands[0]).not.toContain('mv -f "$wrapper" /usr/local/bin/inheriti');
  expect(command.commands[0]).not.toContain('alternatives --set node');
  expect(spawnSync('sh', ['-n'], { input: command.commands[0] }).status).toBe(0);
  expect(command.commands[0]).not.toContain('INHERITI_AUTOMATION_CONNECTION_ID');
});

it('reports only real SSM status transitions', async () => {
  const onProgress = vi.fn();
  let polls = 0;
  const run = vi.fn(async (args: string[]) => args[1] === 'describe-instance-information' ? managed
    : args[1] === 'send-command' ? sent
      : JSON.stringify(++polls < 3 ? { Status: polls === 1 ? 'Pending' : 'InProgress', ResponseCode: -1 }
        : { Status: 'Success', ResponseCode: 0 }));
  await installEc2Cli({ ...input, onProgress }, run, async () => {});
  expect(onProgress.mock.calls.flat()).toEqual(['checking', 'sending', 'waiting', 'installing', 'verified']);
});

it('refuses an offline target before sending any command', async () => {
  const run = vi.fn(async () => JSON.stringify({ InstanceInformationList: [] }));
  await expect(installEc2Cli(input, run, async () => {})).rejects.toThrow('automation_ec2_pair_target_unavailable');
  expect(run).toHaveBeenCalledTimes(1);
});

it('rejects an invalid minimum Node major before AWS calls', async () => {
  const run = vi.fn();
  await expect(installEc2Cli({ ...input, minimumNodeMajor: 0 }, run)).rejects.toThrow('automation_ec2_cli_install_input_invalid');
  expect(run).not.toHaveBeenCalled();
});

it('explains when npm is missing on the instance', async () => {
  const run = vi.fn(async (args: string[]) => args[1] === 'describe-instance-information' ? managed
    : args[1] === 'send-command' ? sent : JSON.stringify({ Status: 'Failed', ResponseCode: 77 }));
  await expect(installEc2Cli(input, run, async () => {})).rejects.toThrow('automation_ec2_cli_install_npm_missing');
});

it('downloads and verifies a local tarball before installing even when the version matches', async () => {
  const run = vi.fn(async (args: string[]) => args[1] === 'describe-instance-information' ? managed
    : args[1] === 'send-command' ? sent : JSON.stringify({ Status: 'Success', ResponseCode: 0 }));
  const artifact = { id: 'artifact_1', url: 'https://business-dev.example/test/cli-artifacts/artifact_1?expires=9999999999&signature=secret', sha256: 'a'.repeat(64) };
  await installEc2Cli({ ...input, artifact }, run, async () => {});
  const command = JSON.parse(run.mock.calls.find(([args]) => args[1] === 'send-command')![0][7]!).commands[0];
  expect(command).toContain(`curl -fLsS '${artifact.url}' -o \"$tarball\"`);
  expect(command).toContain(`echo '${artifact.sha256}  '`);
  expect(command).toContain('sha256sum -c -');
  expect(command).toContain('"$cli_npm" install --engine-strict --global --prefix /usr/local "$tarball"');
  expect(command).toContain('trap \'rm -f "$tarball"\' EXIT');
  expect(command.indexOf('dnf install -y')).toBeLessThan(command.indexOf('curl -fLsS'));
  expect(command).not.toContain('then exit 0');
});

it('marks uncertain polling failure with the SSM command ID', async () => {
  const run = vi.fn(async (args: string[]) => args[1] === 'describe-instance-information' ? managed
    : args[1] === 'send-command' ? sent : JSON.stringify({ Status: 'Pending', ResponseCode: -1 }));
  const artifact = { id: 'artifact_1', url: 'https://business-dev.example/test/cli-artifacts/artifact_1?expires=9999999999&signature=secret', sha256: 'a'.repeat(64) };
  await expect(installEc2Cli({ ...input, artifact }, run, async () => {})).rejects.toMatchObject({
    message: 'automation_ec2_cli_install_wait_failed', artifactPending: true, commandId,
  });
});

it('treats confirmed missing curl as a terminal installation failure', async () => {
  const run = vi.fn(async (args: string[]) => args[1] === 'describe-instance-information' ? managed
    : args[1] === 'send-command' ? sent : JSON.stringify({ Status: 'Failed', ResponseCode: 76 }));
  const artifact = { id: 'artifact_1', url: 'https://business-dev.example/test/cli-artifacts/artifact_1?expires=9999999999&signature=secret', sha256: 'a'.repeat(64) };
  await expect(installEc2Cli({ ...input, artifact }, run, async () => {})).rejects.toMatchObject({
    message: 'automation_ec2_cli_install_curl_missing',
  });
});

it('marks abort after SSM submission as uncertain', async () => {
  const controller = new AbortController();
  const run = vi.fn(async (args: string[]) => args[1] === 'describe-instance-information' ? managed
    : args[1] === 'send-command' ? (controller.abort(), sent) : JSON.stringify({ Status: 'Pending' }));
  const artifact = { id: 'artifact_1', url: 'https://business-dev.example/test/cli-artifacts/artifact_1?expires=9999999999&signature=secret', sha256: 'a'.repeat(64) };
  await expect(installEc2Cli({ ...input, artifact, signal: controller.signal }, run, async () => {})).rejects.toMatchObject({
    artifactPending: true, commandId,
  });
});
