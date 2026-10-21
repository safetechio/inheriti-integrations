import { randomUUID } from 'node:crypto';
import {
  AutomationProviderValue,
  automationRuntimeInstallInstructions,
  createAutomationSetupOperations,
  createNativeWindowSession,
  githubAutomationWorkflow,
  githubAutomationWorkflowLocation,
  inspectCloudIdentity,
  inspectEc2AutomationInstance,
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
  const runtime = verb === 'runtime';
  const action = grant || pair || runtime ? maybeAction : verb;
  const options = flags(grant || pair || runtime ? tail : argv.slice(1));
  const usage = 'Usage: inheriti automations create|verify|trust|disable|usage|runtime install-instructions|pair start|grant create|activate|member|revoke [nonsecret flags]';
  const actions = grant ? ['create', 'activate', 'member', 'revoke'] : pair ? ['start'] : runtime ? ['install-instructions'] : ['create', 'verify', 'trust', 'disable', 'usage'];
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
  if (runtime) {
    if (Object.keys(options).length) { terminal.writeError(usage); return 1; }
    const instructions = automationRuntimeInstallInstructions(await operations.getVerifiedGithubRelease());
    terminal.write(`Verified Inheriti CLI runtime: ${instructions.packageSpec}`);
    terminal.write(`For a plain Linux EC2 instance, run on the instance with permissions for a system-wide npm installation. npm checks the package's Node.js engines metadata; confirm the systemd run-as user can execute inheriti:\n${instructions.linuxHost}`);
    terminal.write(`${instructions.prerequisite}\n${instructions.dockerfile}`);
    terminal.write(instructions.instruction);
    return 0;
  }
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
    terminal.write(`Connection created: ${id}`);
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
