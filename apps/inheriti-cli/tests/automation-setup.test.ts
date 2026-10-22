import { beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { getConnection, listConnections, listGrants, inspectCloudTarget, inspectEc2AutomationInstance, installEc2AutomationService, prepareEc2AutomationService, generateAutomationRuntimeBundle, applyEcsAutomation, applyCloudRunServiceAutomation, resolveAutomationImage } = vi.hoisted(() => ({
  getConnection: vi.fn(async () => ({ id: 'connection-1', provider: 'AWS', status: 'VERIFIED', trust: { method: 'AWS_IAM_ROLE', roleArn: 'arn:aws:iam::123456789012:role/task' } })),
  listConnections: vi.fn(async () => [{ id: 'connection-1', name: 'ECS', provider: 'AWS', status: 'VERIFIED' }]),
  listGrants: vi.fn(async () => [{ connectionId: 'connection-1', status: 'ACTIVE' }]),
  inspectCloudTarget: vi.fn(async () => ({ target: { provider: 'AWS', region: 'us-east-1', cluster: 'jobs', service: 'worker' }, image: 'image:tag', identity: 'arn:aws:iam::123456789012:role/task', revision: 'rev:1', command: ['--secret=NEVER_PRINT'], environmentNames: ['EXISTING_SECRET'] })),
  inspectEc2AutomationInstance: vi.fn(async () => ({ region: 'us-east-1', instanceId: 'i-123', roleArn: 'arn:aws:iam::123456789012:role/task' })),
  installEc2AutomationService: vi.fn(async () => ({ commandId: 'command-1', unitName: 'inheriti-worker.service' })),
  prepareEc2AutomationService: vi.fn(() => ({ runScriptPath: '/opt/inheriti/run.sh', unitName: 'inheriti-worker.service', instructions: ['Install the launcher'], runScript: '#!/bin/sh', unit: '[Service]' })),
  generateAutomationRuntimeBundle: vi.fn(() => ({ provider: 'AWS', target: 'ECS task', script: '#!/bin/sh\nexec inheriti secrets exec "$@"', environment: { INHERITI_AUTOMATION_PROVIDER: 'AWS' }, requiredEnvironment: ['AWS_REGION'], instructions: ['Install CLI in image'] })),
  applyEcsAutomation: vi.fn(async () => ({ status: 'deployed', revision: 'rev:2', previousRevision: 'rev:1' })),
  applyCloudRunServiceAutomation: vi.fn(async () => ({ status: 'updated', revision: 'rev:2', previousRevision: 'rev:1' })),
  resolveAutomationImage: vi.fn(async (image: string) => image),
}));
vi.mock('@safetech/inheriti-elements-core/node-base', async original => ({
  ...(await original<object>()),
  createAutomationSetupOperations: () => ({ getConnection, listConnections, listGrants }),
  inspectCloudTarget,
  inspectEc2AutomationInstance,
  installEc2AutomationService,
  prepareEc2AutomationService,
  generateAutomationRuntimeBundle,
  applyEcsAutomation,
  applyCloudRunServiceAutomation,
  resolveAutomationImage,
}));
vi.mock('../src/render/select.js', () => ({ promptSelect: vi.fn(async () => 'connection-1'), promptText: vi.fn() }));

import { automationSetup } from '../src/commands/automation-setup.js';

const terminal = () => ({ interactive: false, stdoutIsTTY: false, columns: 80, write: vi.fn(), writeError: vi.fn() });
const getPlan = vi.fn(async () => ({ assets: [{ id: 'asset-1', code: 'asset', isBinary: false, fieldNames: ['password', 'username'] }] }));
const context = { organization: { id: 'org-1' }, core: { getAccessToken: async () => 'token', getPlan } };
const configuration = { apiUrl: 'http://business.localhost:3400/integrations/' };
const args = ['--plan', '485384e3-b685-4142-b1ca-95a0b90e56ba', '--connection', 'connection-1', '--field', 'asset.password', '--env-name', 'APP_SECRET', '--region', 'us-east-1', '--cluster', 'jobs', '--service', 'worker', '--script-path', '/opt/inheriti/launch.sh'];

beforeEach(() => vi.clearAllMocks());

it('prints only a safe preview and script, without raw provider startup arguments', async () => {
  const output = terminal();
  expect(await automationSetup(context as never, configuration as never, output, args)).toBe(0);
  expect(inspectCloudTarget).toHaveBeenCalledWith(expect.objectContaining({ provider: 'AWS', service: 'worker' }));
  const printed = output.write.mock.calls.flat().join('\n');
  expect(printed).toContain('preview_only');
  expect(printed).toContain('--- Launcher script');
  expect(printed).toContain('launch.sh');
  expect(printed).not.toContain('NEVER_PRINT');
  expect(printed).not.toContain('EXISTING_SECRET');
});

it('maps multiple plan fields into one launcher and rejects duplicate variable names', async () => {
  const multi = [...args.slice(0, 4), '--map', 'APP_SECRET=asset.password', '--map', 'APP_USER=asset.username', ...args.slice(8)];
  const output = terminal();
  expect(await automationSetup(context as never, configuration as never, output, multi)).toBe(0);
  expect(generateAutomationRuntimeBundle).toHaveBeenCalledWith(expect.objectContaining({ mappings: [
    { envName: 'APP_SECRET', selector: 'asset.password' }, { envName: 'APP_USER', selector: 'asset.username' },
  ] }));
  const invalid = terminal();
  expect(await automationSetup(context as never, configuration as never, invalid,
    [...multi, '--map', 'APP_USER=asset.password'])).toBe(1);
  expect(invalid.write).not.toHaveBeenCalled();
});

it('previews all plan fields except excluded ones and reviews bulk apply interactively', async () => {
  const bulk = [...args.slice(0, 4), '--map-all', '--except', 'asset.password',
    '--map', 'APP_USER=asset.username', ...args.slice(8)];
  const preview = terminal();
  expect(await automationSetup(context as never, configuration as never, preview, bulk)).toBe(0);
  expect(preview.write.mock.calls.flat().join('\n')).toContain('APP_USER');
  expect(generateAutomationRuntimeBundle).toHaveBeenLastCalledWith(expect.objectContaining({ mappings: [
    { selector: 'asset.username', envName: 'APP_USER' },
  ] }));
  const applyArgs = [...bulk.slice(0, -2), '--apply', '--image', 'repo@sha256:' + 'a'.repeat(64),
    '--cli-path', '/usr/local/bin/inheriti', '--expect-revision', 'rev:1'];
  const noninteractive = terminal();
  expect(await automationSetup(context as never, configuration as never, noninteractive, applyArgs)).toBe(1);
  const interactive = { ...terminal(), interactive: true };
  const { promptSelect } = await import('../src/render/select.js');
  vi.mocked(promptSelect).mockResolvedValueOnce('cancel');
  expect(await automationSetup(context as never, configuration as never, interactive, applyArgs)).toBe(1);
  expect(interactive.write.mock.calls.flat().join('\n')).toContain('APP_USER');
});

it('uses generated names for only-selected fields', async () => {
  const output = terminal();
  const only = [...args.slice(0, 4), '--only', 'asset.username', ...args.slice(8)];
  expect(await automationSetup(context as never, configuration as never, output, only)).toBe(0);
  expect(generateAutomationRuntimeBundle).toHaveBeenLastCalledWith(expect.objectContaining({ mappings: [
    { selector: 'asset.username', envName: 'ASSET_USERNAME' },
  ] }));
});

it('prints a launcher for a VM or cluster without inspecting or changing a managed target', async () => {
  inspectCloudTarget.mockClear();
  const output = terminal();
  expect(await automationSetup(context as never, configuration as never, output, args.slice(0, 8))).toBe(0);
  expect(inspectCloudTarget).not.toHaveBeenCalled();
  expect(output.write.mock.calls.flat().join('\n')).toContain('manual_setup_required');
});

it('saves a new launcher in the build context and prints Dockerfile lines using its chosen path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'inheriti-setup-'));
  const previous = process.cwd();
  try {
    process.chdir(directory);
    const output = terminal();
    const manual = [...args.slice(0, 8), '--save', 'launch.sh'];
    expect(await automationSetup(context as never, configuration as never, output, manual)).toBe(0);
    expect(await readFile(join(directory, 'launch.sh'), 'utf8')).toBe('#!/bin/sh\nexec inheriti secrets exec "$@"\n');
    expect((await stat(join(directory, 'launch.sh'))).mode & 0o111).toBeTruthy();
    const printed = output.write.mock.calls.flat().join('\n');
    expect(printed).toContain('COPY ["./launch.sh","/usr/local/bin/inheriti-automation"]');
    expect(printed).toContain('RUN chmod +x /usr/local/bin/inheriti-automation');
    expect(printed).toContain('ENTRYPOINT ["/usr/local/bin/inheriti-automation"]');
    expect(printed).toContain('Remove any ECS entryPoint or Cloud Run command override');
    expect(await automationSetup(context as never, configuration as never, output, manual)).toBe(1);
    expect(await automationSetup(context as never, configuration as never, output,
      [...args.slice(0, 8), '--save', '../escape.sh'])).toBe(1);
    expect(await automationSetup(context as never, configuration as never, output,
      [...args.slice(0, 8), '--save', 'launch[1].sh'])).toBe(1);
  } finally {
    process.chdir(previous);
    await rm(directory, { recursive: true, force: true });
  }
});

it('offers print or save when manual setup is interactive', async () => {
  const { promptSelect, promptText } = await import('../src/render/select.js');
  vi.mocked(promptSelect).mockResolvedValueOnce('print');
  const output = { ...terminal(), interactive: true };
  expect(await automationSetup(context as never, configuration as never, output, args.slice(0, 8))).toBe(0);
  expect(promptSelect).toHaveBeenCalledWith('How should the launcher be delivered?', expect.any(Array));
  expect(promptText).not.toHaveBeenCalled();
  expect(output.write.mock.calls.flat().join('\n')).toContain('--- Launcher script');
});

it('prepares a persistent EC2 launcher with the attached role and application command', async () => {
  const output = terminal();
  const ec2Args = [
    '--plan', '485384e3-b685-4142-b1ca-95a0b90e56ba', '--connection', 'connection-1',
    '--field', 'asset.password', '--env-name', 'APP_SECRET', '--region', 'us-east-1',
    '--instance', 'i-123', '--service-name', 'worker', '--run-as-user', 'ubuntu',
    '--script-path', '/opt/inheriti/run.sh', '--', '/usr/bin/node', 'server.js',
  ];
  expect(await automationSetup(context as never, configuration as never, output, ec2Args)).toBe(0);
  expect(inspectEc2AutomationInstance).toHaveBeenCalledWith({ region: 'us-east-1', instanceId: 'i-123' });
  expect(inspectCloudTarget).not.toHaveBeenCalled();
  expect(prepareEc2AutomationService).toHaveBeenCalledWith(expect.objectContaining({
    serviceName: 'worker', runAsUser: 'ubuntu', launcherPath: '/opt/inheriti/run.sh',
    applicationCommand: ['/usr/bin/node', 'server.js'],
    bundle: expect.objectContaining({ environment: expect.objectContaining({ AWS_REGION: 'us-east-1' }) }),
  }));
  const printed = output.write.mock.calls.flat().join('\n');
  expect(printed).toContain('installation_required');
  expect(printed).toContain('inheriti-worker.service');
});

it('confirms EC2 installation before sending files and leaves the service stopped', async () => {
  const ec2Args = [
    '--plan', '485384e3-b685-4142-b1ca-95a0b90e56ba', '--connection', 'connection-1',
    '--field', 'asset.password', '--env-name', 'APP_SECRET', '--region', 'us-east-1',
    '--instance', 'i-123', '--service-name', 'worker.service', '--run-as-user', 'ubuntu',
    '--install', '--', '/usr/bin/node', 'server.js',
  ];
  const noninteractive = terminal();
  expect(await automationSetup(context as never, configuration as never, noninteractive, ec2Args)).toBe(1);
  expect(installEc2AutomationService).not.toHaveBeenCalled();
  const { promptSelect } = await import('../src/render/select.js');
  vi.mocked(promptSelect).mockResolvedValueOnce('cancel');
  expect(await automationSetup(context as never, configuration as never, { ...terminal(), interactive: true }, ec2Args)).toBe(1);
  expect(installEc2AutomationService).not.toHaveBeenCalled();
  vi.mocked(promptSelect).mockResolvedValueOnce('install');
  const output = { ...terminal(), interactive: true };
  expect(await automationSetup(context as never, configuration as never, output, ec2Args)).toBe(0);
  expect(installEc2AutomationService).toHaveBeenCalledWith(expect.objectContaining({
    region: 'us-east-1', instanceId: 'i-123', runAsUser: 'ubuntu', launcher: expect.stringContaining('inheriti'),
    applicationCommand: ['/usr/bin/node', 'server.js'], replace: false,
  }));
  expect(output.write.mock.calls.flat().join('\n')).toContain('The service will not be enabled or started');
  vi.mocked(promptSelect).mockResolvedValueOnce('install');
  expect(await automationSetup(context as never, configuration as never, output,
    [...ec2Args.slice(0, -3), '--replace', ...ec2Args.slice(-3)])).toBe(0);
  expect(installEc2AutomationService).toHaveBeenLastCalledWith(expect.objectContaining({ replace: true }));
});

it('rejects an EC2 launcher when the instance role differs from the connection', async () => {
  inspectEc2AutomationInstance.mockResolvedValueOnce({ region: 'us-east-1', instanceId: 'i-123', roleArn: 'arn:aws:iam::123456789012:role/other' });
  const output = terminal();
  const ec2Args = [
    '--plan', '485384e3-b685-4142-b1ca-95a0b90e56ba', '--connection', 'connection-1',
    '--field', 'asset.password', '--env-name', 'APP_SECRET', '--region', 'us-east-1',
    '--instance', 'i-123', '--service-name', 'worker', '--run-as-user', 'ubuntu',
    '--', '/usr/bin/node', 'server.js',
  ];
  expect(await automationSetup(context as never, configuration as never, output, ec2Args)).toBe(1);
  expect(output.writeError.mock.calls.flat().join('\n')).toContain('does not match');
  expect(prepareEc2AutomationService).not.toHaveBeenCalled();
});

it('accepts a Cloud Run service target and dispatches its apply operation', async () => {
  getConnection.mockResolvedValueOnce({ id: 'connection-1', provider: 'GOOGLE_CLOUD', status: 'VERIFIED',
    trust: { method: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC', serviceAccountSubject: '12345' } } as never);
  inspectCloudTarget.mockResolvedValueOnce({ target: { provider: 'GOOGLE_CLOUD', project: 'project', region: 'us-central1', service: 'api' },
    image: 'image:tag', identity: 'api@project.iam.gserviceaccount.com', identityNumericId: '12345', revision: 'rev:1',
    command: ['/bin/api'], environmentNames: [] } as never);
  const output = terminal();
  expect(await automationSetup(context as never, configuration as never, output,
    [...args.slice(0, 8), '--project', 'project', '--region', 'us-central1', '--service', 'api', '--apply',
      '--image', 'repo@sha256:' + 'a'.repeat(64), '--cli-path', '/usr/local/bin/inheriti', '--expect-revision', 'rev:1'])).toBe(0);
  expect(applyCloudRunServiceAutomation).toHaveBeenCalledWith(expect.objectContaining({
    target: expect.objectContaining({ service: 'api' }), expectedServiceAccount: 'api@project.iam.gserviceaccount.com',
  }));
});

it('checks the selected plan field before generating a launcher', async () => {
  const output = terminal();
  getPlan.mockResolvedValueOnce({ assets: [{ id: 'asset-1', code: 'asset', isBinary: true, fieldNames: ['password'] }] });
  expect(await automationSetup(context as never, configuration as never, output, args)).toBe(1);
  expect(output.writeError.mock.calls.flat().join('\n')).toContain('Check plan text fields');
  expect(output.write).not.toHaveBeenCalled();
});

it('requires a verified connection with active access and rejects secret flags', async () => {
  const output = terminal();
  expect(await automationSetup(context as never, configuration as never, output, [...args, '--proof', 'NEVER_PRINT'])).toBe(1);
  expect(inspectCloudTarget).not.toHaveBeenCalled();
  listGrants.mockResolvedValueOnce([{ connectionId: 'connection-1', status: 'PENDING' }] as never);
  expect(await automationSetup(context as never, configuration as never, output, args)).toBe(1);
  expect(output.write).not.toHaveBeenCalled();
});

it('selects an eligible connection when none is passed in an interactive terminal', async () => {
  const output = { ...terminal(), interactive: true };
  expect(await automationSetup(context as never, configuration as never, output,
    args.filter((_, index) => index !== 2 && index !== 3))).toBe(0);
  expect(listConnections).toHaveBeenCalled();
  expect(getConnection).toHaveBeenCalledWith('connection-1');
});

it('defaults the managed preview and apply to the documented CLI path', async () => {
  applyEcsAutomation.mockClear();
  const preview = terminal();
  expect(await automationSetup(context as never, configuration as never, preview, args.slice(0, -2))).toBe(0);
  expect(preview.write.mock.calls.flat().join('\n')).toContain('/usr/local/bin/inheriti');
  const output = terminal();
  const applyArgs = [...args.slice(0, -2), '--apply', 'true', '--image', 'repo@sha256:' + 'a'.repeat(64),
    '--expect-revision', 'rev:1'];
  applyArgs.splice(applyArgs.indexOf('--apply') + 1, 1);
  expect(await automationSetup(context as never, configuration as never, output, applyArgs)).toBe(0);
  expect(applyEcsAutomation).toHaveBeenCalledWith(expect.objectContaining({
    cliPath: '/usr/local/bin/inheriti',
    expectedRevision: 'rev:1', expectedRoleArn: 'arn:aws:iam::123456789012:role/task',
    target: expect.objectContaining({ service: 'worker' }),
  }));
  expect(output.write.mock.calls.flat().join('\n')).not.toContain('NEVER_PRINT');
  const stale = terminal();
  expect(await automationSetup(context as never, configuration as never, stale,
    [...applyArgs.slice(0, -1), 'rev:0'])).toBe(1);
  expect(applyEcsAutomation).toHaveBeenCalledTimes(1);
});

it('passes and reports the resolved image on apply', async () => {
  const image = '123456789012.dkr.ecr.eu-west-1.amazonaws.com/worker@sha256:' + 'b'.repeat(64);
  resolveAutomationImage.mockResolvedValueOnce(image);
  const output = terminal();
  expect(await automationSetup(context as never, configuration as never, output,
    [...args.slice(0, -2), '--apply', '--image', '123456789012.dkr.ecr.eu-west-1.amazonaws.com/worker:v1', '--expect-revision', 'rev:1'])).toBe(0);
  expect(applyEcsAutomation).toHaveBeenCalledWith(expect.objectContaining({ image }));
  expect(output.write.mock.calls.flat().join('\n')).toContain(image);
});

it('accepts an absolute CLI override and rejects a relative override', async () => {
  applyEcsAutomation.mockClear();
  const applyArgs = [...args.slice(0, -2), '--apply', '--image', 'repo@sha256:' + 'a'.repeat(64),
    '--cli-path', '/opt/inheriti/bin/inheriti', '--expect-revision', 'rev:1'];
  expect(await automationSetup(context as never, configuration as never, terminal(), applyArgs)).toBe(0);
  expect(applyEcsAutomation).toHaveBeenCalledWith(expect.objectContaining({ cliPath: '/opt/inheriti/bin/inheriti' }));
  const invalid = terminal();
  expect(await automationSetup(context as never, configuration as never, invalid,
    [...applyArgs.slice(0, -4), '--cli-path', 'bin/inheriti', '--expect-revision', 'rev:1'])).toBe(1);
  expect(invalid.writeError).toHaveBeenCalled();
  expect(applyEcsAutomation).toHaveBeenCalledTimes(1);
  const invalidPreview = terminal();
  expect(await automationSetup(context as never, configuration as never, invalidPreview,
    [...args.slice(0, -2), '--cli-path', 'bin/inheriti'])).toBe(1);
  expect(invalidPreview.writeError).toHaveBeenCalled();
});

it('shows an interactive preview and defaults to cancellation before applying', async () => {
  applyEcsAutomation.mockClear();
  const output = { ...terminal(), interactive: true };
  const applyArgs = [...args.slice(0, -2), '--apply', '--image', 'repo@sha256:' + 'a'.repeat(64),
    '--cli-path', '/usr/local/bin/inheriti'];
  const { promptSelect } = await import('../src/render/select.js');
  vi.mocked(promptSelect).mockResolvedValueOnce('cancel');
  expect(await automationSetup(context as never, configuration as never, output, applyArgs)).toBe(1);
  expect(output.write.mock.calls.flat().join('\n')).toContain('awaiting_confirmation');
  expect(applyEcsAutomation).not.toHaveBeenCalled();
  vi.mocked(promptSelect).mockResolvedValueOnce('apply');
  expect(await automationSetup(context as never, configuration as never, output, applyArgs)).toBe(0);
  expect(applyEcsAutomation).toHaveBeenCalledTimes(1);
});
