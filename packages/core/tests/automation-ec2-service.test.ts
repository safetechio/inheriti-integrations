import { describe, expect, it, vi } from 'vitest';
import { inspectEc2AutomationInstance, prepareEc2AutomationService } from '../src/automation-ec2-service.js';

const instanceId = 'i-0123456789abcdef0';
const profileArn = 'arn:aws:iam::123456789012:instance-profile/apps/production';
const roleArn = 'arn:aws:iam::123456789012:role/apps/production';

describe('EC2 automation preparation', () => {
  it('inspects the exact attached instance profile and its single IAM role', async () => {
    const run = vi.fn(async (_binary, args: string[]) => JSON.stringify(args[0] === 'ec2'
      ? { Reservations: [{ Instances: [{ InstanceId: instanceId, IamInstanceProfile: { Arn: profileArn } }] }] }
      : { InstanceProfile: { Arn: profileArn, Roles: [{ Arn: roleArn }] } }));
    await expect(inspectEc2AutomationInstance({ region: 'us-east-1', instanceId }, run))
      .resolves.toEqual({ region: 'us-east-1', instanceId, profileArn, roleArn });
    expect(run).toHaveBeenCalledWith('aws', ['ec2', 'describe-instances', '--instance-ids', instanceId,
      '--region', 'us-east-1', '--output', 'json']);
    expect(run).toHaveBeenCalledWith('aws', ['iam', 'get-instance-profile',
      '--instance-profile-name', 'production', '--output', 'json']);
  });

  it('rejects a missing or ambiguous role before preparing access', async () => {
    const run = vi.fn(async (_binary, args: string[]) => JSON.stringify(args[0] === 'ec2'
      ? { Reservations: [{ Instances: [{ InstanceId: instanceId, IamInstanceProfile: { Arn: profileArn } }] }] }
      : { InstanceProfile: { Arn: profileArn, Roles: [] } }));
    await expect(inspectEc2AutomationInstance({ region: 'us-east-1', instanceId }, run))
      .rejects.toThrow('automation_ec2_identity_invalid');
  });

  it('generates a service that starts the application through the protected launcher', () => {
    const prepared = prepareEc2AutomationService({
      bundle: { provider: 'AWS', target: 'ECS task', script: '', requiredEnvironment: [], instructions: [],
        environment: { INHERITI_AUTOMATION_PROVIDER: 'AWS', INHERITI_AUTOMATION_CONNECTION_ID: 'connection-id' } },
      applicationCommand: ['/usr/bin/node', '/srv/app/main.js', "user's arg"],
      serviceName: 'my-app', runAsUser: 'app', launcherPath: '/opt/inheriti/launch.sh',
    });
    expect(prepared.runScript).toContain("exec '/opt/inheriti/launch.sh' '/usr/bin/node' '/srv/app/main.js' 'user'\\''s arg'");
    expect(prepared.runScript).toContain("export INHERITI_AUTOMATION_PROVIDER='AWS'");
    expect(prepared.unit).toContain('User=app\nExecStart=/bin/sh /opt/inheriti/my-app-run.sh\nRestart=on-failure');
    expect(prepared.unit).toContain('Restart=on-failure\nRestartPreventExitStatus=77\nRestartSec=5');
    expect(prepared.unit).toContain('WantedBy=multi-user.target');
    expect(prepared.runScript).toContain('export PATH=/usr/local/bin:/usr/bin:/bin:${PATH:-}');
  });

  it('accepts a service name with its systemd suffix only once', () => {
    const prepared = prepareEc2AutomationService({
      bundle: { provider: 'AWS', target: 'ECS task', script: '', environment: {}, requiredEnvironment: [], instructions: [] },
      applicationCommand: ['/usr/bin/node'], serviceName: 'my-app.service', runAsUser: 'app',
      launcherPath: '/usr/local/bin/inheriti-automation',
    });
    expect(prepared.unitName).toBe('my-app.service');
    expect(prepared.runScriptPath).toBe('/opt/inheriti/my-app-run.sh');
  });

  it('rejects commands and service names that could inject shell or unit directives', () => {
    const base = { bundle: { provider: 'AWS' as const, target: 'ECS task' as const, script: '', environment: {},
      requiredEnvironment: [], instructions: [] }, applicationCommand: ['/usr/bin/node'],
      serviceName: 'app', runAsUser: 'app', launcherPath: '/opt/inheriti/launch.sh' };
    expect(() => prepareEc2AutomationService({ ...base, applicationCommand: ['node\nrm -rf /'] }))
      .toThrow('automation_ec2_input_invalid');
    expect(() => prepareEc2AutomationService({ ...base, serviceName: 'app\nExecStart=/bin/false' }))
      .toThrow('automation_ec2_input_invalid');
  });
});
