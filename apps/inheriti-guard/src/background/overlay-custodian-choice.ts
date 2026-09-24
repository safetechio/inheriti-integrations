import type { AccessBatch } from '../shared/access-contract.js';
import { preflightPageTarget } from './page-fill.js';
import { revalidatePageTarget } from './page-target.js';

async function stillOnPage(batch: AccessBatch): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(batch.identity.tabId);
    if (tab.windowId === undefined || batch.identity.frameId === 0
      && new URL(tab.url ?? '').origin !== batch.identity.origin) return false;
    const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    if (active?.id !== batch.identity.tabId) return false;
    for (const { pageTarget } of batch.mappings) {
      if (!await preflightPageTarget(pageTarget, revalidatePageTarget)) return false;
    }
    return true;
  } catch { return false; }
}

export async function chooseCustodianInOverlay(batch: AccessBatch, signal: AbortSignal): Promise<'SK_MOBILE' | 'SK_PRO'> {
  if (signal.aborted) throw new Error('SAFEKEY_ABORTED');
  if (!await stillOnPage(batch)) throw new Error('SAFEKEY_ABORTED');
  if (signal.aborted) throw new Error('SAFEKEY_ABORTED');
  const response = await new Promise<unknown>((resolve, reject) => {
    const onAbort = () => reject(new Error('SAFEKEY_ABORTED'));
    signal.addEventListener('abort', onAbort, { once: true });
    void chrome.tabs.sendMessage(batch.identity.tabId,
      { type: 'inheriti-overlay-choose-custodian', identity: batch.identity },
      { frameId: batch.identity.frameId })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort));
  });
  if (signal.aborted || response !== 'SK_MOBILE' && response !== 'SK_PRO'
    || !await stillOnPage(batch)) throw new Error('SAFEKEY_ABORTED');
  return response;
}

export async function choosePreparedCustodianInOverlay(batch: AccessBatch, signal: AbortSignal,
  preparePro: (signal: AbortSignal) => Promise<void>): Promise<'SK_MOBILE' | 'SK_PRO'> {
  for (;;) {
    const selected = await chooseCustodianInOverlay(batch, signal);
    if (selected === 'SK_MOBILE') return selected;
    try { await preparePro(signal); return selected; }
    catch (error) { if ((error as Error).message !== 'SAFEKEY_PANEL_CLOSED') throw error; }
  }
}
