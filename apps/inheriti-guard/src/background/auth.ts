import type { OperatorAuthFacade } from '@safetech/inheriti-elements-core';

export class LoginCancelled extends Error {
  public readonly code = 'login_cancelled';
  public constructor() { super('login_cancelled'); this.name = 'LoginCancelled'; }
}

/** The extension's own redirect, which Chrome alone can mint and the issuer has registered. */
export function redirectUri(): string {
  return chrome.identity.getRedirectURL('integrations-oauth');
}

/**
 * PKCE through `chrome.identity.launchWebAuthFlow`, which opens a real browser window Chrome owns.
 * The extension never sees the operator's credentials, and `getAuthToken` — which would tie this to a
 * Google account — is deliberately not used.
 */
function throwIfCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new LoginCancelled();
}

export async function signIn(auth: OperatorAuthFacade, signal?: AbortSignal): Promise<void> {
  throwIfCanceled(signal);
  const { authorizationUrl } = await auth.beginAuthorizationCode();
  throwIfCanceled(signal);
  const existingWindows = new Set((await chrome.windows.getAll().catch(() => [])).map((window) => window.id));
  const issuerOrigin = new URL(authorizationUrl).origin;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let attempts = 0;
  const enlarge = async (windowId: number): Promise<void> => {
    const window = await chrome.windows.get(windowId);
    if (window.type === 'popup' && ((window.width ?? 0) < 960 || (window.height ?? 0) < 760)) {
      await chrome.windows.update(windowId, { width: 960, height: 760 });
    }
  };
  const onUpdated: Parameters<typeof chrome.tabs.onUpdated.addListener>[0] = (_tabId, change, tab) => {
    const url = change.url ?? tab.url;
    if (!stopped && !existingWindows.has(tab.windowId) && url?.startsWith(`${issuerOrigin}/`)) {
      void enlarge(tab.windowId).catch(() => undefined);
    }
  };
  chrome.tabs.onUpdated.addListener(onUpdated);
  const resizeLogin = async (): Promise<void> => {
    if (stopped || attempts++ >= 100) return;
    try {
      const windows = await chrome.windows.getAll({ populate: true });
      const login = windows.find((window) => window.id !== undefined && !existingWindows.has(window.id)
        && window.type === 'popup' && window.tabs?.some((tab) => tab.url?.startsWith(`${issuerOrigin}/`)));
      if (!stopped && login?.id !== undefined) {
        await enlarge(login.id);
        return;
      }
    } catch { /* Login still works if Chrome does not allow resizing its window. */ }
    if (!stopped) resizeTimer = setTimeout(() => void resizeLogin(), 100);
  };
  const authFlow = chrome.identity.launchWebAuthFlow({ url: authorizationUrl, interactive: true });
  void resizeLogin();
  let callback: string | undefined;
  try { callback = await authFlow; }
  catch (error) {
    if (error instanceof Error && error.message === 'The user did not approve access.') throw new LoginCancelled();
    throw error;
  }
  finally { stopped = true; clearTimeout(resizeTimer); chrome.tabs.onUpdated.removeListener(onUpdated); }
  if (callback === undefined) throw new LoginCancelled();
  // Secure Logoff may have happened while Chrome owned the OAuth window. Never exchange a callback
  // from the invalidated attempt for a fresh operator session afterward.
  throwIfCanceled(signal);
  await auth.completeAuthorizationCode(callback);
  throwIfCanceled(signal);
}

export async function chooseAnotherSafeIdAccount(issuer: string): Promise<void> {
  const url = new URL(issuer);
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  const cookies = await chrome.cookies.getAll({ url: url.toString() });
  const sessionCookies = new Set(['KEYCLOAK_IDENTITY', 'KEYCLOAK_SESSION', 'AUTH_SESSION_ID', 'KC_AUTH_SESSION_HASH', 'KC_RESTART']);
  for (const cookie of cookies) {
    if (cookie.path !== url.pathname || !sessionCookies.has(cookie.name)) continue;
    const cookieUrl = new URL(cookie.path, url.origin);
    if (cookie.secure) cookieUrl.protocol = 'https:';
    const removed = await chrome.cookies.remove({
      url: cookieUrl.toString(), name: cookie.name, storeId: cookie.storeId,
    });
    if (removed === null) throw new Error('safeid_account_choice_unavailable');
  }
}
