import { custodianShareCopy, revealModeOf, revealProgressMessage } from '@safetech/inheriti-elements-core';
import type { RevealProgress } from '@safetech/inheriti-elements-core';
import clipboard from 'clipboardy';
import type { CliContext } from '../session.js';
import { cliCustodianOptions } from '../session.js';
import type { Terminal } from '../output.js';
import { OperatorNotSignedIn } from './plans.js';
import { promptMultiSelect } from '../render/select.jsx';
import { createRevealPresenter } from '../render/reveal.jsx';

export interface RevealCommandOptions {
  field?: string;
  fields?: readonly string[];
  signal?: AbortSignal;
  clipboardTtlMs?: number;
}

export async function resolvePlanField(
  context: CliContext,
  terminal: Terminal,
  planId: string,
  selector: string,
  options: { allowPlaintextOutput: boolean; signal?: AbortSignal },
): Promise<number> {
  assertPlaintextDestination(terminal, options?.allowPlaintextOutput);
  if (!isFieldSelector(selector)) throw new Error('Invalid field selector.');
  const signal = options.signal;
  if (signal?.aborted) throw Object.assign(new Error('reveal_canceled'), { name: 'AbortError' });
  const plan = await loadRevealPlan(context, planId);
  await consumePlanFields(context, terminal, planId, plan, [selector], signal, async (fields) => {
    terminal.write(renderRequestedValue(fields[0]?.value));
  }, { quiet: true });
  return 0;
}

export function isFieldSelector(selector: string): boolean {
  const separator = selector.lastIndexOf('.');
  return !selector.startsWith('--') && separator > 0 && separator < selector.length - 1 && !/\s/u.test(selector);
}

export function assertPlaintextDestination(terminal: Terminal, allowed: boolean): void {
  if (allowed !== true) throw Object.assign(new Error('Plaintext output requires --allow-plaintext-output.'), { code: 'plaintext_acknowledgment_required' });
  if (terminal.stdoutIsTTY !== false) throw Object.assign(new Error('Plaintext output requires non-terminal stdout.'), { code: 'plaintext_terminal_rejected' });
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
  if (options.clipboardTtlMs !== undefined && (!Number.isSafeInteger(options.clipboardTtlMs) || options.clipboardTtlMs <= 0 || options.clipboardTtlMs > 2_147_483_647)) throw Object.assign(new Error('Invalid clipboard duration.'), { code: 'clipboard_ttl_invalid' });
  if (options.signal?.aborted) throw Object.assign(new Error('reveal_canceled'), { name: 'AbortError' });
  const plan = await loadRevealPlan(context, planId);
  if (options.signal?.aborted) throw Object.assign(new Error('reveal_canceled'), { name: 'AbortError' });

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
    fields = await promptMultiSelect('Which fields?', selectors, options.signal);
    if (options.signal?.aborted) throw Object.assign(new Error('reveal_canceled'), { name: 'AbortError' });
    if (!fields?.length) {
      terminal.write('Reveal canceled.');
      return 0;
    }
  }
  const selectedFields = [...new Set(fields)];

  const copiedMessage = selectedFields.length === 1
    ? `Copied ${selectedFields[0]} to the clipboard.`
    : `Copied ${selectedFields.length} fields to the clipboard.`;
  let cleanup: Promise<void> | undefined;
  try {
    await consumePlanFields(context, terminal, planId, plan, selectedFields, options.signal, async (copied) => {
      const content = copied.length === 1
        ? renderRequestedValue(copied[0]!.value)
        : copied.map(({ selector, value }) => `${selector}: ${renderRequestedValue(value)}`).join('\n');
      try {
        await clipboard.write(content);
      } catch (cause) {
        throw Object.assign(new Error('clipboard_unavailable', { cause }), { code: 'clipboard_unavailable' });
      }
      if (options.clipboardTtlMs !== undefined) cleanup = expireClipboard(content, options.clipboardTtlMs, terminal, options.signal);
    }, { completion: copiedMessage });
  } finally {
    await cleanup;
  }
  if (options.signal?.aborted) throw Object.assign(new Error('reveal_canceled'), { name: 'AbortError' });
  return 0;
}

async function expireClipboard(content: string, ttlMs: number, terminal: Terminal, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ttlMs);
    signal?.addEventListener('abort', finish, { once: true });
    if (signal?.aborted) finish();
  });
  try {
    if (await clipboard.read() !== content) {
      terminal.write('Clipboard changed; left untouched.');
      return;
    }
    await clipboard.write('');
    terminal.write(signal?.aborted ? 'Clipboard cleared after cancellation.' : 'Clipboard expired and cleared.');
  } catch {
    terminal.writeError('Clipboard cleanup failed.');
  }
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
  options: { quiet?: boolean; completion?: string; onSession?: (expiresAt: string | Date) => void } = {},
): Promise<boolean> {
  let lastLine: string | undefined;
  let lastProgress: RevealProgress | undefined;
  let custodianShareDistributed = false;
  let selectedPro = false;
  const custodianOptions = cliCustodianOptions(context, terminal, signal);
  const moderators = (plan.participants ?? [])
    .filter((participant) => participant.lifecycle === 'ACTIVE' && participant.relationships.includes('MODERATOR'))
  const moderatorNames = moderators.map((participant) => participant.displayName);
  const moderatorNamesById = new Map(moderators
    .filter((participant): participant is typeof participant & { id: string } => participant.id !== undefined)
    .map((participant) => [participant.id, participant.displayName]));
  const keyOwner = context.keyOwner ?? 'Application';
  let presenter = options.quiet ? undefined : createRevealPresenter(terminal, moderatorNamesById, keyOwner);
  const onAbort = () => {
    const message = lastProgress?.phase === 'WAITING_FOR_MASTER_KEY'
      ? 'Canceling the SafeKey Mobile request...'
      : 'Canceling the reveal...';
    if (presenter) {
      presenter.deviceStatus(message);
      return;
    }
    terminal.writeError(message);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  const pausePresenter = () => { context.safeKeyPro?.setStatusRenderer?.(); presenter?.close(true); presenter = undefined; };
  if (!presenter && !options.quiet) terminal.write('Opening the plan.');
  try {
    await context.core.withReveal(planId, {
      mode: revealModeOf(plan),
      ...custodianOptions,
      ...(custodianOptions.selectCustodianDevice ? { selectCustodianDevice: async () => {
        pausePresenter();
        const selected = await custodianOptions.selectCustodianDevice();
        selectedPro = selected === 'SK_PRO';
        if (!options.quiet) {
          presenter = createRevealPresenter(terminal, moderatorNamesById, keyOwner);
          if (lastProgress) presenter?.progress(lastProgress);
          if (selectedPro) context.safeKeyPro?.setStatusRenderer?.((message) => presenter?.deviceStatus(message));
        }
        return selected;
      } } : {}),
      ...(signal === undefined ? {} : { signal }),
      onProgress: (progress) => {
        if (progress.phase === 'CONNECTING_SAFEKEY_PRO') {
          selectedPro = true;
          if (presenter) context.safeKeyPro?.setStatusRenderer?.((message) => presenter?.deviceStatus(message));
        }
        // The SDK reports this only after its distribution call succeeds. Present it after delivery.
        if ((progress.phase as string) === 'CUSTODIAN_SHARE_DISTRIBUTED') {
          custodianShareDistributed = true;
          return;
        }
        lastProgress = progress;
        if (selectedPro && !presenter && !options.quiet
          && (progress.phase === 'RECONSTRUCTING' || progress.phase === 'OPEN')) {
          presenter = createRevealPresenter(terminal, moderatorNamesById, keyOwner);
        }
        presenter?.progress(progress);
        // The command's own error path words a DMS stop, so printing it here would say it twice.
        if (progress.phase === 'STOPPED_BY_DMS') return;
        if (options.quiet) return;
        if (selectedPro && (progress.phase === 'CONNECTING_SAFEKEY_PRO'
          || progress.phase === 'WAITING_FOR_CUSTODIAN_CLAIM' || progress.phase === 'WAITING_FOR_CUSTODIAN')) return;
        const line = selectedPro && progress.phase === 'WAITING_FOR_CUSTODIAN_CLAIM'
          ? custodianShareCopy.firstAccess.proStore
          : selectedPro && progress.phase === 'WAITING_FOR_CUSTODIAN'
            ? custodianShareCopy.laterAccess.proRead
            : revealProgressMessage(progress, { moderators: moderatorNames, moderatorNamesById, keyOwner });
        if (line === lastLine) return;
        lastLine = line;
        if (!presenter) terminal.write(line);
      },
    }, async (reveal) => {
      if (reveal.session?.expiresAt !== undefined) options.onSession?.(reveal.session.expiresAt);
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
    const notice = selectedPro
      ? 'The plan\'s custodian share was stored on SafeKey PRO. Future accesses require this device.'
      : 'The plan\'s custodian share was sent to SafeKey Mobile. Future accesses will require you to release it there.';
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
    signal?.removeEventListener('abort', onAbort);
    context.safeKeyPro?.setStatusRenderer?.();
    presenter?.close();
    if (context.keyVault?.unavailable) terminal.writeError('The OS credential store is unavailable. The plan key is cached only for this command; the next command will request it again.');
  }
}

export function renderRequestedValue(value: unknown): string {
  if (typeof value === 'string') return value;
  const encoded = JSON.stringify(value);
  return encoded === undefined ? String(value) : encoded;
}
