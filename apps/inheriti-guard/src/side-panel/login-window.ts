/** Keep Chrome's OAuth popup usable while the panel waits for the sign-in response. */
export async function watchLoginWindow(): Promise<() => void> {
  const existing = new Set((await chrome.windows.getAll().catch(() => [])).map((window) => window.id));
  const redirect = chrome.identity.getRedirectURL('integrations-oauth');
  let windowId: number | undefined;
  let stopped = false;
  let checking = false;
  const belongsToGuard = (url?: string): boolean => {
    if (!url) return false;
    try { return new URL(url).searchParams.get('redirect_uri') === redirect; }
    catch { return false; }
  };
  const onUpdated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (_tabId, change, tab) => {
    if (belongsToGuard(change.url ?? tab.url ?? tab.pendingUrl)) windowId = tab.windowId;
  };
  chrome.tabs.onUpdated.addListener(onUpdated);
  const check = async (): Promise<void> => {
    if (stopped || checking) return;
    checking = true;
    try {
      const windows = await chrome.windows.getAll({ populate: true });
      const login = windows.find((window) => window.id === windowId)
        ?? windows.find((window) => window.id !== undefined && !existing.has(window.id) && window.type === 'popup'
          && window.tabs?.some((tab) => belongsToGuard(tab.url ?? tab.pendingUrl)));
      if (login?.id !== undefined) windowId = login.id;
      if (!stopped && login?.type === 'popup' && login.id !== undefined
        && ((login.width ?? 0) < 960 || (login.height ?? 0) < 760)) {
        await chrome.windows.update(login.id, { width: 960, height: 760 });
      }
    } catch { /* Chrome owns the popup; sign-in must still work if resizing is unavailable. */ }
    finally { checking = false; }
  };
  const timer = setInterval(() => { void check(); }, 250);
  void check();
  return () => { stopped = true; clearInterval(timer); chrome.tabs.onUpdated.removeListener(onUpdated); };
}
