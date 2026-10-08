#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { BUILD_DEPLOYMENT, CliConfigurationInvalid, defaultConfigurationPath, resolveConfiguration } from './configuration.js';
import { defaultSessionPath } from './session-store.js';
import { createCliContext } from './session.js';
import { login, loginWithDevice } from './commands/login.js';
import { logout } from './commands/logout.js';
import { abortPlanAccess, listPlanLogs, listPlans, resolvePlanId, showPlan } from './commands/plans.js';
import type { ListPlansOptions, PlanLogsOptions } from './commands/plans.js';
import { isFieldSelector, assertPlaintextDestination, resolvePlanField, revealPlan } from './commands/reveal.js';
import { downloadPlanAsset } from './commands/download.js';
import { UsePlanInvalid, usePlan } from './commands/use.js';
import { completeWords, completionNeedsPlanContext, printCompletionScript } from './commands/completion.js';
import { processTerminal } from './output.js';
import { organizationCommand, selectedOrganization, OrganizationChoiceRequired } from './organizations.js';
import { notifyCliUpdate, updateCli } from './commands/update.js';
import type { Terminal } from './output.js';
import { noColorFromEnvironment, terminalWordmark } from '@safetech/inheriti-elements-brand';
import { setup } from './commands/setup.js';
import { registerCliCancel } from './cancellation.js';
import { createPlan } from './commands/create-plan.js';
import type { CliConfiguration } from './configuration.js';
import { quickPlanAssetCatalog, localPlanAssetLimit } from '@safetech/inheriti-elements-core/node-base';
import type { LocalPlanHints } from '@safetech/inheriti-elements-core/node-base';
import { automationSecretsRequested, withAutomationSecrets } from './automation-secrets.js';
import type { SecretRevealContext } from './session.js';

export function parsePlanHints(args: readonly string[]): LocalPlanHints | undefined {
  const hints: { title?: string; description?: string; assetTypes: string[] } = { assetTypes: [] };
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!value || value.startsWith('--')) return;
    if (key === '--title' && !hints.title && value.trim().length <= 200) hints.title = value.trim();
    else if (key === '--description' && !hints.description && value.trim().length <= 1_000) hints.description = value.trim();
    else if (key === '--asset' && quickPlanAssetCatalog.some(({ id }) => id === value) && !hints.assetTypes.includes(value) && hints.assetTypes.length < localPlanAssetLimit) hints.assetTypes.push(value);
    else return;
  }
  return hints;
}

function usage(environmentVariables: Readonly<Record<string, string | undefined>>): string {
  const configuration = BUILD_DEPLOYMENT
    ? `Configuration: this artifact is locked to the ${BUILD_DEPLOYMENT} Business deployment. Sign in, then select an organization.`
    : `Configuration: config.json in the existing CLI configuration directory.
             apiUrl, issuer and clientId are required; applicationId is required for
             standalone plans. For Business set business: true and deployment to
             local, dev or stg; prod requires a production build.
             Environment defaults to TEST. Existing environment overrides still work.`;
  return `${terminalWordmark({ noColor: noColorFromEnvironment(environmentVariables) })}

inheriti <command>

  login [--device]   Sign in — in the browser, or with a device code when headless
  logout             Clear the local session
  organizations list List Business organizations and the selected one
  organizations use [id] Select a Business organization
  plans list [--limit n] [--all] [--cursor c] [--organization id]
                     List plans in the selected context
  plans create [--title NAME] [--description TEXT] [--asset TYPE ...]
                     Prefill the desktop assistant with plan metadata and likely asset types
  plans show [id]    Show one plan, its assets and its participants
  plans logs [id] [--limit n] [--offset n] [--json|--table]
                     Show the plan activity log
  plans reveal [id] [--field asset.field ...]
                     Copy one or more selected fields without printing their values.
                     Whether approval is needed is read from the plan.
  plans download [id] --asset code-or-id --output path
                     Save one authorized media asset to a new restricted file.
  plans use [id] [--stdin asset.field] [--env NAME=asset.field ...] [--fd N=asset.field ...] [--temp-file NAME=asset.field ...] [--socket NAME=asset.field ...] [--ttl 30s] -- command [args]
                     Run an exact executable with destination-bound secrets. No shell.
  secrets exec [id] [--env NAME=asset.field ...] [--output inherit] -- command [args]
                     Run a process with reveal-authorized environment variables.
  secrets resolve [id] --field asset.field --allow-plaintext-output
                     Resolve one field for a machine wrapper. Raw output is intended for a pipe.
  setup [--yes|--no-completion] [--shell bash|zsh|fish]
                     Enable shell autocomplete (Yes is the default)
  completion <shell> Print the tab-completion script for bash, zsh or fish
  update [--install] Check for a newer CLI build; install after confirmation
  help [command]    Show detailed usage without signing in

An id or a --field left out is asked for in a terminal, and refused in a pipe.

Output:      a table by default; --json prints the raw response, and is the only
             form that returns the pagination cursor

${configuration}`;
}

function commandUsage(topic: readonly string[], environmentVariables: Readonly<Record<string, string | undefined>>): string {
  const command = topic.join(' ');
  const details: Readonly<Record<string, string>> = {
    login: `Usage: inheriti login [--device]\n\nSign in using the system browser. --device uses a device code for headless environments and can continue through the plan's approval process.`,
    logout: `Usage: inheriti logout\n\nClear the locally stored operator session. This does not delete plans or plan data.`,
    organizations: `Usage: inheriti organizations <list|use [ID]>\n\nList eligible Business organizations or select one for this account.`,
    plans: `Usage: inheriti plans <create|list|show|logs|reveal|download|abort>\n\nCreate a plan or inspect plan metadata and activity. Run inheriti help plans <command> for details.`,
    'plans create': `Usage: inheriti plans create [--title NAME] [--description TEXT] [--asset TYPE ...]\n\nPrefill editable, non-secret plan metadata and likely asset types in the desktop window. Repeat --asset for up to ${localPlanAssetLimit} catalog types. Types: ${quickPlanAssetCatalog.map(({ id }) => id).join(', ')}. Enter secret values only in the window. Requires an interactive terminal, a selected Organisation, and sign-in. First use offers a model and runtime download of about 1.1 GB.`,
    'plans list': `Usage: inheriti plans list [--limit N] [--all] [--cursor CURSOR] [--json|--table]\n\nList non-sensitive plan metadata. --json never includes reconstructed secret values.`,
    'plans show': `Usage: inheriti plans show [PLAN_ID] [--json|--table]\n\nShow one plan's non-sensitive assets, fields, participants, governance, and reveal policy. An interactive terminal can prompt for PLAN_ID.`,
    'plans logs': `Usage: inheriti plans logs [PLAN_ID] [--limit N] [--offset N] [--json|--table]\n\nShow authorized plan activity. The table summarizes events; --json includes all safe log fields and total count. An interactive terminal can prompt for PLAN_ID.`,
    'plans reveal': `Usage: inheriti plans reveal [PLAN_ID] [--field ASSET.FIELD ...] [--clipboard-ttl DURATION]\n\nRun the plan's authorization flow and copy selected fields to the local clipboard. Values are never printed. In a terminal, omit --field to select fields with Space or choose ALL. Each field copy is authorized and audited independently. --clipboard-ttl waits in the foreground and conditionally clears unchanged clipboard content. Cleanup is best effort; clipboard history, synchronization, shutdown and SIGKILL remain outside its control.`,
    'plans download': `Usage: inheriti plans download [PLAN_ID] --asset CODE_OR_ID --output PATH\n\nAuthorize and save one media asset to a new file with owner-only permissions. Existing files are never overwritten.`,
    'plans use': `Usage: inheriti plans use [PLAN_ID] [--stdin ASSET.FIELD] [--env NAME=ASSET.FIELD ...] [--fd N=ASSET.FIELD ...] [--temp-file NAME=ASSET.FIELD ...] [--socket NAME=ASSET.FIELD ...] [--ttl DURATION] -- EXECUTABLE [ARGUMENT ...]\n\nAuthorize and deliver secrets directly to one trusted child process without printing them or placing them in arguments. --stdin maps one field to stdin. Repeat --env for child-only environment variables, --fd for descriptors 3-255, --temp-file to pass a restricted temporary path through NAME, and --socket to pass a one-connection local socket endpoint through NAME. DURATION accepts ms, s, m, or h, up to 2147483647ms. --ttl bounds the whole command; authorization expiry may end delivery sooner. Child environment variables may be inspectable by same-user processes. Temporary files and socket endpoints are removed on handled completion; unlinking is not secure deletion. A socket trusts the local account, not the identity of its first peer. Sockets and descriptors are unsupported on Windows. Child stdout and stderr are suppressed because a generic executable could echo its credential; only Inheriti metadata/status is returned. --output inherit explicitly exposes child logs, which may contain credentials. Approve the exact command before an agent runs it.`,
    secrets: `Usage: inheriti secrets <exec|resolve>\n\nMachine-oriented secret delivery built on the same reveal and use flows as plans commands.`,
    'secrets exec': `Usage: inheriti secrets exec [PLAN_ID] [--env NAME=ASSET.FIELD ...] [--output inherit] -- EXECUTABLE [ARGUMENT ...]\n\nRun a child process with reveal-authorized environment variables. The reveal flow, approvals and field auditing are unchanged. Output is suppressed by default; --output inherit keeps the child's logs visible and may expose credentials.`,
    'secrets resolve': `Usage: inheriti secrets resolve [PLAN_ID] --field ASSET.FIELD --allow-plaintext-output\n\nResolve one field through the full reveal flow and write only its value to stdout for a trusted wrapper. Do not use this command in a terminal or redirect its output to logs.`,
    'plans abort': `Usage: inheriti plans abort PLAN_ID\n\nAbandon the current access request for this operator. The next reveal starts a new access flow.`,
    setup: `Usage: inheriti setup [--yes|--no-completion] [--shell bash|zsh|fish]\n\nOffer to enable shell autocomplete, with Yes selected by default. --yes installs without prompting; --no-completion skips. No configuration or sign-in is required.`,
    completion: `Usage: inheriti completion <bash|zsh|fish>\n\nPrint a shell-completion script. This command does not require configuration or sign-in.`,
    update: `Usage: inheriti update [--install]\n\nCheck for an update in this build's channel. --install confirms and installs it with npm.`,
    help: `Usage: inheriti help [COMMAND [SUBCOMMAND]]\n\nExamples:\n  inheriti help plans reveal\n  inheriti plans reveal --help`,
  };
  return details[command] ?? usage(environmentVariables);
}

function helpTopic(argv: readonly string[]): readonly string[] | undefined {
  const [command, ...rest] = argv;
  if (command === 'help') return rest.length === 0 ? ['help'] : rest;
  const helpAt = argv.indexOf('--help');
  if (helpAt >= 0) return argv.slice(0, helpAt);
  return undefined;
}

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
  let business = Boolean(BUILD_DEPLOYMENT);
  try {
    const secretDelivery = command === 'secrets' && (rest[0] === 'exec' || rest[0] === 'resolve');
    const separator = rest.indexOf('--');
    const markerIndex = secretDelivery ? rest.slice(0, separator < 0 ? undefined : separator).indexOf('--automation') : -1;
    const automation = markerIndex >= 0;
    if (automation) rest.splice(markerIndex, 1);
    if (secretDelivery && (automation || automationSecretsRequested(environmentVariables))) {
      const google = environmentVariables.INHERITI_AUTOMATION_PROVIDER === 'GOOGLE_CLOUD';
      const portable = environmentVariables.INHERITI_AUTOMATION_PROVIDER === 'PORTABLE';
      const aws = environmentVariables.INHERITI_AUTOMATION_PROVIDER === 'AWS';
      if (!automation || !environmentVariables.INHERITI_AUTOMATION_CONNECTION_ID ||
          (!portable && !aws && !environmentVariables.INHERITI_AUTOMATION_AUDIENCE) ||
          (aws && !environmentVariables.AWS_REGION && !environmentVariables.AWS_DEFAULT_REGION) ||
          (portable && (!environmentVariables.INHERITI_AUTOMATION_PRIVATE_KEY_FILE || !environmentVariables.INHERITI_AUTOMATION_KEY_ID ||
              !environmentVariables.INHERITI_AUTOMATION_RUNNER_SUBJECT || !environmentVariables.INHERITI_AUTOMATION_ENVIRONMENT)) ||
          (!google && !portable && !aws && (!environmentVariables.ACTIONS_ID_TOKEN_REQUEST_URL || !environmentVariables.ACTIONS_ID_TOKEN_REQUEST_TOKEN)))
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
    business = configuration.business === true;
    if (secretDelivery && automation) {
      if (!configuration.business) throw new Error('automation_business_required');
      const separator = rest.indexOf('--');
      if ((separator < 0 ? rest : rest.slice(0, separator)).includes('--organization'))
        throw new Error('automation_organization_option_forbidden');
      return await withAutomationSecrets(configuration.apiUrl, environmentVariables,
        (workload) => secrets(workload, terminal, rest, async (id) => requiredAutomationPlanId(id), true));
    }
    // The device grant is a different OAuth client, so the choice has to be made before the context
    // exists — and every later command reads whichever session that login wrote.
    const headless = command === 'login' && rest.includes('--device');
    const context = createCliContext(
      configuration,
      defaultSessionPath(environmentVariables),
      headless ? 'device' : 'interactive',
    );
    if (command === 'update') {
      if (rest.length > 1 || (rest.length === 1 && rest[0] !== '--install')) { terminal.writeError(commandUsage(['update'], environmentVariables)); return 1; }
      if (!configuration.business || !BUILD_DEPLOYMENT) { terminal.writeError('Updates require a channel-locked Business build.'); return 1; }
      return await updateCli(context, terminal, JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version, rest[0] === '--install');
    }
    if (command === 'organizations') {
      if (!configuration.business) { terminal.writeError(MESSAGES.business_context_required!); return 1; }
      return await organizationCommand(context, configuration, defaultConfigurationPath(environmentVariables), terminal, rest);
    }
    if (command === '__complete') {
      if (!configuration.business) return await completeWords(context, terminal, rest, environmentVariables);
      if (rest.at(-2) === '--organization') return await completeWords(context, terminal, rest, environmentVariables);
      const parsed = extractOrganization(rest);
      if ('error' in parsed) return 0;
      if (!completionNeedsPlanContext(parsed.argv)) return await completeWords(context, terminal, parsed.argv, environmentVariables);
      const organization = await selectedOrganization(context, configuration, defaultConfigurationPath(environmentVariables), terminal, parsed.organizationId);
      const scoped = createCliContext(configuration, defaultSessionPath(environmentVariables), 'interactive', organization.id);
      scoped.organization = organization;
      return await completeWords(scoped, terminal, parsed.argv, environmentVariables);
    }
    if (command === 'login') return await (headless ? loginWithDevice(context, terminal) : login(context, terminal));
    if (command === 'logout') return await logout(context, terminal);
    if (command === 'plans' || command === 'secrets') {
      if (!configuration.business) return command === 'plans' ? await plans(context, terminal, rest) : await secrets(context, terminal, rest, (id) => resolvePlanId(context, terminal, id));
      const parsed = extractOrganization(rest);
      if ('error' in parsed) { terminal.writeError(parsed.error); return 1; }
      const organization = await selectedOrganization(context, configuration, defaultConfigurationPath(environmentVariables), terminal, parsed.organizationId);
      const scoped = createCliContext(configuration, defaultSessionPath(environmentVariables), 'interactive', organization.id);
      scoped.organization = organization;
      return command === 'plans' ? await plans(scoped, terminal, parsed.argv, configuration) : await secrets(scoped, terminal, parsed.argv, (id) => resolvePlanId(scoped, terminal, id));
    }
    terminal.writeError(`Unknown command: ${command}`);
    return 1;
  } catch (error) {
    if (command === '__complete') return 0;
    terminal.writeError(messageFor(error, business));
    return 1;
  }
}

function extractOrganization(argv: readonly string[]): { argv: string[]; organizationId?: string } | { error: string } {
  const separator = argv.indexOf('--');
  const before = separator < 0 ? argv : argv.slice(0, separator);
  const after = separator < 0 ? [] : argv.slice(separator);
  const index = before.indexOf('--organization');
  if (index < 0) return { argv: [...argv] };
  const organizationId = before[index + 1];
  if (!organizationId || organizationId.startsWith('--')) return { error: '--organization requires an ID.' };
  return { argv: [...before.slice(0, index), ...before.slice(index + 2), ...after], organizationId };
}

async function secrets(
  context: SecretRevealContext,
  terminal: Terminal,
  argv: readonly string[],
  resolveId: (planId: string | undefined) => Promise<string>,
  workload = false,
): Promise<number> {
  const [subcommand, ...rest] = argv;
  const hasPlanId = rest[0] !== undefined && rest[0] !== '--' && !rest[0].startsWith('--');
  const planId = hasPlanId ? rest[0] : undefined;
  if (subcommand === 'exec') {
    const parsed = parseUseOptions(hasPlanId ? rest.slice(1) : rest, 'secrets exec');
    if ('error' in parsed) { terminal.writeError(parsed.error); return 1; }
    const resolved = await resolveId(planId);
    const controller = new AbortController();
    const unregister = registerCliCancel(controller);
    try { return await usePlan(context, terminal, resolved, { ...parsed, signal: controller.signal, workload }); }
    finally { unregister(); }
  }
  if (subcommand === 'resolve') {
    const parsed = parseResolveOptions(hasPlanId ? rest.slice(1) : rest);
    if ('error' in parsed) { terminal.writeError(parsed.error); return 1; }
    const resolved = await resolveId(planId);
    const controller = new AbortController();
    const unregister = registerCliCancel(controller);
    try { return await resolvePlanField(context, terminal, resolved, parsed.field, { allowPlaintextOutput: parsed.allowPlaintextOutput, signal: controller.signal }); }
    finally { unregister(); }
  }
  terminal.writeError('Usage: inheriti secrets exec <id> [--env NAME=asset.field ...] -- command | inheriti secrets resolve <id> --field asset.field --allow-plaintext-output');
  return 1;
}

function requiredAutomationPlanId(planId: string | undefined): string {
  if (!planId) throw new Error('automation_plan_id_required');
  return planId;
}

async function plans(
  context: Awaited<ReturnType<typeof createCliContext>>,
  terminal: Terminal,
  argv: readonly string[],
  configuration?: CliConfiguration,
): Promise<number> {
  const [subcommand, ...rest] = argv;
  if (subcommand === 'create') {
    const hints = parsePlanHints(rest);
    if (!hints) { terminal.writeError('Usage: inheriti plans create [--title NAME] [--description TEXT] [--asset TYPE ...]'); return 1; }
    const controller = new AbortController();
    const unregister = registerCliCancel(controller);
    try { return await createPlan(context, configuration, terminal, controller.signal, new URL('./assets/font-app.ttf', import.meta.url), hints); }
    finally { unregister(); }
  }
  if (subcommand === 'list') {
    const parsed = parseListOptions(rest);
    if ('error' in parsed) {
      terminal.writeError(parsed.error);
      return 1;
    }
    return await listPlans(context, terminal, parsed);
  }
  const [planId, ...options] = rest;
  if (subcommand === 'logs') {
    const hasPlanId = planId !== undefined && !planId.startsWith('--');
    const parsed = parseLogOptions(hasPlanId ? options : rest);
    if ('error' in parsed) { terminal.writeError(parsed.error); return 1; }
    return await listPlanLogs(context, terminal, await resolvePlanId(context, terminal, hasPlanId ? planId : undefined), parsed);
  }
  if (subcommand === 'show') {
    const format = parseFormat(options);
    if ('error' in format) {
      terminal.writeError(format.error);
      return 1;
    }
    return await showPlan(context, terminal, await resolvePlanId(context, terminal, planId), format);
  }
  if (subcommand === 'abort') {
    if (options.length > 0) {
      terminal.writeError(`Unknown or incomplete abort option: ${options[0]}`);
      return 1;
    }
    return await abortPlanAccess(context, terminal, await resolvePlanId(context, terminal, planId));
  }
  if (subcommand === 'reveal') {
    const hasPlanId = planId !== undefined && !planId.startsWith('--');
    const parsed = parseRevealOptions(hasPlanId ? options : rest);
    if ('error' in parsed) {
      terminal.writeError(parsed.error);
      return 1;
    }
    const controller = new AbortController();
    const unregister = registerCliCancel(controller);
    try {
      const resolved = await resolvePlanId(context, terminal, hasPlanId ? planId : undefined, controller.signal);
      return await revealPlan(context, terminal, resolved, { ...parsed, signal: controller.signal });
    } finally { unregister(); }
  }
  if (subcommand === 'download') {
    const hasPlanId = planId !== undefined && !planId.startsWith('--');
    const parsed = parseDownloadOptions(hasPlanId ? options : rest);
    if ('error' in parsed) { terminal.writeError(parsed.error); return 1; }
    const resolved = await resolvePlanId(context, terminal, hasPlanId ? planId : undefined);
    const controller = new AbortController();
    const unregister = registerCliCancel(controller);
    try { return await downloadPlanAsset(context, terminal, resolved, parsed.asset, parsed.output, controller.signal); }
    finally { unregister(); }
  }
  if (subcommand === 'use') {
    const hasPlanId = rest[0] !== undefined && rest[0] !== '--' && !rest[0].startsWith('--');
    const candidate = hasPlanId ? rest[0] : undefined;
    const parsed = parseUseOptions(hasPlanId ? rest.slice(1) : rest);
    if ('error' in parsed) {
      terminal.writeError(parsed.error);
      return 1;
    }
    const resolved = await resolvePlanId(context, terminal, candidate);
    const controller = new AbortController();
    const unregister = registerCliCancel(controller);
    try {
      return await usePlan(context, terminal, resolved, { ...parsed, signal: controller.signal });
    } finally { unregister(); }
  }
  terminal.writeError('Usage: plans list | plans show <id> | plans logs <id> | plans reveal <id> [--field asset.field ...] | plans download <id> --asset code --output path | plans use <id> [delivery] -- command | plans abort <id>');
  return 1;
}

/**
 * Output is a table unless a caller asks for JSON: a person reads the listing far more often than a
 * script parses it, and the JSON carries the pagination cursor a table deliberately leaves out.
 */
function parseFormat(argv: readonly string[]): { format: 'table' | 'json' } | { error: string } {
  let format: 'table' | 'json' = 'table';
  for (const option of argv) {
    if (option === '--json') format = 'json';
    else if (option === '--table') format = 'table';
    else return { error: `Unknown option: ${option}` };
  }
  return { format };
}

function parseListOptions(argv: readonly string[]): ListPlansOptions | { error: string } {
  let format: 'table' | 'json' = 'table';
  let limit: number | undefined;
  let cursor: string | undefined;
  let all = false;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--json') format = 'json';
    else if (option === '--table') format = 'table';
    else if (option === '--all') all = true;
    else if (option === '--limit' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 1) return { error: 'plans list --limit takes a positive whole number.' };
      limit = value;
    } else if (option === '--cursor' && argv[index + 1]) cursor = argv[++index];
    else return { error: `Unknown or incomplete option: ${option}` };
  }
  return {
    format,
    all,
    ...(limit === undefined ? {} : { limit }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

function parseLogOptions(argv: readonly string[]): PlanLogsOptions | { error: string } {
  let format: 'table' | 'json' = 'table';
  let limit: number | undefined;
  let offset: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--json') format = 'json';
    else if (option === '--table') format = 'table';
    else if (option === '--limit' || option === '--offset') {
      const raw = argv[++index];
      const value = Number(raw);
      if (!raw || !Number.isSafeInteger(value) || value < (option === '--limit' ? 1 : 0) || (option === '--limit' && value > 100)) return { error: `${option} takes ${option === '--limit' ? 'a whole number from 1 to 100' : 'a non-negative whole number'}.` };
      if (option === '--limit') limit = value; else offset = value;
    } else return { error: `Unknown or incomplete logs option: ${option}` };
  }
  return { format, ...(limit === undefined ? {} : { limit }), ...(offset === undefined ? {} : { offset }) };
}

/**
 * A reveal takes no mode. Whether a plan is governed is a property of the plan, which the command
 * reads before it starts, so asking the operator to declare it only ever produced the wrong one.
 */
function parseRevealOptions(argv: readonly string[]): { fields?: string[]; clipboardTtlMs?: number } | { error: string } {
  const fields: string[] = [];
  let clipboardTtlMs: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--clipboard-ttl') {
      if (clipboardTtlMs !== undefined) return { error: '--clipboard-ttl may be given only once.' };
      clipboardTtlMs = durationMs(argv[++index] ?? '');
      if (clipboardTtlMs === undefined) return { error: '--clipboard-ttl expects a positive duration no greater than 2147483647ms.' };
      continue;
    }
    if (option === '--governed') return { error: GOVERNED_FLAG_REMOVED };
    if (option !== '--field' || !argv[index + 1]) return { error: 'Unknown or incomplete reveal option.' };
    const field = argv[++index]!;
    if (!isFieldSelector(field)) return { error: '--field expects asset.field.' };
    if (fields.includes(field)) return { error: '--field selectors must be unique.' };
    fields.push(field);
  }
  const parsed: { fields?: string[]; clipboardTtlMs?: number } = {};
  if (fields.length > 0) parsed.fields = fields;
  if (clipboardTtlMs !== undefined) parsed.clipboardTtlMs = clipboardTtlMs;
  return parsed;
}

function parseDownloadOptions(argv: readonly string[]): { asset: string; output: string } | { error: string } {
  let asset: string | undefined;
  let output: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    const value = argv[index + 1];
    if ((option !== '--asset' && option !== '--output') || !value || value.startsWith('--')) return { error: `Unknown or incomplete download option: ${option}` };
    if (option === '--asset') { if (asset) return { error: '--asset may be given only once.' }; asset = value; }
    else { if (output) return { error: '--output may be given only once.' }; output = value; }
    index += 1;
  }
  return asset && output ? { asset, output } : { error: 'plans download requires --asset and --output.' };
}

function parseUseOptions(argv: readonly string[], commandName = 'plans use'): Omit<import('./commands/use.js').UsePlanOptions, 'signal'> | { error: string } {
  const separator = argv.indexOf('--');
  if (separator < 0) return { error: 'Pass the executable after --.' };
  const command = argv.slice(separator + 1);
  if (command.length === 0) return { error: 'Pass an executable after --.' };
  let stdin: string | undefined;
  let ttlMs: number | undefined;
  let output: 'suppress' | 'inherit' = 'suppress';
  const envs: Array<{ name: string; selector: string }> = [];
  const tempFiles: Array<{ name: string; selector: string }> = [];
  const sockets: Array<{ name: string; selector: string }> = [];
  const fds: Array<{ fd: number; selector: string }> = [];
  for (let index = 0; index < separator; index += 1) {
    const option = argv[index];
    const value = argv[++index];
    if (!value) return { error: `Incomplete ${commandName} option: ${option}` };
    if (option === '--stdin') {
      if (stdin !== undefined) return { error: '--stdin may be mapped only once.' };
      stdin = value;
    } else if (option === '--env') {
      const match = /^([^=]+)=(.+)$/u.exec(value);
      if (!match) return { error: '--env expects NAME=asset.field.' };
      envs.push({ name: match[1]!, selector: match[2]! });
    } else if (option === '--temp-file') {
      const match = /^([^=]+)=(.+)$/u.exec(value);
      if (!match) return { error: '--temp-file expects NAME=asset.field.' };
      tempFiles.push({ name: match[1]!, selector: match[2]! });
    } else if (option === '--socket') {
      const match = /^([^=]+)=(.+)$/u.exec(value);
      if (!match) return { error: '--socket expects NAME=asset.field.' };
      sockets.push({ name: match[1]!, selector: match[2]! });
    } else if (option === '--fd') {
      const match = /^(\d+)=(.+)$/u.exec(value);
      if (!match) return { error: '--fd expects N=asset.field.' };
      fds.push({ fd: Number(match[1]), selector: match[2]! });
    } else if (option === '--ttl') {
      if (ttlMs !== undefined) return { error: '--ttl may be given only once.' };
      ttlMs = durationMs(value);
      if (ttlMs === undefined) return { error: '--ttl expects a positive duration no greater than 2147483647ms.' };
    } else if (option === '--output') {
      if (value !== 'suppress' && value !== 'inherit') return { error: '--output expects suppress or inherit.' };
      output = value;
    } else {
      return { error: `Unknown ${commandName} option: ${option}` };
    }
  }
  return {
    ...(stdin === undefined ? {} : { stdin }), envs, tempFiles, sockets, fds, command,
    ...(ttlMs === undefined ? {} : { ttlMs }), output,
  };
}

function parseResolveOptions(argv: readonly string[]): { field: string; allowPlaintextOutput: boolean } | { error: string } {
  let field: string | undefined;
  let allowed = false;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--allow-plaintext-output') {
      if (allowed) return { error: '--allow-plaintext-output may be given only once.' };
      allowed = true;
      continue;
    }
    if (option !== '--field' || !argv[index + 1]) return { error: 'Unknown or incomplete secrets resolve option.' };
    if (field !== undefined) return { error: '--field may be mapped only once.' };
    field = argv[++index];
    if (!isFieldSelector(field!)) return { error: '--field expects asset.field.' };
  }
  if (field === undefined) return { error: 'secrets resolve requires --field asset.field.' };
  if (!allowed) return { error: 'Plaintext output requires --allow-plaintext-output.' };
  return { field, allowPlaintextOutput: allowed };
}

function durationMs(value: string): number | undefined {
  const match = /^(\d+)(ms|s|m|h)$/u.exec(value);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const factor = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[match[2]!]!;
  const result = amount * factor;
  return Number.isSafeInteger(result) && result > 0 && result <= 2_147_483_647 ? result : undefined;
}

const GOVERNED_FLAG_REMOVED = 'Reveals no longer take --governed: the plan applies its own approval rules automatically.';

/** Operators see a mapped message; a stable code is kept for support without a stack trace. */
export function messageFor(error: unknown, business = false): string {
  if (error instanceof OrganizationChoiceRequired) return error.message;
  if (error instanceof CliConfigurationInvalid) return error.message;
  if (error instanceof UsePlanInvalid) return error.message;
  const networkCode = (error as { cause?: { code?: unknown } })?.cause?.code;
  if (networkCode === 'ECONNREFUSED' || networkCode === 'ENOTFOUND' || networkCode === 'ETIMEDOUT' || networkCode === 'UND_ERR_CONNECT_TIMEOUT') {
    return 'Cannot connect to the Inheriti API.';
  }
  const name = (error as { name?: unknown })?.name;
  if (name === 'MasterKeyRequired') {
    const system = (error as { ref?: { system?: unknown } }).ref?.system;
    return system === 'INHERITI_BUSINESS'
      ? 'The Organisation key is not available from SafeKey Mobile for this account.'
      : 'The Application key is not available from SafeKey Mobile for this account.';
  }
  const code = (error as { code?: unknown })?.code;
  if (business && code === 'plan_not_found') return 'No such plan in this Organisation.';
  if (business && code === 'action_not_allowed') return 'This Organisation is not allowed to open that. Check the integration capabilities and the asset type.';
  const deviceError = (error as { message?: unknown })?.message;
  if (typeof deviceError === 'string' && deviceError.startsWith('SAFEKEY_')) return MESSAGES[deviceError] ?? 'SafeKey PRO could not complete the operation.';
  if (code === 'governance_denied') return (error as Error).message;
  const reason = (error as { reason?: unknown })?.reason;
  if (code === 'plan_share_reconstruction_failed' && typeof reason === 'string') {
    return RECONSTRUCTION_MESSAGES[reason] ?? MESSAGES.plan_share_reconstruction_failed!;
  }
  if (typeof code === 'string') return MESSAGES[code] ?? code;
  return typeof name === 'string' && name !== 'Error' ? MESSAGES[name] ?? name : 'The command failed.';
}

const RECONSTRUCTION_MESSAGES: Readonly<Record<string, string>> = {
  insufficient_valid_data_shards: 'The reveal did not receive enough data shares for this plan.',
  insufficient_valid_key_shards: 'The reveal did not receive enough key shares for this plan.',
  mixed_share_sets: 'The released shares belong to different plan generations.',
  threshold_metadata_mismatch: 'The released shares do not match this plan\'s recovery threshold.',
  duplicate_data_shard: 'The reveal received the same data share more than once.',
  duplicate_key_shard: 'The reveal received the same key share more than once.',
  plan_binding_mismatch: 'A released share belongs to a different plan.',
  ciphertext_digest_mismatch: 'The released data shares could not recover the protected data.',
  v2_authentication_failed: 'The released key shares could not open the protected data.',
  shard_kind_mismatch: 'A released custodian share has the wrong type.',
  invalid_envelope_magic: 'A released share is not valid SSDP+ v2 material.',
  invalid_base64url: 'A released share has an invalid encoding.',
  envelope_truncated: 'A released share is incomplete.',
  crc32c_mismatch: 'A released share failed its integrity check.',
  insufficient_shards: 'The reveal did not receive enough data shares for this plan.',
  insufficient_key_shards: 'The reveal did not receive enough key shares for this plan.',
  conflicting_key_shards: 'The released key shares do not belong together.',
  duplicate_shard: 'The reveal received the same data share more than once.',
  invalid_shard_kind: 'A released share has the wrong type.',
  unsupported_envelope_version: 'A released share uses an unsupported SSDP+ version.',
  unsupported_v2_suite: 'A released share uses an unsupported SSDP+ suite.',
  ssdp_v2_worker_failed: 'The local SSDP+ reconstruction worker failed.',
  ssdp_v2_worker_not_configured: 'The local SSDP+ reconstruction worker is unavailable.',
  unexpected_ssdp_v2_worker_response: 'The local SSDP+ reconstruction worker returned an invalid response.',
};

const MESSAGES: Readonly<Record<string, string>> = {
  operator_not_signed_in: 'Not signed in. Run `inheriti login` first.',
  business_context_required: 'Set business: true in the CLI configuration to use organizations.',
  organization_preference_invalid: 'The saved organization preference is unreadable. Check organizations.json.',
  organization_command_invalid: 'Usage: inheriti organizations list | organizations use [id]',
  plan_id_required: 'Which plan? Pass a plan id, or run this in a terminal to pick one.',
  PlanIdRequired: 'Which plan? Pass a plan id, or run this in a terminal to pick one.',
  operator_reauthentication_required: 'The session expired. Run `inheriti login` again.',
  operator_session_changed: 'The signed-in session changed during this command. Retry with the current account.',
  plan_not_found: 'No such plan in this Application.',
  plan_request_rate_limited: 'Too many requests. Try again shortly.',
  elements_api_unavailable: 'The plan service is unavailable. Try again shortly.',
  plan_request_failed: 'Could not reach the plan service.',
  session_file_corrupt: 'The stored session was unreadable and has been cleared. Sign in again.',
  session_permissions_widened: 'The stored session was readable by others and has been cleared. Sign in again.',
  InteractiveTerminalRequired: 'Signing in needs an interactive terminal.',
  BrowserUnavailable: 'Could not open a browser. Sign in with `inheriti login --device`.',
  local_window_unavailable: 'Could not open the plan window. Check the CLI installation and try again.',
  local_plan_canceled: 'Plan creation canceled.',
  local_plan_expired: 'The plan window expired. Start again when ready.',
  login_could_not_open_a_browser: 'Could not open a browser. Sign in with `inheriti login --device`.',
  OperatorNotSignedIn: 'Not signed in. Run `inheriti login` first.',
  AbortError: 'Reveal canceled.',
  use_canceled: 'Secret delivery canceled.',
  reveal_cancellation_failed: 'The local reveal stopped, but server cancellation could not be confirmed. Run `inheriti plans abort PLAN_ID` with this plan ID before revealing again, or wait for the request to expire.',
  master_key_relay_cancellation_failed: 'Could not confirm cancellation in SafeKey Mobile. The release request may still be pending; wait for it to expire before trying again.',
  master_key_required: 'The plan key is not available from SafeKey Mobile for this account.',
  master_key_cache_clear_failed: 'Could not clear the cached plan keys. Unlock the OS credential store and retry.',
  MasterKeyRelayTimedOut: 'Nobody released the organisation key in SafeKey Mobile in time.',
  master_key_relay_timed_out: 'Nobody released the organisation key in SafeKey Mobile in time.',
  MasterKeyRelayExpired: 'The key release request expired before it was answered. Start the reveal again.',
  master_key_relay_expired: 'The key release request expired before it was answered. Start the reveal again.',
  master_key_relay_unavailable: 'No device holds the organisation key for this operator, so it cannot be released to this host.',
  reveal_stopped_by_dms: 'The dead man\'s switch subject stopped this reveal. Nothing was released.',
  reveal_authorization_ended: 'This reveal ended before it was authorized. Nothing was released.',
  reveal_expired: 'This reveal expired. Start it again.',
  reveal_denied: 'A participant denied this reveal. Nothing was released.',
  reveal_participant_revoked: 'A participant on this plan was revoked, so it cannot be opened.',
  reveal_reconciliation_required: 'This plan is being reconciled with its source. Try again shortly.',
  reveal_restart_required: 'An earlier reveal of this plan cannot continue. Run `inheriti plans abort PLAN_ID` with this plan ID, then retry your reveal command.',
  custodian_share_timed_out: 'Nobody approved the custodian request on SafeKey Mobile in time.',
  custodian_share_unavailable: 'The custodian share is unavailable or does not match this plan and device.',
  safekey_pro_local_device_required: 'This plan uses SafeKey PRO. Open it locally with a connected SafeKey PRO device; this runner cannot release that share.',
  SAFEKEY_INTERACTIVE_REQUIRED: 'SafeKey PRO needs an interactive terminal to enter its PIN.',
  SAFEKEY_ABORTED: 'SafeKey PRO operation canceled.',
  SAFEKEY_TIMEOUT: 'SafeKey PRO did not respond in time. Try again.',
  SAFEKEY_TOUCH_REQUIRED: 'SafeKey PRO did not confirm the touch. Try again.',
  SAFEKEY_INVALID_PIN: 'SafeKey PRO rejected the PIN.',
  SAFEKEY_NOT_FOUND: 'The plan share was not found on this SafeKey PRO.',
  SAFEKEY_SHARE_MISMATCH: 'This SafeKey PRO share does not belong to the requested plan.',
  SAFEKEY_DEVICE_FAILED: 'Could not communicate with SafeKey PRO. Check the device and try again.',
  plan_key_unwrap_failed: 'The Organisation key released by SafeKey Mobile could not open this plan.',
  plan_share_decryption_failed: 'One of the released plan shares could not be decrypted.',
  plan_share_reconstruction_failed: 'The released shares could not reconstruct this plan.',
  plan_reconstruction_failed: 'The plan could not be reconstructed from the released shares.',
  plaintext_acknowledgment_required: 'Plaintext output requires --allow-plaintext-output.',
  plaintext_terminal_rejected: 'Plaintext output requires non-terminal stdout.',
  clipboard_ttl_invalid: 'Invalid clipboard duration.',
  clipboard_unavailable: 'The reveal succeeded, but this terminal could not access the desktop clipboard. Nothing was printed.',
  asset_selector_invalid: 'Use an asset code or ID followed by a field name, for example prod-db.password.',
  asset_not_found: 'The requested asset is not in this plan. List the plan assets and check its code or ID.',
  asset_field_not_found: 'The requested field is not declared for this asset. List the available fields and choose one of them.',
  asset_value_invalid: 'The protected asset could not be decoded or is missing required data. Check the asset in the application where it was created before retrying.',
  asset_decoder_required: 'This integration cannot decode the protected asset. Update the CLI and try again.',
  EEXIST: 'The output file already exists. Choose a new path; downloads never overwrite files.',
  ENOENT: 'The output directory does not exist.',
  EACCES: 'The output file cannot be created at that path.',
  child_process_start_failed: 'The approved executable could not be started. No secret was printed.',
  child_command_failed: 'The executable exited unsuccessfully. No secret was printed by Inheriti.',
  child_command_signaled: 'The executable was terminated by a signal. No secret was printed by Inheriti.',
  secret_delivery_failed: 'The secret could not be delivered to the approved process.',
  secret_delivery_incomplete: 'The approved process exited before receiving every mapped secret.',
  use_ttl_expired: 'The approved use lifetime expired. The child process was stopped and the reveal was closed.',
  action_not_allowed: 'This Application is not allowed to open that. Check the registration\'s capabilities and the asset type.',
  operator_scope_denied: 'This login is missing a scope this command needs. Sign in again.',
  credential_scope_denied: 'This login is missing a scope this command needs. Sign in again.',
  step_up_approval_required: 'This needs a step-up approval before it can continue.',
  ElementsApiRequestFailed: 'The plan service refused the request without a reason. Try again, or check the API log.',
};

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
