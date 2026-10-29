import { describe, expect, it, vi } from 'vitest';
import { chooseAnotherSafeIdAccount, LoginCancelled, signIn } from '../src/background/auth.js';

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

describe('SafeID account choice', () => {
  it('removes only the issuer SSO cookies before another account signs in', async () => {
    const remove = vi.fn(async ({ name }: { name: string }) => ({ name }));
    const getAll = vi.fn(async () => [
      { name: 'KEYCLOAK_IDENTITY', path: '/realms/test/', storeId: '0', secure: true },
      { name: 'KEYCLOAK_SESSION', path: '/realms/test/', storeId: '0', secure: true },
      { name: 'KEYCLOAK_SESSION', path: '/realms/other/', storeId: '0', secure: true },
      { name: 'AUTH_SESSION_ID', path: '/realms/test/', storeId: '0' },
      { name: 'KC_AUTH_SESSION_HASH', path: '/realms/test/', storeId: '0' },
      { name: 'KC_RESTART', path: '/realms/test/', storeId: '0' },
      { name: 'KEYCLOAK_LOCALE', path: '/realms/test/', storeId: '0' },
    ]);
    vi.stubGlobal('chrome', { cookies: { getAll, remove } });

    await chooseAnotherSafeIdAccount('https://safeid.example/realms/test');

    expect(getAll).toHaveBeenCalledWith({ url: 'https://safeid.example/realms/test/' });
    expect(remove.mock.calls.map(([cookie]) => cookie)).toEqual([
      { url: 'https://safeid.example/realms/test/', name: 'KEYCLOAK_IDENTITY', storeId: '0' },
      { url: 'https://safeid.example/realms/test/', name: 'KEYCLOAK_SESSION', storeId: '0' },
      { url: 'https://safeid.example/realms/test/', name: 'AUTH_SESSION_ID', storeId: '0' },
      { url: 'https://safeid.example/realms/test/', name: 'KC_AUTH_SESSION_HASH', storeId: '0' },
      { url: 'https://safeid.example/realms/test/', name: 'KC_RESTART', storeId: '0' },
    ]);
  });

  it('fails account choice if a realm session cookie cannot be removed', async () => {
    const remove = vi.fn(async () => null);
    vi.stubGlobal('chrome', { cookies: {
      getAll: vi.fn(async () => [{ name: 'AUTH_SESSION_ID', path: '/realms/test/', storeId: '0', secure: false }]), remove,
    } });

    await expect(chooseAnotherSafeIdAccount('http://safeid.example/realms/test'))
      .rejects.toThrow('safeid_account_choice_unavailable');
    expect(remove).toHaveBeenCalledWith({ url: 'http://safeid.example/realms/test/', name: 'AUTH_SESSION_ID', storeId: '0' });
  });
});
