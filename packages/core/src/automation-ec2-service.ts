import { runCloudCommand } from './automation-cloud-target.js';
import type { AutomationRuntimeBundle } from './automation-runtime-setup.js';
import type { CloudCommandRunner } from './automation-cloud-target.js';

export type Ec2Instance = { region: string; instanceId: string; profileArn: string; roleArn: string };

const identifier = (value: string, pattern: RegExp): string => {
  if (!pattern.test(value)) throw new Error('automation_ec2_input_invalid');
  return value;
};
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('automation_ec2_identity_invalid');
  return value as Record<string, unknown>;
};
const array = (value: unknown): unknown[] => {
  if (!Array.isArray(value)) throw new Error('automation_ec2_identity_invalid');
  return value;
};
const string = (value: unknown): string => {
  if (typeof value !== 'string' || !value) throw new Error('automation_ec2_identity_invalid');
  return value;
};
const parse = (value: string): Record<string, unknown> => {
  try { return record(JSON.parse(value)); } catch { throw new Error('automation_cloud_inspection_failed'); }
};

export async function inspectEc2AutomationInstance(
  input: { region: string; instanceId: string },
  run: CloudCommandRunner = runCloudCommand,
): Promise<Ec2Instance> {
  const region = identifier(input.region, /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/);
  const instanceId = identifier(input.instanceId, /^i-[0-9a-f]{8,17}$/);
  const response = parse(await run('aws', ['ec2', 'describe-instances', '--instance-ids', instanceId,
    '--region', region, '--output', 'json']));
  const instances = array(response.Reservations).flatMap(reservation => array(record(reservation).Instances));
  if (instances.length !== 1) throw new Error('automation_ec2_identity_invalid');
  const instance = record(instances[0]);
  if (instance.InstanceId !== instanceId) throw new Error('automation_ec2_identity_invalid');
  const profileArn = string(record(instance.IamInstanceProfile).Arn);
  const profileName = /^arn:aws(?:-[a-z]+)*:iam::\d{12}:instance-profile\/(?:[\w+=,.@-]+\/)*([\w+=,.@-]+)$/.exec(profileArn)?.[1];
  if (!profileName) throw new Error('automation_ec2_identity_invalid');
  const profileResponse = parse(await run('aws', ['iam', 'get-instance-profile', '--instance-profile-name', profileName,
    '--output', 'json']));
  const profile = record(profileResponse.InstanceProfile);
  if (profile.Arn !== profileArn) throw new Error('automation_ec2_identity_invalid');
  const roles = array(profile.Roles);
  if (roles.length !== 1) throw new Error('automation_ec2_identity_invalid');
  const roleArn = string(record(roles[0]).Arn);
  if (!/^arn:aws(?:-[a-z]+)*:iam::\d{12}:role\//.test(roleArn)) throw new Error('automation_ec2_identity_invalid');
  return { region, instanceId, profileArn, roleArn };
}

export type Ec2ServiceInput = {
  bundle: AutomationRuntimeBundle;
  applicationCommand: string[];
  serviceName: string;
  runAsUser: string;
  launcherPath: string;
};

export type Ec2ServicePreparation = {
  runScriptPath: string;
  runScript: string;
  unitName: string;
  unit: string;
  instructions: string[];
};

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

export function prepareEc2AutomationService(input: Ec2ServiceInput): Ec2ServicePreparation {
  const serviceName = identifier(input.serviceName, /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,127}$/);
  const runAsUser = identifier(input.runAsUser, /^[a-z_][a-z0-9_-]{0,31}$/);
  const launcherPath = identifier(input.launcherPath, /^\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/);
  if (input.bundle.provider !== 'AWS' || !input.applicationCommand.length ||
      input.applicationCommand.some(arg => !arg || /[\x00-\x1f\x7f]/.test(arg))) {
    throw new Error('automation_ec2_input_invalid');
  }
  const environment = Object.entries(input.bundle.environment);
  if (environment.some(([name, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ||
      /[\x00-\x1f\x7f]/.test(value))) throw new Error('automation_ec2_input_invalid');
  const runScriptPath = `/opt/inheriti/${serviceName}-run.sh`;
  const unitName = `${serviceName}.service`;
  const runScript = [
    '#!/bin/sh',
    'set -eu',
    ...environment.map(([name, value]) => `export ${name}=${shellQuote(value)}`),
    `exec ${[launcherPath, ...input.applicationCommand].map(shellQuote).join(' ')}`,
    '',
  ].join('\n');
  const unit = [
    '[Unit]',
    'Description=Inheriti protected application',
    'Wants=network-online.target',
    'After=network-online.target',
    '',
    '[Service]',
    `User=${runAsUser}`,
    `ExecStart=/bin/sh ${runScriptPath}`,
    'Restart=on-failure',
    'RestartSec=5',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n');
  return {
    runScriptPath, runScript, unitName, unit,
    instructions: [
      `Install the Inheriti CLI and generated launcher at ${launcherPath} on the EC2 instance.`,
      `Save the generated run script as ${runScriptPath}, owned by ${runAsUser} with restricted permissions.`,
      `Save the unit as /etc/systemd/system/${unitName}; review it alongside the existing application service before enabling it.`,
      `Run systemctl daemon-reload, then enable and start ${unitName} when ready to switch application startup.`,
      'The instance profile must keep the verified IAM role. Each service start requests plan access and completes the existing approval flow before launching the application.',
    ],
  };
}
