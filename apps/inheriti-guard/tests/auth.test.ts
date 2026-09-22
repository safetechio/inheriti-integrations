import { describe, expect, it, vi } from 'vitest';
import { LoginCancelled, signIn } from '../src/background/auth.js';

describe('Chrome OAuth cancellation', () => {
  it('does not exchange an OAuth callback that completes after Secure Logoff invalidates sign-in', async () => {
    let finishOAuth!: (callback: string) => void;
    const completeAuthorizationCode = vi.fn(async () => undefined);
    const auth = {
      beginAuthorizationCode: vi.fn(async () => ({ authorizationUrl: 'https://issuer.example/authorize' })),
      completeAuthorizationCode,
    };
    vi.stubGlobal('chrome', { identity: {
      launchWebAuthFlow: vi.fn(() => new Promise<string>((resolve) => { finishOAuth = resolve; })),
    } });
    const cancellation = new AbortController();

    const signingIn = signIn(auth as never, cancellation.signal);
    await vi.waitFor(() => expect(chrome.identity.launchWebAuthFlow).toHaveBeenCalledOnce());
    cancellation.abort();
    finishOAuth('https://extension.example/oauth?code=stale');

    await expect(signingIn).rejects.toBeInstanceOf(LoginCancelled);
    expect(completeAuthorizationCode).not.toHaveBeenCalled();
  });
});
