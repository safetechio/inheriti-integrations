import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pairEc2Automation } from '../src/automation-ec2-pair.js';

const input = () => ({ region: 'us-east-1', instanceId: 'i-09ce8440ae7294ab9',
  connectionId: 'e4917865-d02f-4b1a-9efb-54782aa76d23', startPairing: vi.fn().mockResolvedValue(undefined) });
const managed = JSON.stringify({ InstanceInformationList: [{ InstanceId: 'i-09ce8440ae7294ab9', PlatformType: 'Linux', PingStatus: 'Online' }] });
const sent = JSON.stringify({ Command: { CommandId: 'e4917865-d02f-4b1a-9efb-54782aa76d23' } });

describe('EC2 pairing through SSM', () => {
  it('rejects an unmanaged target before opening the pairing window', async () => {
    const request = input();
    await expect(pairEc2Automation(request, async () => JSON.stringify({ InstanceInformationList: [] })))
      .rejects.toThrow('automation_ec2_pair_target_unavailable');
    expect(request.startPairing).not.toHaveBeenCalled();
  });
  it('runs the fixed remote command and returns only metadata on success', async () => {
    const request = input();
    const run = vi.fn(async (args: string[]) => {
      if (args[1] === 'describe-instance-information') return managed;
      if (args[1] === 'send-command') return sent;
      return JSON.stringify({ Status: 'Success', ResponseCode: 0, StandardOutputContent: 'SECRET PROOF' });
    });
    const result = await pairEc2Automation(request, run, async () => {});
    expect(request.startPairing).toHaveBeenCalledOnce();
    expect(result).toEqual({ commandId: 'e4917865-d02f-4b1a-9efb-54782aa76d23', status: 'paired' });
    expect(JSON.stringify(result)).not.toContain('SECRET PROOF');
    const sendArgs = run.mock.calls.find(([args]) => args[1] === 'send-command')?.[0];
    expect(sendArgs).toContain('AWS-RunShellScript');
    const parameters = JSON.parse(sendArgs![sendArgs!.indexOf('--parameters') + 1]!);
    const command = parameters.commands[0] as string;
    expect(command).toContain('PATH=${PATH:+$PATH:}/usr/local/bin:/usr/bin:/bin; cli_path=$(command -v inheriti');
    const directory = mkdtempSync(join(tmpdir(), 'inheriti-ec2-pair-'));
    try {
      const cli = join(directory, 'inheriti');
      writeFileSync(cli, '#!/bin/sh\n[ "$INHERITI_AUTOMATION_PROVIDER" = AWS ] && [ "$INHERITI_AUTOMATION_CONNECTION_ID" = "e4917865-d02f-4b1a-9efb-54782aa76d23" ] && [ "$AWS_REGION" = us-east-1 ] && [ "$1 $2 $3" = "automations pair redeem" ]\n');
      chmodSync(cli, 0o755);
      expect(spawnSync('/bin/sh', ['-c', command], { env: { PATH: directory } }).status).toBe(0);
      // Stand in for /usr/local/bin without writing to the machine's install directory.
      expect(spawnSync('/bin/sh', ['-c', command.replace('/usr/local/bin:', `${directory}:`)],
        { env: { PATH: '/usr/bin:/bin' } }).status).toBe(0);
      chmodSync(cli, 0o644);
      expect(spawnSync('/bin/sh', ['-c', command], { env: { PATH: directory } }).status).toBe(78);
      rmSync(cli);
      expect(spawnSync('/bin/sh', ['-c', command], { env: { PATH: directory } }).status).toBe(78);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it('does not return remote output when SSM reports failure', async () => {
    const run = async (args: string[]) => args[1] === 'describe-instance-information' ? managed :
      args[1] === 'send-command' ? sent : JSON.stringify({ Status: 'Failed', StandardErrorContent: 'SECRET PROOF' });
    await expect(pairEc2Automation(input(), run, async () => {})).rejects.toThrow('automation_ec2_pair_failed');
  });
  it('identifies a missing instance CLI without exposing remote output', async () => {
    const run = async (args: string[]) => args[1] === 'describe-instance-information' ? managed :
      args[1] === 'send-command' ? sent : JSON.stringify({ Status: 'Failed', ResponseCode: 78, StandardErrorContent: 'SECRET PROOF' });
    await expect(pairEc2Automation(input(), run, async () => {})).rejects.toThrow('automation_ec2_pair_cli_missing');
  });
  it('waits for an eventually consistent SSM invocation', async () => {
    let polls = 0;
    const run = async (args: string[]) => {
      if (args[1] === 'describe-instance-information') return managed;
      if (args[1] === 'send-command') return sent;
      if (++polls === 1) throw new Error('automation_ec2_pair_invocation_pending');
      return JSON.stringify({ Status: 'Success', ResponseCode: 0 });
    };
    await expect(pairEc2Automation(input(), run, async () => {})).resolves.toMatchObject({ status: 'paired' });
    expect(polls).toBe(2);
  });
  it('reports an AWS CLI failure without exposing provider stderr', async () => {
    await expect(pairEc2Automation(input(), async () => { throw new Error('automation_ec2_pair_provider_failed'); }))
      .rejects.toThrow('automation_ec2_pair_provider_failed');
  });
});
