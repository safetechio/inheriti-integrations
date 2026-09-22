import { revealModeOf, revealProgressMessage } from '@safetech/inheriti-elements-core';
import type { RevealProgress } from '@safetech/inheriti-elements-core';
import clipboard from 'clipboardy';
import type { CliContext } from '../session.js';
import type { Terminal } from '../output.js';
import { OperatorNotSignedIn } from './plans.js';
import { promptMultiSelect } from '../render/select.jsx';
import { createRevealPresenter } from '../render/reveal.jsx';

export interface RevealCommandOptions {
  field?: string;
  fields?: readonly string[];
  signal?: AbortSignal;
}

export async function resolvePlanField(
  context: CliContext,
  terminal: Terminal,
  planId: string,
  selector: string,
): Promise<number> {
  const plan = await loadRevealPlan(context, planId);
  await consumePlanFields(context, terminal, planId, plan, [selector], undefined, async (fields) => {
    terminal.write(renderRequestedValue(fields[0]?.value));
  }, { quiet: true });
  return 0;
}

export interface CliRevealPlan {
  assets: ReadonlyArray<{ id: string; code?: string; name?: string; fieldNames?: readonly string[] }>;
  governance?: { mode?: string | { kind: 'UNKNOWN'; raw: string } };
  participants?: ReadonlyArray<{
    id?: string;
    displayName: string;
    lifecycle: string | { kind: 'UNKNOWN'; raw: string };
    relationships: ReadonlyArray<string | { kind: 'UNKNOWN'; raw: string }>;
  }>;
}

/** The reveal ended because the dead-man's-switch subject answered, not because anything failed. */
export class RevealStoppedByDeadManSwitch extends Error {
  public readonly code = 'reveal_stopped_by_dms';
  public constructor(options?: { cause?: unknown }) {
    super('reveal_stopped_by_dms', options);
    this.name = 'RevealStoppedByDeadManSwitch';
  }
}

export async function revealPlan(
  context: CliContext,
  terminal: Terminal,
  planId: string,
  options: RevealCommandOptions,
): Promise<number> {
  const plan = await loadRevealPlan(context, planId);

  const selectors = plan.assets.flatMap((asset) => (asset.fieldNames ?? []).map((field) => ({
    value: `${asset.code ?? asset.id}.${field}`,
    ...(asset.name === undefined ? {} : { description: asset.name }),
  })));
  // Naming a field is the whole point of a reveal, so an operator who did not name one is asked
  // rather than refused. A pipe keeps the old behaviour: print what exists and change nothing.
  let fields = options.fields ?? (options.field ? [options.field] : undefined);
  if (!fields) {
    if (selectors.length === 0) {
      terminal.write('This plan has no text fields available to reveal.');
      return 0;
    }
    if (!terminal.interactive) {
      terminal.write(`Available fields:\n${selectors.map((one) => `  ${one.value}`).join('\n')}`);
      return 0;
    }
    fields = await promptMultiSelect('Which fields?', selectors);
    if (!fields?.length) {
      terminal.write('Reveal canceled.');
      return 0;
    }
  }
  const selectedFields = [...new Set(fields)];

  const copiedMessage = selectedFields.length === 1
    ? `Copied ${selectedFields[0]} to the clipboard.`
    : `Copied ${selectedFields.length} fields to the clipboard.`;
  await consumePlanFields(context, terminal, planId, plan, selectedFields, options.signal, async (copied) => {
    try {
      await clipboard.write(copied.length === 1
        ? renderRequestedValue(copied[0]!.value)
        : copied.map(({ selector, value }) => `${selector}: ${renderRequestedValue(value)}`).join('\n'));
    } catch (cause) {
      throw Object.assign(new Error('clipboard_unavailable', { cause }), { code: 'clipboard_unavailable' });
    }
  }, { completion: copiedMessage });
  return 0;
}

export async function loadRevealPlan(context: CliContext, planId: string): Promise<CliRevealPlan> {
  if (!(await context.core.getAccessToken())) throw new OperatorNotSignedIn();
  return await context.core.getPlan(planId) as CliRevealPlan;
}

/** One CLI reveal lifecycle. Destinations vary; governance, reconstruction and auditing never do. */
export async function consumePlanFields(
  context: CliContext,
  terminal: Terminal,
  planId: string,
  plan: CliRevealPlan,
  fields: ReadonlyArray<string | {
    selector: string;
    action: 'COPY_FIELD' | 'USE_FIELD';
    destination?: 'STDIN' | 'ENVIRONMENT' | 'FILE_DESCRIPTOR' | 'LOCAL_SOCKET' | 'TEMPORARY_FILE';
  }>,
  signal: AbortSignal | undefined,
  destination: (fields: ReadonlyArray<{ selector: string; value: unknown }>) => void | Promise<void>,
  options: { quiet?: boolean; completion?: string } = {},
): Promise<boolean> {
  let lastLine: string | undefined;
  let lastProgress: RevealProgress | undefined;
  let custodianShareDistributed = false;
  const moderators = (plan.participants ?? [])
    .filter((participant) => participant.lifecycle === 'ACTIVE' && participant.relationships.includes('MODERATOR'))
  const moderatorNames = moderators.map((participant) => participant.displayName);
  const moderatorNamesById = new Map(moderators
    .filter((participant): participant is typeof participant & { id: string } => participant.id !== undefined)
    .map((participant) => [participant.id, participant.displayName]));
  const keyOwner = context.keyOwner ?? 'Application';
  const presenter = options.quiet ? undefined : createRevealPresenter(terminal, moderatorNamesById, keyOwner);
  if (!presenter && !options.quiet) terminal.write('Opening the plan.');
  try {
    await context.core.withReveal(planId, {
      mode: revealModeOf(plan),
      ...(signal === undefined ? {} : { signal }),
      onProgress: (progress) => {
        // The SDK reports this only after its distribution call succeeds. Present it after delivery.
        if ((progress.phase as string) === 'CUSTODIAN_SHARE_DISTRIBUTED') {
          custodianShareDistributed = true;
          return;
        }
        lastProgress = progress;
        presenter?.progress(progress);
        // The command's own error path words a DMS stop, so printing it here would say it twice.
        if (progress.phase === 'STOPPED_BY_DMS') return;
        if (options.quiet) return;
        const line = revealProgressMessage(progress, { moderators: moderatorNames, moderatorNamesById, keyOwner });
        if (line === lastLine) return;
        lastLine = line;
        if (!presenter) terminal.write(line);
      },
    }, async (reveal) => {
      await reveal.consumeFields(
        fields.map((field) => typeof field === 'string'
          ? { selector: field, options: { action: 'COPY_FIELD' as const } }
          : { selector: field.selector, options: {
            action: field.action,
            ...(field.destination === undefined ? {} : { destination: field.destination }),
          } }),
        destination,
      );
    });
    const completion = options.completion ?? 'Secret delivered securely';
    const notice = 'The plan\'s custodian share was sent to SafeKey Mobile. Future accesses will require you to release it there.';
    presenter?.complete(custodianShareDistributed ? `${completion}\n${notice}` : completion);
    if (!presenter && options.completion) terminal.write(options.completion);
    if (!presenter && !options.quiet && custodianShareDistributed) terminal.write(notice);
    return presenter !== undefined;
  } catch (error) {
    // The last server-owned state explains this better than the transport error does, and the
    // generic mapper would otherwise report a healthy stop as an unexplained failure.
    if (lastProgress?.phase === 'STOPPED_BY_DMS') throw new RevealStoppedByDeadManSwitch({ cause: error });
    if (lastProgress?.phase === 'DENIED') {
      throw Object.assign(new Error(revealProgressMessage(lastProgress, { moderatorNamesById })), { code: 'governance_denied' });
    }
    throw error;
  } finally {
    presenter?.close();
  }
}

export function renderRequestedValue(value: unknown): string {
  if (typeof value === 'string') return value;
  const encoded = JSON.stringify(value);
  return encoded === undefined ? String(value) : encoded;
}
