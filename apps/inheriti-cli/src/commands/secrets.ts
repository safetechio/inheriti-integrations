import { registerCliCancel } from '../cancellation.js';
import { resolvePlanField } from './reveal.js';
import { usePlan } from './use.js';
import { parseResolveOptions, parseUseOptions } from './arguments.js';
import type { SecretRevealContext } from '../session.js';
import type { Terminal } from '../output.js';

export async function secrets(
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
    try {
      return await usePlan(context, terminal, resolved, { ...parsed, signal: controller.signal, workload });
    } finally {
      unregister();
    }
  }
  if (subcommand === 'resolve') {
    const parsed = parseResolveOptions(hasPlanId ? rest.slice(1) : rest);
    if ('error' in parsed) { terminal.writeError(parsed.error); return 1; }
    const resolved = await resolveId(planId);
    const controller = new AbortController();
    const unregister = registerCliCancel(controller);
    try {
      return await resolvePlanField(context, terminal, resolved, parsed.field, {
        allowPlaintextOutput: parsed.allowPlaintextOutput, signal: controller.signal,
      });
    } finally {
      unregister();
    }
  }
  terminal.writeError('Usage: inheriti secrets exec <id> [--env NAME=asset.field ...] -- command | inheriti secrets ' +
    'resolve <id> --field asset.field --allow-plaintext-output');
  return 1;
}

export function requiredAutomationPlanId(planId: string | undefined): string {
  if (!planId) throw new Error('automation_plan_id_required');
  return planId;
}
