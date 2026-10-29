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
  const callback = await chrome.identity.launchWebAuthFlow({ url: authorizationUrl, interactive: true });
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
