import { expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installEc2AutomationService } from '../src/automation-ec2-install.js';

const commandId = '12345678-1234-1234-1234-123456789abc';
const input = {
  region: 'us-east-1', instanceId: 'i-0123456789abcdef0', runAsUser: 'ec2-user',
  launcherPath: '/usr/local/bin/inheriti-automation', launcher: '#!/bin/sh\nexec inheriti',
  applicationCommand: ['/usr/bin/node', '/srv/app/server.js'],
  prepared: { runScriptPath: '/opt/inheriti/my-app-run.sh', runScript: '#!/bin/sh\nexit 0',
    unitName: 'my-app.service', unit: '[Service]\nUser=ec2-user', instructions: [] },
};
const managed = { InstanceInformationList: [{ InstanceId: input.instanceId, PlatformType: 'Linux', PingStatus: 'Online' }] };

it('installs three files through SSM without enabling or starting the service', async () => {
  const run = vi.fn(async (args: string[]) => JSON.stringify(args[1] === 'describe-instance-information' ? managed
    : args[1] === 'send-command' ? { Command: { CommandId: commandId } }
      : { Status: 'Success', ResponseCode: 0 }));
  await expect(installEc2AutomationService(input, run, async () => {}))
    .resolves.toEqual({ commandId, unitName: 'my-app.service' });
  const sent = run.mock.calls.find(([args]) => args[1] === 'send-command')![0];
  const script = JSON.parse(sent[sent.indexOf('--parameters') + 1]!).commands[0] as string;
  expect(script).toContain('cli_path=$(command -v inheriti 2>/dev/null) || exit 78');
  expect(script).toContain('runuser -u \'ec2-user\' -- /bin/sh');
  expect(script).toContain('sed -i "3a export PATH=$cli_dir:');
  expect(script).toContain("runuser -u 'ec2-user' -- /bin/sh -c 'test -f \"$1\" && test -r \"$1\"' sh '/srv/app/server.js' || exit 84");
  expect(script).toContain('test ! -e \'/etc/systemd/system/my-app.service\' && test ! -L \'/etc/systemd/system/my-app.service\' || exit 80');
  expect(script).toContain('systemctl daemon-reload');
  expect(script).not.toMatch(/systemctl (enable|start)/);
});

it('accepts a CLI at a non-default absolute path and rejects missing or inaccessible CLI', async () => {
  const run = vi.fn(async (args: string[]) => JSON.stringify(args[1] === 'describe-instance-information' ? managed
    : args[1] === 'send-command' ? { Command: { CommandId: commandId } }
      : { Status: 'Success', ResponseCode: 0 }));
  await installEc2AutomationService({ ...input, runAsUser: 'root', applicationCommand: ['/bin/sh'] }, run, async () => {});
  const sent = run.mock.calls.find(([args]) => args[1] === 'send-command')![0];
  const command = JSON.parse(sent[sent.indexOf('--parameters') + 1]!).commands[0] as string;
  const preflight = command.slice(0, command.indexOf('test ! -e'));
  const directory = mkdtempSync(join(tmpdir(), 'inheriti-ec2-install-'));
  try {
    const cli = join(directory, 'inheriti');
    const runuser = join(directory, 'runuser');
    writeFileSync(cli, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(runuser, '#!/bin/sh\nshift 3\nexec "$@"\n', { mode: 0o755 });
    expect(spawnSync('/bin/sh', ['-c', preflight], { env: { PATH: directory } }).status).toBe(0);
    const staging = join(directory, 'staging');
    mkdirSync(staging);
    const runScript = join(staging, '1');
    writeFileSync(runScript, '#!/bin/sh\nset -eu\nexport PATH=/usr/local/bin:/usr/bin:/bin:${PATH:-}\nexec inheriti\n');
    const injectPath = command.split('\n').find(line => line.startsWith('sed -i '))!;
    expect(spawnSync('/bin/sh', ['-c', injectPath], { env: { PATH: '/usr/bin:/bin', cli_dir: directory, tmp: staging } }).status).toBe(0);
    expect(spawnSync('/bin/sh', [runScript], { env: { PATH: '/usr/bin:/bin' } }).status).toBe(0);
    chmodSync(cli, 0o644);
    expect(spawnSync('/bin/sh', ['-c', preflight], { env: { PATH: directory } }).status).toBe(78);
    rmSync(cli);
    expect(spawnSync('/bin/sh', ['-c', preflight], { env: { PATH: directory } }).status).toBe(78);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it('rejects an application executable unavailable to the service user', async () => {
  const run = vi.fn(async (args: string[]) => JSON.stringify(args[1] === 'describe-instance-information' ? managed
    : args[1] === 'send-command' ? { Command: { CommandId: commandId } }
      : { Status: 'Success', ResponseCode: 0 }));
  await installEc2AutomationService({ ...input, runAsUser: 'root', applicationCommand: ['/bin/sh'] }, run, async () => {});
  const sent = run.mock.calls.find(([args]) => args[1] === 'send-command')![0];
  const command = JSON.parse(sent[sent.indexOf('--parameters') + 1]!).commands[0] as string;
  const preflight = command.slice(0, command.indexOf('test ! -e'));
  const directory = mkdtempSync(join(tmpdir(), 'inheriti-ec2-install-'));
  try {
    writeFileSync(join(directory, 'inheriti'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(directory, 'runuser'), '#!/bin/sh\nfor arg do last=$arg; done\n[ "$last" = /bin/sh ] && exit 1\nshift 3\nexec "$@"\n', { mode: 0o755 });
    expect(spawnSync('/bin/sh', ['-c', preflight], { env: { PATH: directory } }).status).toBe(84);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it('upgrades only an exact previous unit while the service is stopped', async () => {
  const unit = '[Service]\nRestart=on-failure\nRestartPreventExitStatus=77\nRestartSec=5\n';
  const run = vi.fn(async (args: string[]) => JSON.stringify(args[1] === 'describe-instance-information' ? managed
    : args[1] === 'send-command' ? { Command: { CommandId: commandId } }
      : { Status: 'Success', ResponseCode: 0 }));
  await installEc2AutomationService({ ...input, prepared: { ...input.prepared, unit }, replace: true }, run, async () => {});
  const sent = run.mock.calls.find(([args]) => args[1] === 'send-command')![0];
  const script = JSON.parse(sent[sent.indexOf('--parameters') + 1]!).commands[0] as string;
  expect(script).toContain('cmp -s "$tmp/0"');
  expect(script).toContain('systemctl is-active --quiet');
  expect(script).toContain('mv -f "$new"');
  expect(script).not.toContain('install -D -m 0755');
  expect(script).toContain('mv -f "$new_unit"');
  expect(script).toContain('systemctl daemon-reload');
  expect(script).toContain(Buffer.from(unit.replace('RestartPreventExitStatus=77\n', '')).toString('base64'));
  const matchLine = script.split('\n').find(line => line.startsWith('if cmp -s "$tmp/2"'))!;
  const directory = mkdtempSync(join(tmpdir(), 'inheriti-ec2-unit-'));
  try {
    const target = join(directory, 'my-app.service');
    const staging = join(directory, 'stage');
    mkdirSync(staging);
    writeFileSync(join(staging, '2'), unit);
    writeFileSync(join(staging, '3'), unit.replace('RestartPreventExitStatus=77\n', ''));
    const check = matchLine.replaceAll("'/etc/systemd/system/my-app.service'", `'${target}'`);
    for (const [existing, changed] of [[unit, '0'], [unit.replace('RestartPreventExitStatus=77\n', ''), '1']] as const) {
      writeFileSync(target, existing);
      const result = spawnSync('/bin/sh', ['-c', `${check}\nprintf '%s' "$unit_changed"`], { env: { tmp: staging } });
      expect(result.status).toBe(0);
      expect(result.stdout.toString()).toBe(changed);
    }
    writeFileSync(target, '[Service]\nRestart=always\n');
    expect(spawnSync('/bin/sh', ['-c', check], { env: { tmp: staging } }).status).toBe(83);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

it('reports an existing target without exposing remote output', async () => {
  const run = vi.fn(async (args: string[]) => JSON.stringify(args[1] === 'describe-instance-information' ? managed
    : args[1] === 'send-command' ? { Command: { CommandId: commandId } }
      : { Status: 'Failed', ResponseCode: 80, StandardErrorContent: 'PRIVATE' }));
  await expect(installEc2AutomationService(input, run, async () => {}))
    .rejects.toThrow('automation_ec2_install_files_exist');
});
