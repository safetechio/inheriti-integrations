#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { BUILD_DEPLOYMENT, defaultConfigurationPath, resolveConfiguration } from './configuration.js';
import { defaultSessionPath } from './session-store.js';
import { createCliContext } from './session.js';
import { login } from './commands/login.js';
import { logout } from './commands/logout.js';
import { resolvePlanId } from './commands/plans.js';
import { listMemberLogs } from './commands/members.js';
export { parsePlanHints, parseMemberLogOptions } from './commands/arguments.js';
export { messageFor } from './commands/errors.js';
import { assertPlaintextDestination } from './commands/reveal.js';
import { completeWords, completionNeedsPlanContext, printCompletionScript } from './commands/completion.js';
import { processTerminal } from './output.js';
import { organizationCommand, selectedOrganization } from './organizations.js';
import { notifyCliUpdate, updateCli } from './commands/update.js';
import type { Terminal } from './output.js';
import { setup } from './commands/setup.js';
import { registerCliCancel } from './cancellation.js';
import { automationManage, automationMetadata } from './commands/automations.js';
import { automationSetup } from './commands/automation-setup.js';
import { pairAwsAutomationService } from './commands/automation-pair-aws.js';
import { pairGoogleAutomationWorkload } from './commands/automation-pair-google.js';
import { publishAwsSecrets } from './commands/secrets-publish-aws.js';
import { publishGoogleSecrets } from './commands/secrets-publish-google.js';
import { automationConfigurationComplete, automationSecretsRequested, pairAutomationIdentity, withAutomationSecrets } from './automation-secrets.js';
import { usage, commandUsage, helpTopic } from './commands/help.js';
import { extractOrganization, parseResolveOptions, parseMemberLogOptions } from './commands/arguments.js';
import { secrets, requiredAutomationPlanId } from './commands/secrets.js';
import { plans } from './commands/plan-command.js';
import { messageFor, MESSAGES } from './commands/errors.js';
import { CLI_FEATURE_FLAGS } from './feature-flags.js';
import { openInheritiFile } from '@safetech/inheriti-elements-core/node-base';

export async function run(
  argv: readonly string[],
  environmentVariables: Readonly<Record<string, string | undefined>>,
  terminal: Terminal,
): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined) { terminal.write(usage(environmentVariables)); return 1; }
  if (command === '--version' || command === 'version') {
    terminal.write(`${JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version}\n`);
    return 0;
  }
  if (command === '--help') { terminal.write(usage(environmentVariables)); return 0; }
  const topic = helpTopic(argv);
  if (topic) { terminal.write(commandUsage(topic, environmentVariables)); return 0; }
  // Printing a script needs no configuration, and must work before the CLI is ever configured.
  if (command === 'setup') return await setup(rest, environmentVariables, terminal);
  if (command === 'completion') return printCompletionScript(terminal, rest[0]);
  if (command === 'plans' && rest[0] === 'open') {
    if (rest.length !== 2 || !rest[1]) { terminal.writeError(commandUsage(['plans', 'open'], environmentVariables)); return 1; }
    try { await openInheritiFile(rest[1]); terminal.write('Opened in Inheriti Workspace.\n'); return 0; }
    catch { terminal.writeError('Could not open the file in Inheriti Workspace. Check the file and Workspace installation.'); return 1; }
  }
  const routing = { business: Boolean(BUILD_DEPLOYMENT) };
  try {
    if (command === 'login' && rest.length > 0) {
      terminal.writeError(commandUsage(['login'], environmentVariables));
      return 1;
    }
    if (command === 'logout' && rest.length > 0) {
      terminal.writeError(commandUsage(['logout'], environmentVariables));
      return 1;
    }
    const secretDelivery = command === 'secrets' && (rest[0] === 'exec' || rest[0] === 'resolve');
    if (command === 'automations' && (!BUILD_DEPLOYMENT || !CLI_FEATURE_FLAGS[BUILD_DEPLOYMENT].automation))
      throw new Error('automation_disabled');
    const separator = rest.indexOf('--');
    const markerIndex = secretDelivery ? rest.slice(0, separator < 0 ? undefined : separator).indexOf('--automation') : -1;
    const automation = markerIndex >= 0;
    if (secretDelivery && (automation || automationSecretsRequested(environmentVariables)) &&
        (!BUILD_DEPLOYMENT || !CLI_FEATURE_FLAGS[BUILD_DEPLOYMENT].automation)) {
      throw new Error('automation_disabled');
    }
    if (automation) rest.splice(markerIndex, 1);
    if (secretDelivery && (automation || automationSecretsRequested(environmentVariables))) {
      if (!automation || !automationConfigurationComplete(environmentVariables))
        throw new Error('automation_configuration_required');
    }
    if (command === 'secrets' && rest[0] === 'resolve') {
      const extracted = extractOrganization(rest);
      if ('error' in extracted) { terminal.writeError(extracted.error); return 1; }
      const args = extracted.argv.slice(1);
      const parsed = parseResolveOptions(args[0] && !args[0].startsWith('--') ? args.slice(1) : args);
      if ('error' in parsed) { terminal.writeError(parsed.error); return 1; }
      assertPlaintextDestination(terminal, parsed.allowPlaintextOutput);
    }
    const configuration = resolveConfiguration(environmentVariables, environmentVariables.INHERITI_ELEMENTS_CONFIRM_LIVE);
    routing.business = configuration.business === true;
    if (secretDelivery && automation) {
      if (!configuration.business) throw new Error('automation_business_required');
      const separator = rest.indexOf('--');
      if ((separator < 0 ? rest : rest.slice(0, separator)).includes('--organization'))
        throw new Error('automation_organization_option_forbidden');
      return await withAutomationSecrets(configuration.apiUrl, environmentVariables,
        (workload) => secrets(workload, terminal, rest, async (id) => requiredAutomationPlanId(id), true));
    }
    const context = createCliContext(configuration, defaultSessionPath(environmentVariables));
    if (command === 'update') {
      if (rest.length > 1 || (rest.length === 1 && rest[0] !== '--install')) { terminal.writeError(commandUsage(['update'], environmentVariables)); return 1; }
      if (!configuration.business || !BUILD_DEPLOYMENT) { terminal.writeError('Updates require a channel-locked Business build.'); return 1; }
      return await updateCli(context, terminal, JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version, rest[0] === '--install');
    }
    if (command === 'organizations') {
      if (!configuration.business) { terminal.writeError(MESSAGES.business_context_required!); return 1; }
      return await organizationCommand(context, configuration, defaultConfigurationPath(environmentVariables), terminal, rest);
    }
    if (command === 'automations') {
      if (!['list', 'grants', 'create', 'verify', 'trust', 'disable', 'usage', 'grant', 'setup', 'publish', 'pair'].includes(rest[0] ?? '')) { terminal.writeError(commandUsage(['automations'], environmentVariables)); return 1; }
      if (!configuration.business) { terminal.writeError(MESSAGES.business_context_required!); return 1; }
      if (rest[0] === 'pair' && rest[1] === 'redeem' && rest.length === 2) {
        await pairAutomationIdentity(configuration.apiUrl, environmentVariables);
        terminal.write('Workload identity verified.');
        return 0;
      }
      if ((rest[0] === 'list' && rest.length !== 1) || (rest[0] === 'grants' && (rest.length !== 2 || !rest[1] || rest[1].startsWith('--')))) {
        terminal.writeError(commandUsage(['automations', rest[0]!], environmentVariables)); return 1;
      }
      const organization = await selectedOrganization(context, configuration, defaultConfigurationPath(environmentVariables), terminal);
      const scoped = createCliContext(configuration, defaultSessionPath(environmentVariables), organization.id);
      scoped.organization = organization;
      if (rest[0] === 'list' || rest[0] === 'grants') return await automationMetadata(scoped, configuration, terminal, rest[0] === 'grants' ? rest[1] : undefined);
      if (rest[0] === 'setup') return await automationSetup(scoped, configuration, terminal, rest.slice(1));
      if (rest[0] === 'pair' && rest[1] === 'aws') {
        const controller = new AbortController();
        const unregister = registerCliCancel(controller);
        try { return await pairAwsAutomationService(scoped, configuration, terminal, rest.slice(2), controller.signal); }
        finally { unregister(); }
      }
      if (rest[0] === 'pair' && rest[1] === 'google') {
        const controller = new AbortController();
        const unregister = registerCliCancel(controller);
        try { return await pairGoogleAutomationWorkload(scoped, configuration, terminal, rest.slice(2), controller.signal); }
        finally { unregister(); }
      }
      const controller = new AbortController();
      const unregister = registerCliCancel(controller);
      try { return await automationManage(scoped, configuration, terminal, controller.signal, rest); }
      finally { unregister(); }
    }
    if (command === 'secrets' && rest[0] === 'publish') {
      if (rest[1] !== 'aws' && rest[1] !== 'google') { terminal.writeError(commandUsage(['secrets', 'publish'], environmentVariables)); return 1; }
      if (!BUILD_DEPLOYMENT || !CLI_FEATURE_FLAGS[BUILD_DEPLOYMENT].automation) throw new Error('automation_disabled');
      if (!configuration.business) { terminal.writeError(MESSAGES.business_context_required!); return 1; }
      const organization = await selectedOrganization(context, configuration, defaultConfigurationPath(environmentVariables), terminal);
      const scoped = createCliContext(configuration, defaultSessionPath(environmentVariables), organization.id);
      scoped.organization = organization;
      if (rest[1] === 'aws') return await publishAwsSecrets(scoped, terminal, rest.slice(2));
      return await publishGoogleSecrets(scoped, terminal, rest.slice(2));
    }
    if (command === '__complete') {
      if (!configuration.business) return await completeWords(context, terminal, rest, environmentVariables);
      if (rest.at(-2) === '--organization') return await completeWords(context, terminal, rest, environmentVariables);
      const parsed = extractOrganization(rest);
      if ('error' in parsed) return 0;
      if (!completionNeedsPlanContext(parsed.argv)) return await completeWords(context, terminal, parsed.argv, environmentVariables);
      const organization = await selectedOrganization(context, configuration, defaultConfigurationPath(environmentVariables), terminal, parsed.organizationId);
      const scoped = createCliContext(configuration, defaultSessionPath(environmentVariables), organization.id);
      scoped.organization = organization;
      return await completeWords(scoped, terminal, parsed.argv, environmentVariables);
    }
    if (command === 'login') return await login(context, terminal);
    if (command === 'logout') return await logout(context, terminal);
    if (command === 'members') {
      if (!configuration.business) { terminal.writeError(MESSAGES.business_context_required!); return 1; }
      const parsed = extractOrganization(rest);
      if ('error' in parsed) { terminal.writeError(parsed.error); return 1; }
      const [subcommand, memberId, ...options] = parsed.argv;
      if (subcommand !== 'logs' || !memberId || memberId.startsWith('--')) { terminal.writeError(commandUsage(['members'], environmentVariables)); return 1; }
      const filters = parseMemberLogOptions(options);
      if ('error' in filters) { terminal.writeError(filters.error); return 1; }
      const organization = await selectedOrganization(context, configuration, defaultConfigurationPath(environmentVariables), terminal, parsed.organizationId);
      const scoped = createCliContext(configuration, defaultSessionPath(environmentVariables), organization.id);
      scoped.organization = organization;
      return await listMemberLogs(scoped, terminal, memberId, filters);
    }
    if (command === 'plans' || command === 'secrets') {
      if (!configuration.business) return command === 'plans' ? await plans(context, terminal, rest) : await secrets(context, terminal, rest, (id) => resolvePlanId(context, terminal, id));
      const parsed = extractOrganization(rest);
      if ('error' in parsed) { terminal.writeError(parsed.error); return 1; }
      const organization = await selectedOrganization(context, configuration, defaultConfigurationPath(environmentVariables), terminal, parsed.organizationId);
      const scoped = createCliContext(configuration, defaultSessionPath(environmentVariables), organization.id);
      scoped.organization = organization;
      return command === 'plans' ? await plans(scoped, terminal, parsed.argv, configuration) : await secrets(scoped, terminal, parsed.argv, (id) => resolvePlanId(scoped, terminal, id));
    }
    terminal.writeError(`Unknown command: ${command}`);
    return 1;
  } catch (error) {
    if (command === '__complete') return 0;
    terminal.writeError(messageFor(error, routing.business));
    return 1;
  }
}

// npm links the global binary, so argv[1] is the symlink while `import.meta.url` is its target.
const isEntrypoint = process.argv[1] !== undefined
    && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
if (isEntrypoint) {
  const terminal = processTerminal();
  const argv = process.argv.slice(2);
  process.exitCode = await run(argv, process.env, terminal);
  if (process.exitCode === 0 && terminal.interactive && ['login', 'organizations', 'plans'].includes(argv[0] ?? '')) {
    try {
      const configuration = resolveConfiguration(process.env, process.env.INHERITI_ELEMENTS_CONFIRM_LIVE);
      if (configuration.business && BUILD_DEPLOYMENT) {
        await notifyCliUpdate(createCliContext(configuration, defaultSessionPath(process.env)), terminal,
          JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version, defaultSessionPath(process.env));
      }
    } catch { /* Update notices never change command results. */ }
  }
}
