import { randomUUID } from 'node:crypto';
import { createAutomationSetupOperations, createNativeWindowSession, githubAutomationWorkflow, githubAutomationWorkflowLocation, runLocalAutomationProofBrowser } from '@safetech/inheriti-elements-core/node-base';
import type { AutomationProvider, AutomationTrust, AutomationSetupOperations } from '@safetech/inheriti-elements-core/node-base';
import type { CliConfiguration } from '../configuration.js';
import type { CliContext } from '../session.js';
import type { Terminal } from '../output.js';
import { renderJson } from '../output.js';
import { promptSelect } from '../render/select.js';

function flags(argv: readonly string[]): Record<string, string> | undefined {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value || (value.startsWith('--') && !(key === '--public-key' && value.startsWith('-----BEGIN PUBLIC KEY-----\n'))) || key in values || ['--proof', '--private-key', '--private-key-file'].includes(key)) return;
    values[key] = value;
  }
  return values;
}

function trust(input: Record<string, string>, provider: AutomationProvider, id: string): AutomationTrust | undefined {
  if (provider === 'GITHUB' && input['--repository'] && input['--environment'] && input['--workflow'])
    return { method: 'GITHUB_ACTIONS_OIDC', repositoryName: input['--repository'], environment: input['--environment'], workflow: input['--workflow'] };
  if (provider === 'GOOGLE_CLOUD' && input['--audience-base'] && input['--subject'])
    return { method: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC', audience: `${input['--audience-base'].replace(/\/+$/, '')}/${id}`, serviceAccountSubject: input['--subject'] };
  if (provider === 'AWS' && input['--role-arn']) return { method: 'AWS_IAM_ROLE', roleArn: input['--role-arn'] };
  if (provider === 'PORTABLE' && input['--key-id'] && input['--public-key'] && input['--subject'] && input['--environment'])
    return { method: 'PORTABLE_SIGNED_ASSERTION', keyId: input['--key-id'], publicKey: input['--public-key'], runnerSubject: input['--subject'], environment: input['--environment'] };
}

async function choose(value: string | undefined, terminal: Terminal, label: string, items: { id: string; name?: string | undefined }[], signal: AbortSignal): Promise<string | undefined> {
  if (value) return value;
  if (!terminal.interactive) return;
  return promptSelect(label, items.map(({ id, name }) => ({ value: id, ...(name ? { description: name } : {}) })), signal);
}

export async function automationManage(context: CliContext, configuration: CliConfiguration, terminal: Terminal, signal: AbortSignal, argv: readonly string[]): Promise<number> {
  const [verb, maybeAction, ...tail] = argv;
  const grant = verb === 'grant';
  const action = grant ? maybeAction : verb;
  const options = flags(grant ? tail : argv.slice(1));
  const usage = 'Usage: inheriti automations create|verify|trust|disable|usage|grant create|activate|member|revoke [nonsecret flags]';
  if (!options || !action || !(grant ? ['create', 'activate', 'member', 'revoke'] : ['create', 'verify', 'trust', 'disable', 'usage']).includes(action)) { terminal.writeError(usage); return 1; }
  if (!(await context.core.getAccessToken())) { terminal.writeError('Sign in before managing automations.'); return 1; }
  const operations = createAutomationSetupOperations({ apiUrl: configuration.apiUrl, organizationId: context.organization!.id, getBearerToken: () => context.core.getAccessToken() });
  if (!grant && action === 'usage') {
    if (Object.keys(options).some(key => !['--plan', '--connection', '--field'].includes(key))) { terminal.writeError(usage); return 1; }
    const planId = await choose(options['--plan'], terminal, 'Which plan?', options['--plan'] ? [] : (await operations.listPlans()).map(({ id, name, title }) => ({ id, name: name ?? title })), signal);
    if (!planId) { terminal.writeError('Plan ID required.'); return 1; }
    const grants = (await operations.listGrants(planId)).filter(item => item.status === 'ACTIVE');
    const connections = (await operations.listConnections()).filter(item => item.provider === 'GITHUB' && item.status === 'VERIFIED' && grants.some(grant => grant.connectionId === item.id));
    const connectionId = await choose(options['--connection'], terminal, 'Which verified GitHub connection?', connections.map(({ id, name }) => ({ id, name })), signal);
    const connection = connections.find(item => item.id === connectionId);
    if (!connection || connection.trust.method !== 'GITHUB_ACTIONS_OIDC') { terminal.writeError('An active plan grant to a verified GitHub connection is required.'); return 1; }
    const selector = options['--field'];
    if (!selector) { terminal.writeError('Field required: pass --field asset.field from the plan Data tab.'); return 1; }
    const location = githubAutomationWorkflowLocation(connection.trust.repositoryName, connection.trust.workflow);
    const release = await operations.getVerifiedGithubRelease();
    const workflow = githubAutomationWorkflow({ release, environment: connection.trust.environment, planId, connectionId: connection.id, selector });
    terminal.write(`Save this workflow in ${location.repository}/${location.path} on branch ${location.branch}. The file and branch must match the verified connection.`);
    terminal.write(workflow);
    return 0;
  }
  if (!grant && action === 'create') {
    const id = options['--id'] ?? randomUUID();
    const provider = options['--provider'] as AutomationProvider;
    const environment = options['--deployment-environment'];
    const allowed: Record<AutomationProvider, string[]> = { GITHUB: ['--id', '--name', '--provider', '--deployment-environment', '--repository', '--environment', '--workflow'], GOOGLE_CLOUD: ['--id', '--name', '--provider', '--deployment-environment', '--audience-base', '--subject'], AWS: ['--id', '--name', '--provider', '--deployment-environment', '--role-arn'], PORTABLE: ['--id', '--name', '--provider', '--deployment-environment', '--key-id', '--public-key', '--subject', '--environment'] };
    if (!allowed[provider] || !options['--name'] || !environment || !['TEST', 'LIVE'].includes(environment) || Object.keys(options).some(key => !allowed[provider].includes(key))) { terminal.writeError(usage); return 1; }
    const details = trust(options, provider, id);
    if (!details) { terminal.writeError(usage); return 1; }
    await operations.createConnection({ id, name: options['--name'], provider, environment: environment as 'TEST' | 'LIVE', trust: details });
    terminal.write(`Connection created: ${id}`);
    if (provider === 'GITHUB') terminal.write(`Expected audience: urn:inheriti:automation:connection:${id}`);
    if (details.method === 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC') terminal.write(`Expected audience: ${details.audience}`);
    return 0;
  }
  if (!grant) {
    if (Object.keys(options).some(key => action === 'trust' ? !['--connection', '--provider', '--repository', '--environment', '--workflow', '--audience-base', '--subject', '--role-arn', '--key-id', '--public-key'].includes(key) : key !== '--connection')) { terminal.writeError(usage); return 1; }
    const connectionId = await choose(options['--connection'], terminal, 'Which connection?', options['--connection'] ? [] : (await operations.listConnections()).map(({ id, name }) => ({ id, name })), signal);
    if (!connectionId) { terminal.writeError('Connection ID required.'); return 1; }
    if (action === 'verify') return automationProof(context, terminal, signal, operations, connectionId);
    if (action === 'disable') await operations.disableConnection(connectionId);
    else {
      const provider = options['--provider'] as AutomationProvider;
      const details = trust(options, provider, connectionId);
      if (!details) { terminal.writeError(usage); return 1; }
      await operations.changeTrust(connectionId, details);
    }
    terminal.write(`Connection ${action === 'disable' ? 'disabled' : 'trust changed'}: ${connectionId}`);
    return 0;
  }
  const allowedGrant = action === 'create' ? ['--plan', '--connection', '--member', '--id'] : action === 'member' ? ['--plan', '--grant', '--member'] : ['--plan', '--grant'];
  if (Object.keys(options).some(key => !allowedGrant.includes(key))) { terminal.writeError(usage); return 1; }
  const plans = options['--plan'] ? [] : await operations.listPlans();
  const planId = await choose(options['--plan'], terminal, 'Which plan?', plans.map(({ id, name, title }) => ({ id, name: name ?? title })), signal);
  if (!planId) { terminal.writeError('Plan ID required.'); return 1; }
  const existing = action === 'create' || options['--grant'] ? [] : await operations.listGrants(planId);
  const grantId = action === 'create' ? options['--id'] ?? randomUUID() : await choose(options['--grant'], terminal, 'Which grant?', existing.map(({ id }) => ({ id })), signal);
  if (!grantId) { terminal.writeError('Grant ID required.'); return 1; }
  if (action === 'create') {
    const connectionId = await choose(options['--connection'], terminal, 'Which connection?', options['--connection'] ? [] : (await operations.listConnections()).map(({ id, name }) => ({ id, name })), signal);
    const memberId = await member(options['--member'], operations, terminal, signal);
    if (!connectionId || !memberId) { terminal.writeError('Connection and responsible member required.'); return 1; }
    await operations.createGrant(planId, { id: grantId, connectionId, responsibleMemberId: memberId });
  } else if (action === 'activate') await operations.activateGrant(planId, grantId);
  else if (action === 'revoke') await operations.revokeGrant(planId, grantId);
  else {
    const memberId = await member(options['--member'], operations, terminal, signal);
    if (!memberId) { terminal.writeError('Responsible member required.'); return 1; }
    await operations.replaceResponsibleMember(planId, grantId, memberId);
  }
  terminal.write(`Grant ${{ create: 'created', activate: 'activated', revoke: 'revoked', member: 'responsible member changed' }[action]}: ${grantId}`);
  return 0;
}
async function member(value: string | undefined, operations: AutomationSetupOperations, terminal: Terminal, signal: AbortSignal): Promise<string | undefined> {
  return choose(value, terminal, 'Which responsible member?', value ? [] : (await operations.listMembers()).map(({ id, firstName, lastName }) => ({ id, name: [firstName, lastName].filter(Boolean).join(' ') })), signal);
}

async function automationProof(context: CliContext, terminal: Terminal, signal: AbortSignal, operations: AutomationSetupOperations, connectionId: string): Promise<number> {
  if (!terminal.interactive) { terminal.writeError('Identity verification requires an interactive terminal and desktop window.'); return 1; }
  const windowClosed = new AbortController();
  let unavailable = false;
  const window = createNativeWindowSession(reason => { unavailable = reason === 'unavailable'; windowClosed.abort(); });
  let completed = false;
  try {
    terminal.write('Opening identity verification window…');
    const result = await runLocalAutomationProofBrowser({ operations, open: url => window.open(url), connectionId, signal: AbortSignal.any([signal, windowClosed.signal]), organizationName: context.organization!.name });
    if (result.action !== 'verified') { terminal.write('Identity verification canceled.'); return 1; }
    completed = true;
    terminal.write(`Identity verified for connection ${connectionId}.`);
    return 0;
  } catch (error) { if (unavailable) throw new Error('local_window_unavailable'); throw error; }
  finally { if (completed) window.complete(); else window.close(); }
}

export async function automationMetadata(context: CliContext, configuration: CliConfiguration, terminal: Terminal, planId?: string): Promise<number> {
  if (!(await context.core.getAccessToken())) { terminal.writeError('Sign in before listing automations.'); return 1; }
  const operations = createAutomationSetupOperations({
    apiUrl: configuration.apiUrl,
    organizationId: context.organization!.id,
    getBearerToken: () => context.core.getAccessToken(),
  });
  if (planId) {
    const grants = await operations.listGrants(planId);
    renderJson(terminal, { organizationId: context.organization!.id, planId, items: grants.map(({ id, connectionId, responsibleMemberId, status }) => ({ id, connectionId, responsibleMemberId, status })) });
  } else {
    const connections = await operations.listConnections();
    renderJson(terminal, { organizationId: context.organization!.id, items: connections.map(({ id, name, provider, environment, status }) => ({ id, name, provider, environment, status })) });
  }
  return 0;
}
