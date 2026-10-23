import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  AutomationProviderValue,
  automationRuntimeInstallInstructions,
  createAutomationSetupOperations,
  createNativeWindowSession,
  githubAutomationWorkflow,
  githubAutomationWorkflowLocation,
  inspectCloudIdentity,
  inspectEc2AutomationInstance,
  installEc2Cli,
  runLocalAutomationProofBrowser,
} from '@safetech/inheriti-elements-core/node-base';
import type { AutomationSetupOperations } from '@safetech/inheriti-elements-core/node-base';
import type { CliConfiguration } from '../configuration.js';
import type { CliContext } from '../session.js';
import type { Terminal } from '../output.js';
import { renderJson } from '../output.js';
import { promptSelect } from '../render/select.js';
import { cliAutomationProvider } from './automation-provider.js';

function flags(argv: readonly string[]): Record<string, string> | undefined {
  if (argv.length % 2) return;
  const entries = argv.filter((_, index) => index % 2 === 0)
    .map((key, index) => [key, argv[index * 2 + 1]] as const);
  if (entries.some(([key, value]) => !key.startsWith('--') || !value ||
      (value.startsWith('--') && !(key === '--public-key' && value.startsWith('-----BEGIN PUBLIC KEY-----\n'))) ||
      ['--proof', '--private-key', '--private-key-file'].includes(key))) return;
  const values = Object.fromEntries(entries) as Record<string, string>;
  return Object.keys(values).length === entries.length ? values : undefined;
}

async function choose(
  value: string | undefined,
  terminal: Terminal,
  label: string,
  items: { id: string; name?: string | undefined }[],
  signal: AbortSignal,
): Promise<string | undefined> {
  if (value) return value;
  if (!terminal.interactive) return;
  return promptSelect(label, items.map(({ id, name }) => ({ value: id, ...(name ? { description: name } : {}) })), signal);
}

export async function automationRuntimeInstructions(terminal: Terminal, cliVersion: string, argv: readonly string[] = []): Promise<number> {
  const usage = 'Usage: inheriti automations runtime install-instructions [--container [--cli-tarball PATH]]';
  const tarball = argv.length === 3 && argv[0] === '--container' && argv[1] === '--cli-tarball' ? argv[2] : undefined;
  if (argv.length && !(argv.length === 1 && argv[0] === '--container') && !tarball) {
    terminal.writeError(usage);
    return 1;
  }
  const local = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-local\.(0|[1-9]\d*)$/.test(cliVersion);
  const instructions = local ? undefined : automationRuntimeInstallInstructions({ cliVersion });
  if (tarball) {
    const source = resolve(tarball);
    const destination = resolve('inheriti-cli.tgz');
    const file = await stat(source).catch(() => undefined);
    if (!(local || /-dev\./.test(cliVersion)) || !tarball.endsWith('.tgz') || !file?.isFile() || !file.size || file.size > 32 * 1024 * 1024) {
      terminal.writeError('--cli-tarball requires a local or dev CLI version and a readable .tgz file of at most 32 MiB.');
      return 1;
    }
    if (source !== destination) {
      try { await copyFile(source, destination, constants.COPYFILE_EXCL); }
      catch { terminal.writeError('Could not copy inheriti-cli.tgz into the current Docker build context. Remove any existing file and retry.'); return 1; }
    }
  }
  const target = argv[0] === '--container' ? 'container' : terminal.interactive ? await promptSelect('Where will the CLI run?', [
    { value: 'ec2', description: 'Linux EC2 instance' },
    { value: 'container', description: 'ECS or Cloud Run container' },
  ]) : 'both';
  if (!target) return 1;
  terminal.write(`\nInheriti CLI ${cliVersion}\n${tarball ? 'The local package is ready as inheriti-cli.tgz in this Docker build context.' : local ? 'This is a local build. Use its .tgz package for testing.' : 'The install command requires this exact version to be published on npm.'}`);
  if (target === 'ec2' || target === 'both') {
    terminal.write(local
      ? '\nLinux EC2 instance\n\nThis local build cannot be installed through the EC2 command. Build a dev .tgz package for the TEST artifact flow.'
      : '\nLinux EC2 instance\n\nRun from your computer with AWS CLI and SSM:\n\n' +
        'inheriti automations runtime install ec2 --region REGION --instance INSTANCE_ID\n\n' +
        'The command installs this CLI version remotely. Later, setup --install checks service-user access.');
  }
  if (target === 'container' || target === 'both') {
    terminal.write(`\nECS / Cloud Run container\n\n1. The final Dockerfile stage needs Node.js 22 or later and npm. If it lacks them, use a Node.js base image for that stage, for example FROM node:22-bookworm-slim, while preserving your application's setup. Then add:\n` +
      (local || tarball ? `${tarball ? 'For this test, use the copied inheriti-cli.tgz; do not commit it.' : "Copy the locally built .tgz into your application's Docker build context as inheriti-cli.tgz for this test only; do not commit it."}\n` +
        `COPY inheriti-cli.tgz /tmp/inheriti-cli.tgz\n` +
        `RUN npm install --engine-strict --global --prefix /usr/local /tmp/inheriti-cli.tgz \\\n` +
        `    && test "$(/usr/local/bin/inheriti --version)" = '${cliVersion}' \\\n` +
        `    && rm /tmp/inheriti-cli.tgz` : instructions!.dockerfile) +
      `\n\n2. Build and deploy the image through your project's normal pipeline. ` +
      (local || tarball ? 'Keep this tarball change uncommitted; use a published CLI version for later builds.' :
        'Commit the Dockerfile change so later builds include the CLI.'));
  }
  return 0;
}

export async function automationRuntimeInstallEc2(
  terminal: Terminal, cliVersion: string, argv: readonly string[], configuration: CliConfiguration,
  signal?: AbortSignal,
  request: typeof fetch = fetch,
): Promise<number> {
  const usage = 'Usage: inheriti automations runtime install ec2 --region REGION --instance INSTANCE_ID [--cli-tarball PATH --artifact-api-url LOCAL_HTTP_ORIGIN --artifact-download-origin HTTPS_TUNNEL_ORIGIN]';
  const entries = argv.filter((_, index) => index % 2 === 0).map((key, index) => [key, argv[index * 2 + 1]] as const);
  const options = Object.fromEntries(entries) as Record<string, string>;
  const tarball = options['--cli-tarball'];
  const artifactApiUrl = options['--artifact-api-url'];
  const artifactDownloadOrigin = options['--artifact-download-origin'];
  if (![4, 10].includes(argv.length) || entries.some(([key, value]) =>
    !['--region', '--instance', '--cli-tarball', '--artifact-api-url', '--artifact-download-origin'].includes(key) || !value || value.startsWith('--')) ||
    Object.keys(options).length !== entries.length || !options['--region'] || !options['--instance'] ||
    (Boolean(tarball) !== Boolean(artifactApiUrl)) || (Boolean(tarball) !== Boolean(artifactDownloadOrigin)) ||
    !/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(options['--region']) ||
    !/^i-(?:[0-9a-f]{8}|[0-9a-f]{17})$/.test(options['--instance']) ||
    (tarball && !/-dev\./.test(cliVersion))) {
    terminal.writeError(usage);
    return 1;
  }
  let artifact: { id: string; url: string; sha256: string } | undefined;
  let cleanupId: string | undefined;
  let artifactEndpoint: URL | undefined;
  let downloadOrigin: URL | undefined;
  let deleteUrl: URL | undefined;
  if (tarball) {
    try {
      const file = await stat(tarball);
      if (!tarball.endsWith('.tgz') || !file.isFile() || file.size < 1 || file.size > 32 * 1024 * 1024)
        throw new Error('invalid');
    } catch { terminal.writeError('A readable .tgz file of at most 32 MiB is required.'); return 1; }
    try {
      const origin = new URL(artifactApiUrl!);
      downloadOrigin = new URL(artifactDownloadOrigin!);
      if (origin.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname) ||
          origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
          downloadOrigin.protocol !== 'https:' || downloadOrigin.username || downloadOrigin.password ||
          downloadOrigin.pathname !== '/' || downloadOrigin.search || downloadOrigin.hash ||
          !configuration.business || configuration.deployment !== 'dev')
        throw new Error('invalid');
      artifactEndpoint = new URL('/test/cli-artifacts', origin);
    } catch { throw new Error('automation_ec2_cli_install_artifact_config_invalid'); }
  }
  const region = terminal.createLiveRegion?.();
  const started = Date.now();
  let phase = tarball ? 'Uploading local CLI package' : 'Checking SSM instance';
  let tick = 0;
  const draw = () => region?.update(`${['⠋', '⠙', '⠹', '⠸'][tick++ % 4]} ${phase} · ${Math.floor((Date.now() - started) / 1000)}s`);
  const report = (next: string) => {
    if (next === phase) return;
    phase = next;
    if (region) draw(); else terminal.write(next);
  };
  const timer = region ? setInterval(draw, 180) : undefined;
  timer?.unref();
  if (region) draw(); else terminal.write(phase);
  const closeProgress = () => { if (timer) clearInterval(timer); region?.update(''); region?.close(); };
  let result: Awaited<ReturnType<typeof installEc2Cli>> | undefined;
  let failure: unknown;
  let warning: string | undefined;
  let retainArtifact = false;
  let minimumNodeMajor = Number(process.versions.node.split('.')[0]);
  try {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { engines?: { node?: string } };
    const required = /^>=(\d+)(?:\.\d+){0,2}$/.exec(manifest.engines?.node ?? '');
    if (required) minimumNodeMajor = Number(required[1]);
  } catch { /* Source tests run without the packaged manifest. */ }
  try {
    if (tarball && artifactEndpoint) {
      let uploadToken: string;
      try {
        const path = resolve(process.env.HOME ?? homedir(), '.local/state/inheriti/cli-artifact-upload-token');
        const file = await stat(path);
        if (!file.isFile() || (file.mode & 0o077)) throw new Error('invalid');
        uploadToken = (await readFile(path, 'utf8')).trim();
        if (!/^[A-Za-z0-9_-]{43}$/.test(uploadToken) ||
            Buffer.from(uploadToken, 'base64url').toString('base64url') !== uploadToken)
          throw new Error('invalid');
      } catch { throw new Error('automation_ec2_cli_install_artifact_token_invalid'); }
      const form = new FormData();
      const bytes = await readFile(tarball);
      const localSha256 = createHash('sha256').update(bytes).digest('hex');
      form.set('file', new Blob([bytes]), 'cli.tgz');
      let response: Response;
      try { response = await request(artifactEndpoint, { method: 'POST', body: form,
        headers: { Authorization: `Bearer ${uploadToken}` },
        ...(signal ? { signal } : {}) }); }
      catch { throw new Error('automation_ec2_cli_install_artifact_upload_failed'); }
      if (!response.ok) throw new Error('automation_ec2_cli_install_artifact_upload_failed');
      let value: unknown;
      try { value = await response.json(); } catch { throw new Error('automation_ec2_cli_install_artifact_response_invalid'); }
      const item = value as Record<string, unknown>;
      if (item && typeof item.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(item.id)) cleanupId = item.id;
      if (!cleanupId || typeof item.downloadPath !== 'string' || typeof item.deletePath !== 'string' ||
          typeof item.expiresInSeconds !== 'number' || item.expiresInSeconds < 360)
        throw new Error('automation_ec2_cli_install_artifact_response_invalid');
      const download = new URL(item.downloadPath, downloadOrigin);
      const deletion = new URL(item.deletePath, artifactEndpoint);
      if (!item.deletePath.startsWith('/') || deletion.pathname !== `/test/cli-artifacts/${cleanupId}` ||
          deletion.origin !== artifactEndpoint.origin || deletion.hash || deletion.searchParams.size !== 2 ||
          !deletion.searchParams.get('signature') || !/^\d+$/.test(deletion.searchParams.get('expires') ?? ''))
        throw new Error('automation_ec2_cli_install_artifact_response_invalid');
      deleteUrl = deletion;
      if (item.sha256 !== localSha256 || !item.downloadPath.startsWith('/') || download.pathname !== `/test/cli-artifacts/${cleanupId}` ||
          download.origin !== downloadOrigin!.origin ||
          download.hash || download.searchParams.size !== 2 || !download.searchParams.get('signature') ||
          !/^\d+$/.test(download.searchParams.get('expires') ?? ''))
        throw new Error('automation_ec2_cli_install_artifact_response_invalid');
      artifact = { id: cleanupId, url: download.href, sha256: item.sha256 };
    }
    result = await installEc2Cli({ region: options['--region'], instanceId: options['--instance'],
      cliVersion, minimumNodeMajor, ...(artifact ? { artifact } : {}), ...(signal ? { signal } : {}),
      onProgress: value => report(({ checking: 'Checking SSM instance', sending: 'Sending installation command',
        waiting: 'Waiting for EC2 response', installing: 'Installing CLI on EC2', verified: 'Installation confirmed' } as const)[value]),
    });
  } catch (error) {
    failure = error;
    const uncertain = error as { artifactPending?: boolean; commandId?: string };
    retainArtifact = Boolean(artifact && uncertain.artifactPending);
    if (retainArtifact) warning = `SSM completion is unconfirmed. Retained CLI artifact ID: ${artifact!.id}` +
      (uncertain.commandId ? `; SSM command: ${uncertain.commandId}` : '; SSM command ID unavailable');
  } finally {
    if (deleteUrl && !retainArtifact) {
      report('Removing temporary CLI package');
      try {
        const response = await request(deleteUrl, { method: 'DELETE' });
        if (!response.ok) throw new Error('cleanup failed');
      }
      catch {
        warning = `Temporary CLI artifact cleanup failed: ${cleanupId}`;
        failure ??= new Error('automation_ec2_cli_install_artifact_cleanup_failed');
      }
    }
    closeProgress();
  }
  if (warning) terminal.writeError(warning);
  if (failure) throw failure;
  if (!result) throw new Error('automation_ec2_cli_install_failed');
  terminal.write(`Inheriti CLI ${cliVersion} is ready on EC2 ${result.instanceId}. SSM command: ${result.commandId}`);
  return 0;
}

export async function automationManage(
  context: CliContext,
  configuration: CliConfiguration,
  terminal: Terminal,
  signal: AbortSignal,
  argv: readonly string[],
): Promise<number> {
  const [verb, maybeAction, ...tail] = argv;
  const grant = verb === 'grant';
  const pair = verb === 'pair';
  const action = grant || pair ? maybeAction : verb;
  const options = flags(grant || pair ? tail : argv.slice(1));
  const usage = 'Usage: inheriti automations create|verify|trust|disable|usage|pair start|grant create|activate|member|revoke [nonsecret flags]';
  const actions = grant ? ['create', 'activate', 'member', 'revoke'] : pair ? ['start'] : ['create', 'verify', 'trust', 'disable', 'usage'];
  if (!options || !action || !actions.includes(action)) {
    terminal.writeError(usage);
    return 1;
  }
  if (!(await context.core.getAccessToken())) {
    terminal.writeError('Sign in before managing automations.');
    return 1;
  }
  const operations = createAutomationSetupOperations({
    apiUrl: configuration.apiUrl,
    organizationId: context.organization!.id,
    getBearerToken: () => context.core.getAccessToken(),
  });
  if (pair) {
    if (Object.keys(options).some(key => key !== '--connection')) {
      terminal.writeError(usage);
      return 1;
    }
    const connectionId = await choose(options['--connection'], terminal, 'Which connection?',
      options['--connection'] ? [] : (await operations.listConnections()).map(({ id, name }) => ({ id, name })), signal);
    if (!connectionId) { terminal.writeError('Connection ID required.'); return 1; }
    const pairing = await operations.startPairing(connectionId);
    terminal.write(`Waiting for the configured workload to verify this connection until ${pairing.expiresAt}. Run inheriti automations pair redeem inside that workload.`);
    return 0;
  }
  if (!grant && action === 'usage') {
    if (Object.keys(options).some(key => !['--plan', '--connection', '--field'].includes(key))) {
      terminal.writeError(usage);
      return 1;
    }
    const planId = await choose(
      options['--plan'], terminal, 'Which plan?',
      options['--plan'] ? [] : (await operations.listPlans()).map(({ id, name, title }) => ({ id, name: name ?? title })),
      signal,
    );
    if (!planId) { terminal.writeError('Plan ID required.'); return 1; }
    const grants = (await operations.listGrants(planId)).filter(item => item.status === 'ACTIVE');
    const connections = (await operations.listConnections()).filter(item =>
      item.provider === 'GITHUB' && item.status === 'VERIFIED' &&
      grants.some(grant => grant.connectionId === item.id));
    const connectionId = await choose(
      options['--connection'], terminal, 'Which verified GitHub connection?',
      connections.map(({ id, name }) => ({ id, name })), signal,
    );
    const connection = connections.find(item => item.id === connectionId);
    if (!connection || connection.trust.method !== 'GITHUB_ACTIONS_OIDC') {
      terminal.writeError('An active plan grant to a verified GitHub connection is required.');
      return 1;
    }
    const selector = options['--field'];
    if (!selector) { terminal.writeError('Field required: pass --field asset.field from the plan Data tab.'); return 1; }
    const location = githubAutomationWorkflowLocation(connection.trust.repositoryName, connection.trust.workflow);
    const release = await operations.getVerifiedGithubRelease();
    const workflow = githubAutomationWorkflow({
      release, environment: connection.trust.environment,
      planId, connectionId: connection.id, selector,
    });
    terminal.write(
      `Save this workflow in ${location.repository}/${location.path} on branch ${location.branch}. ` +
      'The file and branch must match the verified connection.',
    );
    terminal.write(workflow);
    return 0;
  }
  if (!grant && action === 'create') {
    const id = options['--id'] ?? randomUUID();
    const provider = cliAutomationProvider(options['--provider']);
    const environment = options['--deployment-environment'];
    if (!provider || !options['--name'] || !environment ||
        !['TEST', 'LIVE'].includes(environment) ||
        Object.keys(options).some(key => !provider.createFlags.includes(key))) {
      terminal.writeError(usage);
      return 1;
    }
    const ec2 = provider.value === 'AWS' && options['--instance'];
    const hasTarget = ['--project', '--job', '--cluster', '--service',
      '--task-definition', '--container'].some(key => options[key]);
    const target = hasTarget ? provider.target(options) : undefined;
    if ((!ec2 && options['--region'] && !hasTarget) ||
        (ec2 && (hasTarget || !options['--region'] || options['--role-arn'])) ||
        (hasTarget && (!target || options['--subject'] || options['--role-arn']))) {
      terminal.writeError(usage);
      return 1;
    }
    const inspected = target ? await inspectCloudIdentity(target) : undefined;
    const instance = ec2 ? await inspectEc2AutomationInstance({ region: options['--region']!, instanceId: ec2 }) : undefined;
    const resolvedOptions = {
      ...options,
      ...(inspected ? provider.inspectedTrust(inspected) : {}),
      ...(instance ? { '--role-arn': instance.roleArn } : {}),
    };
    const details = provider.trust(resolvedOptions, id);
    if (!details || !AutomationProviderValue.from(provider.value).accepts(details)) { terminal.writeError(usage); return 1; }
    await operations.createConnection({ id, name: options['--name'], provider: provider.value, environment: environment as 'TEST' | 'LIVE', trust: details });
    terminal.write(`Connection created: ${options['--name']} (${id})`);
    const expectedAudience = AutomationProviderValue.from(provider.value).expectedAudience(id, details);
    if (expectedAudience) terminal.write(`Expected audience: ${expectedAudience}`);
    return 0;
  }
  if (!grant) {
    const allowedTrust = [
      '--connection', '--provider', '--repository', '--environment', '--workflow',
      '--audience-base', '--subject', '--role-arn', '--key-id', '--public-key',
    ];
    if (Object.keys(options).some(key =>
      action === 'trust' ? !allowedTrust.includes(key) : key !== '--connection')) {
      terminal.writeError(usage);
      return 1;
    }
    const connectionId = await choose(
      options['--connection'], terminal, 'Which connection?',
      options['--connection'] ? [] : (await operations.listConnections()).map(({ id, name }) => ({ id, name })),
      signal,
    );
    if (!connectionId) { terminal.writeError('Connection ID required.'); return 1; }
    if (action === 'verify') return automationProof(context, terminal, signal, operations, connectionId);
    if (action === 'disable') {
      await operations.disableConnection(connectionId);
      terminal.write(`Connection disabled: ${connectionId}`);
      return 0;
    }
    const details = cliAutomationProvider(options['--provider'])?.trust(options, connectionId);
    if (!details) { terminal.writeError(usage); return 1; }
    await operations.changeTrust(connectionId, details);
    terminal.write(`Connection trust changed: ${connectionId}`);
    return 0;
  }
  const allowedGrant = action === 'create'
    ? ['--plan', '--connection', '--member', '--id']
    : action === 'member' ? ['--plan', '--grant', '--member'] : ['--plan', '--grant'];
  if (Object.keys(options).some(key => !allowedGrant.includes(key))) { terminal.writeError(usage); return 1; }
  const plans = options['--plan'] ? [] : await operations.listPlans();
  const planId = await choose(
    options['--plan'], terminal, 'Which plan?',
    plans.map(({ id, name, title }) => ({ id, name: name ?? title })), signal,
  );
  if (!planId) { terminal.writeError('Plan ID required.'); return 1; }
  const existing = action === 'create' || options['--grant'] ? [] : await operations.listGrants(planId);
  const grantId = action === 'create'
    ? options['--id'] ?? randomUUID()
    : await choose(options['--grant'], terminal, 'Which grant?', existing.map(({ id }) => ({ id })), signal);
  if (!grantId) { terminal.writeError('Grant ID required.'); return 1; }
  if (action === 'create') {
    const connectionId = await choose(
      options['--connection'], terminal, 'Which connection?',
      options['--connection'] ? [] : (await operations.listConnections()).map(({ id, name }) => ({ id, name })),
      signal,
    );
    const memberId = await member(options['--member'], operations, terminal, signal);
    if (!connectionId || !memberId) { terminal.writeError('Connection and responsible member required.'); return 1; }
    await operations.createGrant(planId, { id: grantId, connectionId, responsibleMemberId: memberId });
  }
  if (action === 'activate') await operations.activateGrant(planId, grantId);
  if (action === 'revoke') await operations.revokeGrant(planId, grantId);
  if (action === 'member') {
    const memberId = await member(options['--member'], operations, terminal, signal);
    if (!memberId) { terminal.writeError('Responsible member required.'); return 1; }
    await operations.replaceResponsibleMember(planId, grantId, memberId);
  }
  const outcomes: Record<string, string> = {
    create: 'created', activate: 'activated',
    revoke: 'revoked', member: 'responsible member changed',
  };
  terminal.write(`Grant ${outcomes[action]}: ${grantId}`);
  return 0;
}
async function member(
  value: string | undefined,
  operations: AutomationSetupOperations,
  terminal: Terminal,
  signal: AbortSignal,
): Promise<string | undefined> {
  const items = value ? [] : (await operations.listMembers()).map(({ id, firstName, lastName }) => ({
    id, name: [firstName, lastName].filter(Boolean).join(' '),
  }));
  return choose(value, terminal, 'Which responsible member?', items, signal);
}

async function automationProof(
  context: CliContext,
  terminal: Terminal,
  signal: AbortSignal,
  operations: AutomationSetupOperations,
  connectionId: string,
): Promise<number> {
  if (!terminal.interactive) { terminal.writeError('Identity verification requires an interactive terminal and desktop window.'); return 1; }
  const windowClosed = new AbortController();
  const state = { unavailable: false, completed: false };
  const window = createNativeWindowSession(reason => {
    state.unavailable = reason === 'unavailable';
    windowClosed.abort();
  });
  try {
    terminal.write('Opening identity verification window…');
    const result = await runLocalAutomationProofBrowser({
      operations, open: url => window.open(url), connectionId,
      signal: AbortSignal.any([signal, windowClosed.signal]),
      organizationName: context.organization!.name,
    });
    if (result.action !== 'verified') { terminal.write('Identity verification canceled.'); return 1; }
    state.completed = true;
    terminal.write(`Identity verified for connection ${connectionId}.`);
    return 0;
  } catch (error) {
    if (state.unavailable) throw new Error('local_window_unavailable');
    throw error;
  } finally {
    if (state.completed) window.complete();
    if (!state.completed) window.close();
  }
}

export async function automationMetadata(
  context: CliContext,
  configuration: CliConfiguration,
  terminal: Terminal,
  planId?: string,
): Promise<number> {
  if (!(await context.core.getAccessToken())) { terminal.writeError('Sign in before listing automations.'); return 1; }
  const operations = createAutomationSetupOperations({
    apiUrl: configuration.apiUrl,
    organizationId: context.organization!.id,
    getBearerToken: () => context.core.getAccessToken(),
  });
  if (planId) {
    const grants = await operations.listGrants(planId);
    renderJson(terminal, {
      organizationId: context.organization!.id,
      planId,
      items: grants.map(({ id, connectionId, responsibleMemberId, status }) => ({
        id, connectionId, responsibleMemberId, status,
      })),
    });
    return 0;
  }
  const connections = await operations.listConnections();
  renderJson(terminal, {
    organizationId: context.organization!.id,
    items: connections.map(({ id, name, provider, environment, status }) => ({
      id, name, provider, environment, status,
    })),
  });
  return 0;
}
