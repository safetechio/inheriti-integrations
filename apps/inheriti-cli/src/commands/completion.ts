import type { CliContext } from '../session.js';
import type { Terminal } from '../output.js';
import { COMPLETION_SHELLS, completionScript, type CompletionShell } from '../completion/shell.js';
import { cached, completionCachePath } from '../completion/cache.js';
import { assetCandidates, fieldCandidates, organizationCandidates, planCandidates, type Candidate } from '../completion/candidates.js';

const PLAN_ID_COMMANDS = new Set(['show', 'logs', 'reveal', 'download', 'use', 'abort']);
const candidates = (...values: readonly (readonly [string, string])[]): Candidate[] =>
  values.map(([value, description]) => ({ value, description }));

const ROOT = candidates(
  ['login', 'Sign in'], ['logout', 'Sign out'], ['organizations', 'Manage Business organizations'],
  ['plans', 'List and use plans'], ['secrets', 'Machine-oriented secret delivery'],
  ['completion', 'Print shell completion'], ['help', 'Show help'], ['--help', 'Show help'],
);
const PLANS = candidates(
  ['list', 'List plans'], ['show', 'Show plan details'], ['logs', 'Show plan activity'],
  ['reveal', 'Copy selected fields'], ['download', 'Download a media asset'],
  ['use', 'Run a command with secrets'], ['abort', 'Abandon current access'],
);
const SECRETS = candidates(['exec', 'Run a command with secrets'], ['resolve', 'Resolve one field']);
const ORGANIZATIONS = candidates(['list', 'List organizations'], ['use', 'Select an organization']);

type Completion =
  | { kind: 'static'; candidates: Candidate[] }
  | { kind: 'organizations' }
  | { kind: 'plans' }
  | { kind: 'fields'; planId: string; prefix?: string }
  | { kind: 'assets'; planId: string }
  | { kind: 'none' };

export function printCompletionScript(terminal: Terminal, shell: string | undefined): number {
  if (!shell || !(COMPLETION_SHELLS as readonly string[]).includes(shell)) {
    terminal.writeError(`Usage: inheriti completion <${COMPLETION_SHELLS.join('|')}>`);
    return 1;
  }
  terminal.write(completionScript(shell as CompletionShell));
  return 0;
}

/**
 * Answers one TAB.
 *
 * Every failure here is silent and successful: a completion handler that writes an error, or exits
 * non-zero, corrupts the line the operator is typing. Not signed in, API down, no such plan — all of
 * them mean "no candidates", which is what a shell does with an empty answer.
 */
export async function completeWords(
  context: CliContext,
  terminal: Terminal,
  words: readonly string[],
  environmentVariables: Readonly<Record<string, string | undefined>>,
): Promise<number> {
  try {
    for (const candidate of await candidatesFor(context, words, environmentVariables)) {
      terminal.write(`${candidate.value}\t${candidate.description ?? ''}`);
    }
  } catch {
    // A completion never explains itself.
  }
  return 0;
}

async function candidatesFor(
  context: CliContext,
  words: readonly string[],
  environmentVariables: Readonly<Record<string, string | undefined>>,
): Promise<Candidate[]> {
  const completion = completionFor(context, words);
  if (completion.kind === 'static') return completion.candidates;
  if (completion.kind === 'none') return [];
  if (!(await context.core.getAccessToken())) return [];

  const path = completionCachePath(environmentVariables);
  const principal = completion.kind === 'organizations' || context.organization
    ? (await context.sessions.load())?.principal
    : undefined;
  const principalScope = JSON.stringify([principal?.issuer, principal?.environment, principal?.subject]);
  if (completion.kind === 'organizations') {
    return await cached(path, `organizations:${principalScope}`, () => organizationCandidates(context));
  }
  const scope = context.organization ? `${principalScope}:${context.organization.id}` : 'application';
  if (completion.kind === 'plans') return await cached(path, `plans:${scope}`, () => planCandidates(context));
  if (completion.kind === 'assets') {
    return await cached(path, `assets:${scope}:${completion.planId}`, () => assetCandidates(context, completion.planId));
  }
  const fields = await cached(path, `fields:${scope}:${completion.planId}`, () => fieldCandidates(context, completion.planId));
  return completion.prefix === undefined
    ? fields
    : fields.map(({ value, description }) => ({
      value: `${completion.prefix}=${value}`,
      ...(description === undefined ? {} : { description }),
    }));
}

export function completionNeedsPlanContext(words: readonly string[]): boolean {
  const kind = completionFor(undefined, words).kind;
  return kind === 'plans' || kind === 'fields' || kind === 'assets';
}

function completionFor(context: Pick<CliContext, 'keyOwner'> | undefined, words: readonly string[]): Completion {
  const [command, subcommand, ...rest] = words;
  if (words.length <= 1) return { kind: 'static', candidates: ROOT };
  if (command === 'completion') return { kind: 'static', candidates: COMPLETION_SHELLS.map((value) => ({ value })) };
  if (command === 'organizations') {
    if (words.length === 2) return { kind: 'static', candidates: ORGANIZATIONS };
    return subcommand === 'use' && rest.length === 1 ? { kind: 'organizations' } : { kind: 'none' };
  }
  if (command === 'help') return helpCompletion(words.slice(1));
  if (command === 'login') return { kind: 'static', candidates: candidates(['--device', 'Use device login'], ['--help', 'Show help']) };
  if (command !== 'plans' && command !== 'secrets') return { kind: 'none' };
  if (words.length === 2) return { kind: 'static', candidates: command === 'plans' ? PLANS : SECRETS };
  if (!subcommand || (command === 'plans' ? !PLAN_ID_COMMANDS.has(subcommand) && subcommand !== 'list' : !['exec', 'resolve'].includes(subcommand))) {
    return { kind: 'none' };
  }
  if (rest.at(-2) === '--organization') return { kind: 'organizations' };
  const business = context?.keyOwner === 'Organisation';
  const planId = rest[0] && !rest[0].startsWith('-') ? rest[0] : undefined;
  if (subcommand === 'list') return { kind: 'static', candidates: optionCandidates(['--limit', '--all', '--cursor', '--json', '--table'], business) };
  if (rest.length === 1 && !rest[0]?.startsWith('-')) return { kind: 'plans' };
  const option = rest.at(-2);
  if (planId && (option === '--field' || option === '--stdin')) return { kind: 'fields', planId };
  if (planId && option === '--asset') return { kind: 'assets', planId };
  if (planId && ['--env', '--temp-file', '--socket', '--fd'].includes(option ?? '')) {
    const current = rest.at(-1) ?? '';
    const prefix = current.includes('=') ? current.slice(0, current.indexOf('=')) : current;
    return { kind: 'fields', planId, prefix };
  }
  if (option === '--output' && (subcommand === 'use' || (command === 'secrets' && subcommand === 'exec'))) {
    return { kind: 'static', candidates: candidates(['suppress', 'Suppress child output'], ['inherit', 'Inherit child output']) };
  }
  if (!planId && rest[0]?.startsWith('-')) return { kind: 'static', candidates: commandOptions(command, subcommand, business) };
  if (planId && rest.length > 1 && !rest.includes('--')) return { kind: 'static', candidates: commandOptions(command, subcommand, business) };
  return { kind: 'none' };
}

function commandOptions(command: string, subcommand: string, business: boolean): Candidate[] {
  if (subcommand === 'show') return optionCandidates(['--json', '--table'], business);
  if (subcommand === 'logs') return optionCandidates(['--limit', '--offset', '--json', '--table'], business);
  if (subcommand === 'reveal' || (command === 'secrets' && subcommand === 'resolve')) return optionCandidates(['--field'], business);
  if (subcommand === 'download') return optionCandidates(['--asset', '--output'], business);
  if (subcommand === 'abort') return optionCandidates([], business);
  const options = command === 'secrets' ? ['--env', '--output', '--'] : ['--stdin', '--env', '--fd', '--temp-file', '--socket', '--ttl', '--output', '--'];
  return optionCandidates(options, business);
}

function optionCandidates(options: readonly string[], business: boolean): Candidate[] {
  return [...options, ...(business ? ['--organization'] : []), '--help'].map((value) => ({ value }));
}

function helpCompletion(words: readonly string[]): Completion {
  if (words.length <= 1) return { kind: 'static', candidates: ROOT.filter(({ value }) => value !== '--help') };
  if (words[0] === 'plans' && words.length === 2) return { kind: 'static', candidates: PLANS };
  if (words[0] === 'secrets' && words.length === 2) return { kind: 'static', candidates: SECRETS };
  if (words[0] === 'organizations' && words.length === 2) return { kind: 'static', candidates: ORGANIZATIONS };
  return { kind: 'none' };
}
