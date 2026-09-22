import type { OperatorAuthFacade } from '@safetech/inheriti-elements-core';

export class LoginCancelled extends Error {
  public constructor() { super('login_cancelled'); this.name = 'LoginCancelled'; }
}

export class LoginTimedOut extends Error {
  public constructor() { super('login_timed_out'); this.name = 'LoginTimedOut'; }
}

export interface LoginSurfaces {
  /** Opens the authorization URL in the operator's own browser — never an embedded one. */
  openExternal(url: string): Promise<boolean>;
  /** Resolves with the callback URI VS Code received, or undefined if the operator gave up. */
  awaitCallback(signal: { timeoutMs: number }): Promise<string | undefined>;
}

/**
 * Authorization code + PKCE, driven entirely by the SDK through core. The extension supplies only the
 * two things it alone can do: open the system browser, and receive the `vscode://` callback. State,
 * nonce, verifier and token validation stay in the SDK, so this host cannot get them wrong.
 */
export async function signIn(
  auth: OperatorAuthFacade,
  surfaces: LoginSurfaces,
  timeoutMs = 300_000,
): Promise<void> {
  const { authorizationUrl } = await auth.beginAuthorizationCode();
  const opened = await surfaces.openExternal(authorizationUrl);
  if (!opened) throw new LoginCancelled();

  const callback = await surfaces.awaitCallback({ timeoutMs });
  if (callback === undefined) throw new LoginTimedOut();
  await auth.completeAuthorizationCode(callback);
}
