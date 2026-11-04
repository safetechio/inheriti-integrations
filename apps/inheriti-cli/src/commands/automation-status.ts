import { createAutomationSetupOperations, createAutomationStatusReader } from '@safetech/inheriti-elements-core/node-base';
import type { AutomationStatusSnapshot } from '@safetech/inheriti-elements-core/node-base';
import type { CliConfiguration } from '../configuration.js';
import type { CliContext } from '../session.js';
import type { Terminal } from '../output.js';
import { redact, renderJson } from '../output.js';
import { promptSelect } from '../render/select.js';
import { connectionChoice, operationalConnections } from './automation-choices.js';

const usage = 'Usage: inheriti automations status [--organization ID] [--plan ID] [--connection ID] [--job ID] [--watch] [--json]';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stepNames: Record<string, string> = { CONNECTION: 'Connection', IDENTITY: 'Workload identity', PLAN_ACCESS: 'Plan access', READY: 'Ready' };
const actor = (action: { actor: string; responsibleMemberId?: string }) => action.responsibleMemberId ? `${action.actor}, member ${action.responsibleMemberId}` : action.actor;
const actionNames: Record<string, string> = {
  CREATE_GRANT: 'Create a plan grant', VERIFY_IDENTITY: 'Verify the workload identity', ACTIVATE_GRANT: 'Activate the plan grant', REVIEW_GRANT: 'Review the plan grant', REPLACE_CONNECTION: 'Choose a valid connection',
  RELEASE_ORGANISATION_KEY: 'Release the Organisation key', CONFIRM_AUTHENTICATION: 'Confirm authentication', APPROVE_MODERATION: 'Approve the request', RELEASE_CUSTODIAN_SHARE: 'Release the custodian share', WAIT: 'Wait for the current step', REVIEW_EXECUTION: 'Review the execution',
};
function display(terminal: Terminal, snapshot: AutomationStatusSnapshot): void {
  terminal.write(`${snapshot.provider} automation · ${snapshot.setup.status} · ${snapshot.observedAt}`);
  for (const step of snapshot.setup.steps) terminal.write(`  ${stepNames[step.code]}: ${step.state}`);
  if (snapshot.setup.nextAction) terminal.write(`Next: ${actionNames[snapshot.setup.nextAction.code]} (${actor(snapshot.setup.nextAction)})`);
  if (snapshot.setup.nextAction?.reason) terminal.write(`Reason: ${snapshot.setup.nextAction.reason}`);
  if (!snapshot.setup.nextAction && snapshot.setup.status === 'READY') terminal.write('Setup is ready.');
  else if (!snapshot.setup.nextAction) terminal.write('Next: inspect the plan and connection.');
  terminal.write(`Executions: ${snapshot.executions.items.length}${snapshot.executions.hasMore ? ' (more available)' : ''}`);
  for (const item of snapshot.executions.items) {
    terminal.write(`  Job ${item.jobId}${item.revealId ? ` · Reveal ${item.revealId}` : ''}${item.relayId ? ` · Relay ${item.relayId}` : ''}: ${item.status} · ${item.stage}${item.runReference ? ` · Run ${item.runReference}` : ''}${item.status === 'DELIVERED' ? ' · Organisation key delivered; automation outcome unverified' : ''}`);
    if (item.nextAction) terminal.write(`    Next: ${actionNames[item.nextAction.code]} (${actor(item.nextAction)})`);
  }
  terminal.write('Provider run status: unverified.');
}
export async function automationStatus(context: CliContext, configuration: CliConfiguration, terminal: Terminal, argv: readonly string[], signal: AbortSignal): Promise<number> {
  const options: Record<string, string> = {};
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index]!;
    if (key === '--watch' || key === '--json') { if (key in options) { terminal.writeError(usage); return 1; } options[key] = 'true'; continue; }
    if (!['--plan', '--connection', '--job'].includes(key) || key in options || !argv[index + 1] || argv[index + 1]!.startsWith('--')) { terminal.writeError(usage); return 1; }
    options[key] = argv[++index]!;
  }
  if (['--plan', '--connection', '--job'].some(key => options[key] && !uuid.test(options[key]!))) { terminal.writeError('Plan, connection and job must be UUIDs.'); return 1; }
  if (!(await context.core.getAccessToken())) { terminal.writeError('Sign in before checking automation status.'); return 1; }
  const operations = createAutomationSetupOperations({ apiUrl: configuration.apiUrl, organizationId: context.organization!.id, getBearerToken: () => context.core.getAccessToken() });
  const planId = options['--plan'] ?? (terminal.interactive ? await promptSelect('Plan', (await operations.listPlans()).map(item => ({ value: item.id, description: item.name ?? item.title ?? item.id })), signal) : undefined);
  if (!planId) { terminal.writeError('A plan is required. Use --plan ID.'); return 1; }
  const connectionId = options['--connection'] ?? (terminal.interactive ? await promptSelect('Connection', operationalConnections(await operations.listConnections()).map(item => ({ value: item.id, description: connectionChoice(item).name })), signal) : undefined);
  if (!connectionId) { terminal.writeError('A connection is required. Use --connection ID.'); return 1; }
  const read = createAutomationStatusReader({ apiUrl: configuration.apiUrl, organizationId: context.organization!.id, getBearerToken: () => context.core.getAccessToken() });
  do {
    let snapshot: AutomationStatusSnapshot;
    try { snapshot = await read(planId, connectionId, options['--job'], signal); }
    catch (error) { if (signal.aborted) return 0; throw error; }
    if (options['--json'] && options['--watch']) terminal.write(JSON.stringify(redact(snapshot)));
    else if (options['--json']) renderJson(terminal, snapshot);
    else display(terminal, snapshot);
    if (!options['--watch']) return 0;
    await new Promise<void>(resolve => {
      if (signal.aborted) return resolve();
      const timer = setTimeout(done, 5000);
      function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }
      signal.addEventListener('abort', done, { once: true });
    });
  } while (!signal.aborted);
  return 0;
}
