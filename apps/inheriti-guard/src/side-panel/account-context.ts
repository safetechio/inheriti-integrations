import type { SidePanelResponse } from '../shared/messages.js';
import type { PanelState } from '../shared/plan-view.js';

const wait = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

export async function confirmedPanelState(
  load: () => Promise<SidePanelResponse>,
  isCurrent: () => boolean,
  pause: (ms: number) => Promise<void> = wait,
): Promise<PanelState | undefined> {
  while (isCurrent()) {
    const response = await load().catch(() => undefined);
    if (!isCurrent()) return undefined;
    if (response?.ok && 'state' in response) return response.state;
    if (!response?.ok && response?.error === 'operation-busy') {
      await pause(250);
      continue;
    }
    return { kind: 'ERROR', code: 'plan_request_failed' };
  }
  return undefined;
}

export async function startAccountAddition(
  discardWorkspace: () => Promise<void>,
  isCurrent: () => boolean,
  signIn: () => Promise<void>,
  recover: () => Promise<void>,
): Promise<void> {
  try {
    await discardWorkspace();
  } catch {
    if (isCurrent()) await recover();
    return;
  }
  // Never start OAuth while the old page picker or workspace is still active.
  if (isCurrent()) await signIn();
}
