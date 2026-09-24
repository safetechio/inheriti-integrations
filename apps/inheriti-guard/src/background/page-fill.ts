/**
 * Executes only after an extension-panel click. It writes one value and returns no page data.
 * The page cannot invoke this function because there is no persistent content script or page listener.
 */
export function fillPageField(fieldName: string, value: string): void {
  const selectors = fieldName === 'password'
    ? ['input[type="password"]']
    : fieldName === 'email'
      ? ['input[type="email"]', 'input[autocomplete="email"]', 'input[name="email"]']
      : ['input[autocomplete="username"]', 'input[name="username"]', 'input[type="text"]'];
  const element = selectors
    .map((selector) => document.querySelector<HTMLInputElement>(selector))
    .find((candidate) => candidate !== null);
  if (element === undefined || element === null) throw new Error('page_field_not_found');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('page_field_not_writable');
  setter.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

export type PageTargetWriteResult = 'filled' | 'stale-page-context' | 'field-unavailable' | 'invalid-value';

/** Worker-side executor for an injected, metadata-only target check. */
export async function preflightPageTarget(input: {
  tabId: number;
  frameId: number;
  targetId: string;
  origin: string;
  navigationId: string;
}, revalidate: (targetId: string, expectedOrigin: string, expectedNavigationId: string) => boolean): Promise<boolean> {
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: input.tabId, frameIds: [input.frameId] },
    func: revalidate,
    args: [input.targetId, input.origin, input.navigationId],
  });
  return injection?.result === true;
}

/** Worker-side write-only delivery. The injected function returns a stable code, never page data. */
export async function fillPageTarget(input: {
  tabId: number;
  frameId: number;
  targetId: string;
  origin: string;
  navigationId: string;
}, value: string, write: (
  targetId: string,
  expectedOrigin: string,
  expectedNavigationId: string,
  value: string,
) => PageTargetWriteResult, isAuthorized: () => Promise<boolean> = async () => true): Promise<PageTargetWriteResult> {
  const tab = await chrome.tabs.get(input.tabId);
  const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  if (active?.id !== input.tabId || !tab.url || new URL(tab.url).origin !== input.origin
    || !await isAuthorized()) return 'stale-page-context';
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: input.tabId, frameIds: [input.frameId] },
    func: write,
    args: [input.targetId, input.origin, input.navigationId, value],
  });
  if (injection?.result === undefined) throw new Error('destination_failed');
  return injection.result;
}
