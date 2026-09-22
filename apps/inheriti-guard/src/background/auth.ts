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
