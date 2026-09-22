import type { CliContext } from '../session.js';
import type { Terminal } from '../output.js';
import { COMPLETION_SHELLS, completionScript, type CompletionShell } from '../completion/shell.js';
import { cached, completionCachePath } from '../completion/cache.js';
import { fieldCandidates, planCandidates, type Candidate } from '../completion/candidates.js';

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
  const [command, subcommand, ...rest] = words;
  if (command === 'secrets') {
    if (subcommand !== 'exec' && subcommand !== 'resolve') return [];
  } else {
    if (command !== 'plans') return [];
    if (subcommand !== 'show' && subcommand !== 'reveal' && subcommand !== 'abort') return [];
  }
  if (!(await context.core.getAccessToken())) return [];

  const path = completionCachePath(environmentVariables);
  const principal = context.organization ? (await context.sessions.load())?.principal : undefined;
  const scope = context.organization
    ? JSON.stringify([principal?.issuer, principal?.environment, principal?.subject, context.organization.id])
    : 'application';
  const planId = rest.find((word) => !word.startsWith('-'));
  const completingField = rest.at(-2) === '--field';
  if (completingField) {
    if (!planId) return [];
    return await cached(path, `fields:${scope}:${planId}`, () => fieldCandidates(context, planId));
  }
  // A plan id is still being typed as long as none is complete on the line.
  if (planId && planId !== words.at(-1)) return [];
  return await cached(path, `plans:${scope}`, () => planCandidates(context));
}
