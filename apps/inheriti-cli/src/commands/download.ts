import { open, unlink } from 'node:fs/promises';
import { revealModeOf, revealProgressMessage } from '@safetech/inheriti-elements-core';
import type { CliContext } from '../session.js';
import type { Terminal } from '../output.js';
import { loadRevealPlan, RevealStoppedByDeadManSwitch } from './reveal.js';

export async function downloadPlanAsset(
  context: CliContext, terminal: Terminal, planId: string, asset: string, output: string, signal?: AbortSignal,
): Promise<number> {
  const plan = await loadRevealPlan(context, planId);
  const moderators = (plan.participants ?? [])
    .filter(participant => participant.lifecycle === 'ACTIVE' && participant.relationships.includes('MODERATOR'));
  const moderatorNamesById = new Map(moderators
    .filter((participant): participant is typeof participant & { id: string } => participant.id !== undefined)
    .map(participant => [participant.id, participant.displayName]));
  let stoppedByDms = false;
  let deniedMessage: string | undefined;
  let lastLine: string | undefined;
  try {
    await context.core.withReveal(planId, {
      mode: revealModeOf(plan),
      ...(signal === undefined ? {} : { signal }),
      onProgress: (progress) => {
        if (progress.phase === 'STOPPED_BY_DMS') { stoppedByDms = true; return; }
        const line = revealProgressMessage(progress, { keyOwner: context.keyOwner ?? 'Application',
          moderators: moderators.map(participant => participant.displayName), moderatorNamesById });
        if (progress.phase === 'DENIED') deniedMessage = line;
        if (line !== lastLine) { terminal.write(line); lastLine = line; }
      },
    }, async (reveal) => {
      await reveal.exportAsset(asset, async ({ bytes }) => {
        if (signal?.aborted) throw abortError();
        const file = await open(output, 'wx', 0o600);
        let saved = false;
        try {
          await file.writeFile(bytes);
          if (signal?.aborted) throw abortError();
          saved = true;
        } finally {
          await file.close();
          if (!saved) await unlink(output);
        }
      });
    });
  } catch (error) {
    if (stoppedByDms) throw new RevealStoppedByDeadManSwitch({ cause: error });
    if (deniedMessage) throw Object.assign(new Error(deniedMessage), { code: 'governance_denied' });
    throw error;
  }
  terminal.write(`Saved ${asset} to ${output}.`);
  return 0;
}

function abortError(): Error { return Object.assign(new Error('download_canceled'), { name: 'AbortError' }); }
