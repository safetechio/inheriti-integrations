import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { listConnections, listGrants, proofBrowser, createConnection, createGrant, activateGrant, disableConnection, changeTrust, revokeGrant, replaceResponsibleMember, getVerifiedGithubRelease, close, complete, windowClosed, select, installEc2Cli } = vi.hoisted(() => ({
  listConnections: vi.fn(async () => [{ id: 'connection-1', name: 'CI', provider: 'GITHUB', environment: 'TEST', status: 'ACTIVE', trust: { privateKey: 'NEVER_PRINT' }, verifiedIdentity: 'NEVER_PRINT' }]),
  listGrants: vi.fn(async () => [{ id: 'grant-1', connectionId: 'connection-1', responsibleMemberId: 'member-1', status: 'ACTIVE', proof: 'NEVER_PRINT' }]),
  close: vi.fn(), complete: vi.fn(), windowClosed: { callback: undefined as undefined | ((reason: 'unavailable' | 'closed') => void) },
  proofBrowser: vi.fn(async (_options: { signal: AbortSignal }) => ({ action: 'verified' })),
  createConnection: vi.fn(async () => {}), createGrant: vi.fn(async () => {}), activateGrant: vi.fn(async () => {}),
  disableConnection: vi.fn(async () => {}), changeTrust: vi.fn(async () => {}),
  revokeGrant: vi.fn(async () => {}), replaceResponsibleMember: vi.fn(async () => {}),
  getVerifiedGithubRelease: vi.fn(async () => ({ actionRepository: 'safetechio/inheriti-integrations', actionRef: 'a'.repeat(40), cliVersion: '1.2.3' })),
  select: vi.fn(async () => 'ec2'),
  installEc2Cli: vi.fn(async () => ({ instanceId: 'i-09ce8440ae7294ab9', commandId: '11111111-1111-4111-8111-111111111111' })),
}));
vi.mock('../src/render/select.js', async original => ({ ...(await original<object>()), promptSelect: select }));
vi.mock('@safetech/inheriti-elements-core/node-base', async original => ({
  ...(await original<object>()),
  createAutomationSetupOperations: () => ({ listConnections, listGrants, createConnection, createGrant, activateGrant,
    disableConnection, changeTrust, revokeGrant, replaceResponsibleMember, getVerifiedGithubRelease }),
  createNativeWindowSession: (callback: (reason: 'unavailable' | 'closed') => void) => { windowClosed.callback = callback; return { open: vi.fn(), close, complete }; },
  runLocalAutomationProofBrowser: proofBrowser,
  installEc2Cli,
}));

import { automationManage, automationMetadata, automationRuntimeInstructions, automationRuntimeInstallEc2 } from '../src/commands/automations.js';

const terminal = (interactive = true) => ({ interactive, stdoutIsTTY: interactive, columns: 80, write: vi.fn(), writeError: vi.fn() });
const context = { organization: { id: 'org-1', name: 'Acme' }, core: { getAccessToken: vi.fn(async () => 'human-token') } };
const configuration = { apiUrl: 'http://business.localhost:3400/integrations/', business: true };

it('prints only allowlisted connection and grant metadata', async () => {
  const output = terminal(false);
  expect(await automationMetadata(context as never, configuration as never, output)).toBe(0);
  expect(await automationMetadata(context as never, configuration as never, output, 'plan-1')).toBe(0);
  const printed = output.write.mock.calls.flat().join('\n');
  expect(printed).toContain('connection-1');
  expect(printed).toContain('member-1');
  expect(printed).not.toContain('NEVER_PRINT');
  expect(listGrants).toHaveBeenCalledWith('plan-1');
});

it('prints GitHub usage only for an active grant and verified connection with exact destination', async () => {
  listConnections.mockResolvedValueOnce([{ id: 'connection-1', name: 'CI', provider: 'GITHUB', status: 'VERIFIED', trust: { method: 'GITHUB_ACTIONS_OIDC', repositoryName: 'owner/repo', environment: 'production', workflow: 'owner/repo/.github/workflows/deploy.yml@refs/heads/release/v2' } }] as never);
  const output = terminal(false);
  expect(await automationManage(context as never, configuration as never, output, new AbortController().signal, ['usage', '--plan', 'plan-1', '--connection', 'connection-1', '--field', '123-asset.password'])).toBe(0);
  const printed = output.write.mock.calls.flat().join('\n');
  expect(printed).toContain('owner/repo/.github/workflows/deploy.yml on branch release/v2');
  expect(printed).toContain(`uses: safetechio/inheriti-integrations/integrations/github-actions@${'a'.repeat(40)}`);
  expect(printed).toContain('INHERITI_SECRET=123-asset.password');
  expect(printed).not.toContain('NEVER_PRINT');
  expect(getVerifiedGithubRelease).toHaveBeenCalledOnce();
});

it('does not print a guessed workflow when the verified release is unavailable', async () => {
  listConnections.mockResolvedValueOnce([{ id: 'connection-1', name: 'CI', provider: 'GITHUB', status: 'VERIFIED', trust: { method: 'GITHUB_ACTIONS_OIDC', repositoryName: 'owner/repo', environment: 'production', workflow: 'owner/repo/.github/workflows/deploy.yml@refs/heads/main' } }] as never);
  getVerifiedGithubRelease.mockRejectedValueOnce(new Error('automation_verified_release_unavailable'));
  const output = terminal(false);
  await expect(automationManage(context as never, configuration as never, output, new AbortController().signal, ['usage', '--plan', 'plan-1', '--connection', 'connection-1', '--field', 'account.password'])).rejects.toThrow('automation_verified_release_unavailable');
  expect(output.write).not.toHaveBeenCalled();
});

it('prints spaced EC2 and Dockerfile instructions for a noninteractive terminal', async () => {
  const output = terminal(false);
  expect(await automationRuntimeInstructions(output, '1.2.3-dev.4')).toBe(0);
  const printed = output.write.mock.calls.flat().join('\n');
  expect(printed).toContain('this exact version to be published on npm');
  expect(printed).toContain('\nLinux EC2 instance\n');
  expect(printed).toContain('\nECS / Cloud Run container\n');
  expect(printed).toContain('Run from your computer with AWS CLI and SSM');
  expect(printed).toContain('inheriti automations runtime install ec2 --region REGION --instance INSTANCE_ID');
  expect(printed).toContain('setup --install checks service-user access');
  expect(printed).not.toContain('Confirm the systemd service user');
  expect(printed).toContain("1. Add this instruction to your application's final Dockerfile stage");
  expect(printed).toContain('2. Build and deploy the image');
  expect(printed).toContain('RUN npm install --engine-strict --global @safetech/inheriti-cli@1.2.3-dev.4');
  expect(printed).toContain(`&& test "$(inheriti --version)" = '1.2.3-dev.4'`);
  expect(printed).toContain("project's normal pipeline");
  expect(printed).not.toContain('runtime image --image');
  expect(printed).not.toContain('NEVER_PRINT');
  expect(getVerifiedGithubRelease).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
});

it('prints local artifact instructions without claiming the CLI is on npm', async () => {
  const output = terminal(false);
  expect(await automationRuntimeInstructions(output, '0.0.19-local.0')).toBe(0);
  const printed = output.write.mock.calls.flat().join('\n');
  expect(printed).toContain('COPY inheriti-cli.tgz /tmp/inheriti-cli.tgz');
  expect(printed).toContain('npm install --engine-strict --global --prefix /usr/local /tmp/inheriti-cli.tgz');
  expect(printed).toContain(`test "$(/usr/local/bin/inheriti --version)" = '0.0.19-local.0'`);
  expect(printed).toContain('do not commit it');
  expect(printed).toContain('This local build cannot be installed through the EC2 command');
  expect(printed).toContain('Keep this tarball change uncommitted');
  expect(printed).not.toContain('The Dockerfile change persists in later builds');
  expect(printed).not.toContain('requires this exact version to be published on npm');
  expect(printed).not.toContain('@safetech/inheriti-cli@0.0.19-local.0');
});

it('shows only the selected target in an interactive terminal', async () => {
  const ec2 = terminal();
  select.mockResolvedValueOnce('ec2');
  expect(await automationRuntimeInstructions(ec2, '1.2.3-dev.4')).toBe(0);
  expect(ec2.write.mock.calls.flat().join('\n')).toContain('Linux EC2 instance');
  expect(ec2.write.mock.calls.flat().join('\n')).not.toContain('Dockerfile');
  const container = terminal();
  select.mockResolvedValueOnce('container');
  expect(await automationRuntimeInstructions(container, '1.2.3-dev.4')).toBe(0);
  expect(container.write.mock.calls.flat().join('\n')).toContain('Dockerfile');
  expect(container.write.mock.calls.flat().join('\n')).not.toContain('Linux EC2 instance');
});

it('prints container instructions directly when --container is passed', async () => {
  const output = terminal();
  expect(await automationRuntimeInstructions(output, '1.2.3-dev.4', ['--container'])).toBe(0);
  const printed = output.write.mock.calls.flat().join('\n');
  expect(printed).toContain('Dockerfile');
  expect(printed).not.toContain('Linux EC2 instance');
  expect(select).not.toHaveBeenCalled();
});

it('copies a dev tarball into the Docker build context without using the registry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'inheriti-container-'));
  const source = join(directory, 'source.tgz');
  const context = join(directory, 'app');
  const original = process.cwd();
  await mkdir(context);
  await writeFile(source, 'local CLI package');
  try {
    process.chdir(context);
    const output = terminal(false);
    expect(await automationRuntimeInstructions(output, '1.2.3-dev.4', ['--container', '--cli-tarball', source])).toBe(0);
    expect(await readFile('inheriti-cli.tgz', 'utf8')).toBe('local CLI package');
    const printed = output.write.mock.calls.flat().join('\n');
    expect(printed).toContain('COPY inheriti-cli.tgz /tmp/inheriti-cli.tgz');
    expect(printed).not.toContain('@safetech/inheriti-cli@1.2.3-dev.4');
    expect(printed).not.toContain('Linux EC2 instance');
  } finally { process.chdir(original); await rm(directory, { recursive: true, force: true }); }
});

it('rejects unsupported installation instruction options', async () => {
  const output = terminal(false);
  expect(await automationRuntimeInstructions(output, '1.2.3-dev.4', ['--unknown'])).toBe(1);
  expect(output.write).not.toHaveBeenCalled();
  expect(output.writeError).toHaveBeenCalledWith('Usage: inheriti automations runtime install-instructions [--container [--cli-tarball PATH]]');
});

it('rejects an unsafe CLI version before printing installation instructions', async () => {
  const output = terminal(false);
  await expect(automationRuntimeInstructions(output, 'latest; echo secret')).rejects.toThrow('Invalid CLI version');
  expect(output.write).not.toHaveBeenCalled();
});

it('installs EC2 from the operator computer with explicit target', async () => {
  const output = terminal(false);
  expect(await automationRuntimeInstallEc2(output, '0.0.19-dev.0',
    ['--region', 'us-east-1', '--instance', 'i-09ce8440ae7294ab9'], configuration as never, undefined)).toBe(0);
  expect(installEc2Cli).toHaveBeenCalledWith(expect.objectContaining({ region: 'us-east-1',
    instanceId: 'i-09ce8440ae7294ab9', cliVersion: '0.0.19-dev.0' }));
  expect(output.write).toHaveBeenCalledWith(expect.stringContaining('is ready on EC2'));
});

it('closes interactive progress before reporting EC2 success or failure', async () => {
  const closeRegion = vi.fn();
  const update = vi.fn();
  const output = { ...terminal(), createLiveRegion: () => ({ update, close: closeRegion }) };
  installEc2Cli.mockImplementationOnce((async ({ onProgress }: { onProgress: (phase: string) => void }) => {
    onProgress('checking'); onProgress('sending'); onProgress('waiting'); onProgress('installing');
    return { instanceId: 'i-09ce8440ae7294ab9', commandId: '11111111-1111-4111-8111-111111111111' };
  }) as never);
  await automationRuntimeInstallEc2(output, '0.0.19-dev.0',
    ['--region', 'us-east-1', '--instance', 'i-09ce8440ae7294ab9'], configuration as never);
  expect(closeRegion).toHaveBeenCalledOnce();
  expect(update.mock.calls.flat().join('\n')).toContain('Installing CLI on EC2');
  expect(output.write).toHaveBeenCalledWith(expect.stringContaining('is ready on EC2'));
  installEc2Cli.mockRejectedValueOnce(new Error('ssm failed'));
  await expect(automationRuntimeInstallEc2(output, '0.0.19-dev.0',
    ['--region', 'us-east-1', '--instance', 'i-09ce8440ae7294ab9'], configuration as never)).rejects.toThrow('ssm failed');
  expect(closeRegion).toHaveBeenCalledTimes(2);
});

it('prints each noninteractive EC2 stage once', async () => {
  const output = terminal(false);
  installEc2Cli.mockImplementationOnce((async ({ onProgress }: { onProgress: (phase: string) => void }) => {
    onProgress('checking'); onProgress('sending'); onProgress('waiting');
    onProgress('waiting'); onProgress('installing'); onProgress('installing'); onProgress('verified');
    return { instanceId: 'i-09ce8440ae7294ab9', commandId: '11111111-1111-4111-8111-111111111111' };
  }) as never);
  await automationRuntimeInstallEc2(output, '0.0.19-dev.0',
    ['--region', 'us-east-1', '--instance', 'i-09ce8440ae7294ab9'], configuration as never);
  expect(output.write.mock.calls.flat()).toEqual([
    'Checking SSM instance', 'Sending installation command', 'Waiting for EC2 response',
    'Installing CLI on EC2', 'Installation confirmed',
    expect.stringContaining('is ready on EC2'),
  ]);
});

const testApi = { ...configuration, apiUrl: 'https://business-dev.example/integrations/', deployment: 'dev' };
const artifactApiOrigin = 'http://127.0.0.1:3400';
const artifactDownloadOrigin = 'https://local-api-tunnel.example';
const artifactResponse = { id: 'artifact_1', downloadPath: '/test/cli-artifacts/artifact_1?expires=9999999999&signature=secret',
  deletePath: '/test/cli-artifacts/artifact_1?expires=9999999999&signature=delete-secret',
  sha256: '16ac1ea143cf30263883056bf563bf5984d91a980fae7b224a70b2e2b8fe9dbf', expiresInSeconds: 900 };
const localOptions = (path: string, origin = artifactApiOrigin, download = artifactDownloadOrigin) => ['--region', 'us-east-1', '--instance', 'i-09ce8440ae7294ab9', '--cli-tarball', path, '--artifact-api-url', origin, '--artifact-download-origin', download];
const uploadToken = randomBytes(32).toString('base64url');
let tokenHome: string;
let tokenPath: string;
beforeAll(async () => {
  tokenHome = await mkdtemp(join(tmpdir(), 'inheriti-cli-home-'));
  tokenPath = join(tokenHome, '.local/state/inheriti/cli-artifact-upload-token');
  await mkdir(join(tokenHome, '.local/state/inheriti'), { recursive: true });
  await writeFile(tokenPath, `${uploadToken}\n`, { mode: 0o600 });
  vi.stubEnv('HOME', tokenHome);
});
afterAll(async () => { vi.unstubAllEnvs(); await rm(tokenHome, { recursive: true, force: true }); });

it('uploads local dev tarball to TEST API, installs, and deletes by ID', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'inheriti-cli-test-'));
  const path = join(directory, 'cli.tgz');
  await writeFile(path, 'test tarball');
  const request = vi.fn(async (_url: URL, options: RequestInit) => new Response(
    options.method === 'POST' ? JSON.stringify(artifactResponse) : null, { status: options.method === 'POST' ? 200 : 204 }));
  try {
    expect(await automationRuntimeInstallEc2(terminal(false), '0.0.19-dev.0', localOptions(path),
      testApi as never, undefined, request as typeof fetch)).toBe(0);
    expect(request.mock.calls.map(([, options]) => options.method)).toEqual(['POST', 'DELETE']);
    expect(request.mock.calls.map(([url]) => url.origin)).toEqual([artifactApiOrigin, artifactApiOrigin]);
    expect(request.mock.calls[0]![1].headers).toEqual({ Authorization: `Bearer ${uploadToken}` });
    expect(request.mock.calls[1]![1].headers).toBeUndefined();
    expect(request.mock.calls[1]![0].searchParams.get('signature')).toBe('delete-secret');
    expect(installEc2Cli).toHaveBeenCalledWith(expect.objectContaining({ artifact: {
      id: 'artifact_1', url: 'https://local-api-tunnel.example/test/cli-artifacts/artifact_1?expires=9999999999&signature=secret',
      sha256: '16ac1ea143cf30263883056bf563bf5984d91a980fae7b224a70b2e2b8fe9dbf' } }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('rejects a missing, malformed, or exposed local upload token before POST', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'inheriti-cli-test-'));
  const path = join(directory, 'cli.tgz');
  await writeFile(path, 'test tarball');
  const request = vi.fn(async () => new Response());
  try {
    for (const state of ['missing', 'malformed', 'exposed']) {
      if (state === 'missing') await rm(tokenPath);
      else await writeFile(tokenPath, state === 'malformed' ? 'invalid' : uploadToken, { mode: 0o600 });
      if (state === 'exposed') await chmod(tokenPath, 0o644);
      await expect(automationRuntimeInstallEc2(terminal(false), '0.0.19-dev.0', localOptions(path),
        testApi as never, undefined, request as typeof fetch)).rejects.toThrow('automation_ec2_cli_install_artifact_token_invalid');
    }
    expect(request).not.toHaveBeenCalled();
  } finally {
    await writeFile(tokenPath, uploadToken, { mode: 0o600 });
    await chmod(tokenPath, 0o600);
    await rm(directory, { recursive: true, force: true });
  }
});

it('rejects invalid tarball mode before upload', async () => {
  const request = vi.fn(async () => new Response());
  const output = terminal(false);
  expect(await automationRuntimeInstallEc2(output, '0.0.19', localOptions('/missing.tgz'),
    testApi as never, undefined, request as typeof fetch)).toBe(1);
  expect(await automationRuntimeInstallEc2(output, '0.0.19-dev.0', localOptions('/missing.tgz'),
    testApi as never, undefined, request as typeof fetch)).toBe(1);
  expect(request).not.toHaveBeenCalled();
});

it('rejects nonlocal upload URLs and invalid tunnel URLs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'inheriti-cli-test-'));
  const path = join(directory, 'cli.tgz');
  await writeFile(path, 'test tarball');
  const request = vi.fn(async () => new Response());
  try {
    for (const origin of ['http://remote.example', 'https://127.0.0.1:3400',
      'http://user:pass@127.0.0.1:3400', 'http://127.0.0.1:3400/path',
      'http://127.0.0.1:3400/?token=x', 'http://127.0.0.1:3400/#x']) {
      await expect(automationRuntimeInstallEc2(terminal(false), '0.0.19-dev.0', localOptions(path, origin),
        testApi as never, undefined, request as typeof fetch)).rejects.toThrow('automation_ec2_cli_install_artifact_config_invalid');
    }
    for (const origin of ['http://local-api-tunnel.example', 'https://user:pass@local-api-tunnel.example',
      'https://local-api-tunnel.example/path', 'https://local-api-tunnel.example/?token=x']) {
      await expect(automationRuntimeInstallEc2(terminal(false), '0.0.19-dev.0', localOptions(path, artifactApiOrigin, origin),
        testApi as never, undefined, request as typeof fetch)).rejects.toThrow('automation_ec2_cli_install_artifact_config_invalid');
    }
    expect(request).not.toHaveBeenCalled();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('rejects an altered checksum or signed path and deletes the artifact ID', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'inheriti-cli-test-'));
  const path = join(directory, 'cli.tgz');
  await writeFile(path, 'test tarball');
  try {
    for (const invalid of [{ ...artifactResponse, sha256: 'b'.repeat(64) },
      { ...artifactResponse, downloadPath: '/test/cli-artifacts/other?expires=9999999999&signature=secret' }]) {
      const request = vi.fn(async (_url: URL, options: RequestInit) => new Response(
        options.method === 'POST' ? JSON.stringify(invalid) : null, { status: options.method === 'POST' ? 200 : 204 }));
      await expect(automationRuntimeInstallEc2(terminal(false), '0.0.19-dev.0', localOptions(path),
        testApi as never, undefined, request as typeof fetch)).rejects.toThrow('automation_ec2_cli_install_artifact_response_invalid');
      expect(request.mock.calls.map(([, options]) => options.method)).toEqual(['POST', 'DELETE']);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('deletes artifact after confirmed SSM failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'inheriti-cli-test-'));
  const path = join(directory, 'cli.tgz');
  await writeFile(path, 'test tarball');
  const request = vi.fn(async (_url: URL, options: RequestInit) => new Response(
    options.method === 'POST' ? JSON.stringify(artifactResponse) : null, { status: options.method === 'POST' ? 200 : 204 }));
  installEc2Cli.mockRejectedValueOnce(new Error('ssm failed'));
  try {
    await expect(automationRuntimeInstallEc2(terminal(false), '0.0.19-dev.0', localOptions(path),
      testApi as never, undefined, request as typeof fetch)).rejects.toThrow('ssm failed');
    expect(request.mock.calls.map(([, options]) => options.method)).toEqual(['POST', 'DELETE']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('retains artifact ID and command ID when SSM completion is uncertain', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'inheriti-cli-test-'));
  const path = join(directory, 'cli.tgz');
  await writeFile(path, 'test tarball');
  const request = vi.fn(async () => new Response(JSON.stringify(artifactResponse)));
  const output = terminal(false);
  installEc2Cli.mockRejectedValueOnce(Object.assign(new Error('wait failed'),
    { artifactPending: true, commandId: '11111111-1111-4111-8111-111111111111' }));
  try {
    await expect(automationRuntimeInstallEc2(output, '0.0.19-dev.0', localOptions(path),
      testApi as never, undefined, request as typeof fetch)).rejects.toThrow('wait failed');
    expect(request).toHaveBeenCalledOnce();
    expect(output.writeError).toHaveBeenCalledWith(expect.stringContaining('artifact_1; SSM command: 11111111-1111-4111-8111-111111111111'));
    expect(output.writeError.mock.calls.flat().join('')).not.toContain('signature=secret');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('does not claim success when TEST API cleanup fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'inheriti-cli-test-'));
  const path = join(directory, 'cli.tgz');
  await writeFile(path, 'test tarball');
  const request = vi.fn(async (_url: URL, options: RequestInit) => new Response(
    options.method === 'POST' ? JSON.stringify(artifactResponse) : 'failed', { status: options.method === 'POST' ? 200 : 500 }));
  const output = terminal(false);
  try {
    await expect(automationRuntimeInstallEc2(output, '0.0.19-dev.0', localOptions(path),
      testApi as never, undefined, request as typeof fetch)).rejects.toThrow('automation_ec2_cli_install_artifact_cleanup_failed');
    expect(output.writeError).toHaveBeenCalledWith(expect.stringContaining('Temporary CLI artifact cleanup failed: artifact_1'));
    expect(output.write).not.toHaveBeenCalledWith(expect.stringContaining('is ready on EC2'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('requires human authentication before fetching or managing automation', async () => {
  const output = terminal();
  const unsigned = { ...context, core: { getAccessToken: vi.fn(async () => undefined) } };
  expect(await automationMetadata(unsigned as never, configuration as never, output)).toBe(1);
  expect(await automationManage(unsigned as never, configuration as never, output, new AbortController().signal, ['verify', '--connection', 'connection-1'])).toBe(1);
  expect(output.writeError).toHaveBeenCalledWith('Sign in before managing automations.');
});

it('rejects secret options before opening verification', async () => {
  const output = terminal();
  expect(await automationManage(context as never, configuration as never, output, new AbortController().signal, ['verify', '--connection', 'connection-1', '--proof', 'secret'])).toBe(1);
  expect(output.writeError).toHaveBeenCalledWith(expect.stringContaining('Usage: inheriti automations'));
});

it('passes window closure and CLI cancellation to proof browser and closes on failure', async () => {
  const output = terminal();
  proofBrowser.mockImplementationOnce(async ({ signal }: { signal: AbortSignal }) => {
    windowClosed.callback?.('closed');
    expect(signal.aborted).toBe(true);
    throw new Error('canceled');
  });
  await expect(automationManage(context as never, configuration as never, output, new AbortController().signal, ['verify', '--connection', 'connection-1'])).rejects.toThrow('canceled');
  expect(close).toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
});

it('creates a connection from nonsecret provider fields and prints only its ID', async () => {
  const output = terminal(false);
  expect(await automationManage(context as never, configuration as never, output, new AbortController().signal,
    ['create', '--id', 'connection-2', '--name', 'Deploy', '--provider', 'GITHUB', '--deployment-environment', 'TEST', '--repository', 'acme/deploy', '--environment', 'test', '--workflow', 'deploy.yml'])).toBe(0);
  expect(createConnection).toHaveBeenCalledWith(expect.objectContaining({ id: 'connection-2', trust: { method: 'GITHUB_ACTIONS_OIDC', repositoryName: 'acme/deploy', environment: 'test', workflow: 'deploy.yml' } }));
  expect(output.write.mock.calls.flat().join('\n')).not.toContain('deploy.yml');
  expect(output.write.mock.calls.flat()).toContain('Expected audience: urn:inheriti:automation:connection:connection-2');
});

it('appends the connection ID once to a Google audience base with trailing slashes', async () => {
  const output = terminal(false);
  expect(await automationManage(context as never, configuration as never, output, new AbortController().signal,
    ['create', '--id', 'connection-google', '--name', 'GCP', '--provider', 'GOOGLE_CLOUD', '--deployment-environment', 'TEST', '--audience-base', 'https://example.com/workload///', '--subject', '123456789'])).toBe(0);
  expect(createConnection).toHaveBeenCalledWith(expect.objectContaining({ trust: { method: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC', audience: 'https://example.com/workload/connection-google', serviceAccountSubject: '123456789' } }));
  expect(output.write.mock.calls.flat()).toContain('Expected audience: https://example.com/workload/connection-google');
});

it('accepts a multiline Portable PEM public key without changing its newlines', async () => {
  const publicKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const output = terminal(false);
  expect(await automationManage(context as never, configuration as never, output, new AbortController().signal,
    ['create', '--id', 'portable-1', '--name', 'Runner', '--provider', 'PORTABLE', '--deployment-environment', 'TEST', '--key-id', 'key-1', '--public-key', publicKey, '--subject', 'runner-1', '--environment', 'test'])).toBe(0);
  expect(createConnection).toHaveBeenCalledWith(expect.objectContaining({ trust: expect.objectContaining({ publicKey }) }));
  expect(output.write.mock.calls.flat().join('\n')).not.toContain(publicKey);
  expect(await automationManage(context as never, configuration as never, output, new AbortController().signal,
    ['create', '--name', 'Runner', '--provider', 'PORTABLE', '--deployment-environment', 'TEST', '--key-id', 'key-1', '--public-key', '--subject', 'runner-1', '--environment', 'test'])).toBe(1);
});

it('refuses proof flags and passes identity verification to the secure window', async () => {
  const output = terminal();
  expect(await automationManage(context as never, configuration as never, output, new AbortController().signal, ['verify', '--connection', 'connection-1', '--proof', 'NEVER_PRINT'])).toBe(1);
  expect(proofBrowser).not.toHaveBeenCalled();
  expect(await automationManage(context as never, configuration as never, output, new AbortController().signal, ['verify', '--connection', 'connection-1'])).toBe(0);
  expect(proofBrowser).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'connection-1', operations: expect.anything(), signal: expect.any(AbortSignal) }));
  expect(output.write.mock.calls.flat().join('\n')).not.toContain('NEVER_PRINT');
  expect(output.write.mock.calls.flat()).toContain('Identity verified for connection connection-1.');
});

it('does not report success when the proof window is closed without verification', async () => {
  proofBrowser.mockResolvedValueOnce({ action: 'done' });
  const output = terminal();
  expect(await automationManage(context as never, configuration as never, output, new AbortController().signal, ['verify', '--connection', 'connection-1'])).toBe(1);
  expect(output.write.mock.calls.flat()).toContain('Identity verification canceled.');
  expect(output.write.mock.calls.flat().join('\n')).not.toContain('Identity verified');
});

it('creates and activates a grant with explicit nonsecret IDs', async () => {
  const output = terminal(false);
  expect(await automationManage(context as never, configuration as never, output, new AbortController().signal,
    ['grant', 'create', '--plan', 'plan-1', '--connection', 'connection-1', '--member', 'member-1', '--id', 'grant-2'])).toBe(0);
  expect(createGrant).toHaveBeenCalledWith('plan-1', { id: 'grant-2', connectionId: 'connection-1', responsibleMemberId: 'member-1' });
  expect(await automationManage(context as never, configuration as never, output, new AbortController().signal,
    ['grant', 'activate', '--plan', 'plan-1', '--grant', 'grant-2'])).toBe(0);
  expect(activateGrant).toHaveBeenCalledWith('plan-1', 'grant-2');
  expect(output.write.mock.calls.flat()).toContain('Grant created: grant-2');
  expect(output.write.mock.calls.flat()).toContain('Grant activated: grant-2');
});

it('offers explicit connection and grant recovery actions', async () => {
  const output = terminal(false);
  const run = (args: string[]) => automationManage(context as never, configuration as never, output,
    new AbortController().signal, args);
  expect(await run(['trust', '--connection', 'connection-1', '--provider', 'AWS',
    '--role-arn', 'arn:aws:iam::123456789012:role/app'])).toBe(0);
  expect(changeTrust).toHaveBeenCalledWith('connection-1', expect.objectContaining({ method: 'AWS_IAM_ROLE' }));
  expect(await run(['grant', 'member', '--plan', 'plan-1', '--grant', 'grant-1', '--member', 'member-2'])).toBe(0);
  expect(replaceResponsibleMember).toHaveBeenCalledWith('plan-1', 'grant-1', 'member-2');
  expect(await run(['grant', 'revoke', '--plan', 'plan-1', '--grant', 'grant-1'])).toBe(0);
  expect(revokeGrant).toHaveBeenCalledWith('plan-1', 'grant-1');
  expect(await run(['disable', '--connection', 'connection-1'])).toBe(0);
  expect(disableConnection).toHaveBeenCalledWith('connection-1');
});
