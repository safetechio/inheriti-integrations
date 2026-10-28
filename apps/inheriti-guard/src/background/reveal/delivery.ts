import type { AccessBatch, AccessFieldResultCode } from '../../shared/access-contract.js';
import { fillPageField, fillPageTarget } from '../page-fill.js';
import { writePageTarget } from '../page-target.js';
import { originOf, stableError } from './presentation.js';

export async function deliverField(
  target: { tabId: number; origin: string }, fieldName: string, value: unknown, isCurrent: () => boolean,
): Promise<void> {
  if (!isCurrent()) throw stableError('access-request-failed');
  if (typeof value !== 'string') throw new Error('asset_value_invalid');
  const targetTab = await chrome.tabs.get(target.tabId);
  const [active] = await chrome.tabs.query({ active: true, windowId: targetTab.windowId });
  if (!isCurrent()) throw stableError('access-request-failed');
  if (active?.id !== target.tabId || originOf(active.url) !== target.origin) {
    throw Object.assign(new Error('stale_tab_context'), { code: 'stale_tab_context' });
  }
  // Recheck ownership immediately before plaintext crosses into the page.
  if (!isCurrent()) throw stableError('access-request-failed');
  await chrome.scripting.executeScript({ target: { tabId: target.tabId }, func: fillPageField, args: [fieldName, value] });
}

export async function deliverBatchFields(
  batch: AccessBatch,
  fields: readonly { selector: string; value: unknown }[],
  outcomes: Map<string, AccessFieldResultCode>,
  isCurrent: () => boolean,
  isAuthorized: () => boolean | Promise<boolean>,
): Promise<void> {
  const valuesBySelector = new Map(fields.map((field) => [field.selector, field.value]));
  let contextStale = false;
  for (const mapping of batch.mappings) {
    if (!isCurrent()) {
      outcomes.set(mapping.protectedField.selector, 'canceled');
      continue;
    }
    if (contextStale) {
      outcomes.set(mapping.protectedField.selector, 'not-attempted');
      continue;
    }
    const value = valuesBySelector.get(mapping.protectedField.selector);
    if (typeof value !== 'string') {
      outcomes.set(mapping.protectedField.selector, 'invalid-value');
      continue;
    }
    try {
      if (!isCurrent()) {
        outcomes.set(mapping.protectedField.selector, 'canceled');
        continue;
      }
      const result = await fillPageTarget(mapping.pageTarget, value, writePageTarget,
        async () => isCurrent() && await isAuthorized() && isCurrent());
      outcomes.set(mapping.protectedField.selector, result);
      contextStale = result === 'page-address-changed' || result === 'form-changed' || result === 'tab-inactive';
    } catch {
      outcomes.set(mapping.protectedField.selector, 'destination-failed');
    }
  }
  // The SDK accepts the batch as one delivery; any failed page write must fail that delivery.
  if ([...outcomes.values()].some((code) => code !== 'filled')) throw stableError('access-request-failed');
}
