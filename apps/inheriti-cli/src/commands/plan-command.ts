import { createCliContext } from '../session.js';
import { registerCliCancel } from '../cancellation.js';
import type { CliConfiguration } from '../configuration.js';
import type { Terminal } from '../output.js';
import { createPlan } from './create-plan.js';
import { abortPlanAccess, listPlanLogs, listPlans, resolvePlanId, showPlan } from './plans.js';
import { revealPlan } from './reveal.js';
import { downloadPlanAsset } from './download.js';
import { usePlan } from './use.js';
import { parseFormat, parseListOptions, parseLogOptions, parseRevealOptions, parseDownloadOptions, parseUseOptions } from './arguments.js';
import { parsePlanHints } from './arguments.js';
import { PROTECTED_FILE_FLAGS } from '@safetech/inheriti-elements-core/node-base';
import { CLI_FEATURE_FLAGS } from '../feature-flags.js';

export async function plans(
  context: Awaited<ReturnType<typeof createCliContext>>,
  terminal: Terminal,
  argv: readonly string[],
  configuration?: CliConfiguration,
): Promise<number> {
  const [subcommand, ...rest] = argv;
  if (subcommand === 'create') {
    if (!configuration?.deployment || !CLI_FEATURE_FLAGS[configuration.deployment].planCreation) {
      terminal.writeError('Plan creation is unavailable.'); return 1;
    }
    const hints = parsePlanHints(rest);
    if (!hints) { terminal.writeError('Usage: inheriti plans create [--title NAME] [--description TEXT] [--asset TYPE ...]'); return 1; }
    const controller = new AbortController();
    const unregister = registerCliCancel(controller);
    try {
      const fontFile = new URL(
        import.meta.url.endsWith('/main.js') ? './assets/font-app.ttf' : '../assets/font-app.ttf',
        import.meta.url,
      );
      return await createPlan(context, configuration, terminal, controller.signal, fontFile, hints);
    } finally {
      unregister();
    }
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
    const hasPlanId = planId !== undefined && !planId.startsWith('--');
    const format = parseFormat(hasPlanId ? options : rest);
    if ('error' in format) {
      terminal.writeError(format.error);
      return 1;
    }
    return await showPlan(context, terminal, await resolvePlanId(context, terminal, hasPlanId ? planId : undefined), format);
  }
  if (subcommand === 'abort') {
    const hasPlanId = planId !== undefined && !planId.startsWith('--');
    const abortOptions = hasPlanId ? options : rest;
    if (abortOptions.length > 0) {
      terminal.writeError(`Unknown or incomplete abort option: ${abortOptions[0]}`);
      return 1;
    }
    return await abortPlanAccess(context, terminal, await resolvePlanId(context, terminal, hasPlanId ? planId : undefined));
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
    const protectedCopy = configuration?.business === true && configuration.deployment !== undefined
      && PROTECTED_FILE_FLAGS[configuration.deployment];
    const parsed = parseDownloadOptions(hasPlanId ? options : rest, protectedCopy);
    if ('error' in parsed) { terminal.writeError(parsed.error); return 1; }
    const resolved = await resolvePlanId(context, terminal, hasPlanId ? planId : undefined);
    const controller = new AbortController();
    const unregister = registerCliCancel(controller);
    try { return await downloadPlanAsset(context, terminal, resolved, parsed.asset, parsed.output, controller.signal,
      protectedCopy, parsed.openLimit); }
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
  terminal.writeError('Usage: plans list | plans show <id> | plans logs <id> | plans reveal <id> [--field asset.field ' +
    '...] | plans download <id> --asset code --output path | plans use <id> [delivery] -- command | ' +
    'plans abort <id>');
  return 1;
}
