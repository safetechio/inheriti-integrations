import { describe, expect, it, vi } from 'vitest';
import { chooseAnotherSafeIdAccount, LoginCancelled, signIn } from '../src/background/auth.js';

describe('Chrome OAuth cancellation', () => {
  it('treats closing Chrome’s SafeID window as cancellation', async () => {
    vi.stubGlobal('chrome', {
      windows: { getAll: vi.fn(async () => []) },
      tabs: { onUpdated: { addListener: vi.fn(), removeListener: vi.fn() } },
      identity: { launchWebAuthFlow: vi.fn(async () => { throw new Error('The user did not approve access.'); }) },
    });
    const auth = { beginAuthorizationCode: vi.fn(async () => ({ authorizationUrl: 'https://safeid.example/authorize' })),
      completeAuthorizationCode: vi.fn(async () => undefined) };

    await expect(signIn(auth as never)).rejects.toBeInstanceOf(LoginCancelled);
    expect(auth.completeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('does not exchange an OAuth callback that completes after Secure Logoff invalidates sign-in', async () => {
    let finishOAuth!: (callback: string) => void;
    const completeAuthorizationCode = vi.fn(async () => undefined);
    const auth = {
      beginAuthorizationCode: vi.fn(async () => ({ authorizationUrl: 'https://issuer.example/authorize' })),
      completeAuthorizationCode,
    };
    vi.stubGlobal('chrome', { windows: { getAll: vi.fn(async () => []) }, tabs: { onUpdated: {
      addListener: vi.fn(), removeListener: vi.fn(),
    } }, identity: {
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

  it('enlarges only the new SafeID login popup', async () => {
    let finishOAuth!: (callback: string) => void;
    const update = vi.fn(async () => undefined);
    const getAll = vi.fn()
      .mockResolvedValueOnce([{ id: 1, type: 'normal' }, { id: 2, type: 'popup' }])
      .mockResolvedValue([{ id: 1, type: 'normal' }, { id: 2, type: 'popup', tabs: [{ url: 'https://safeid.example/' }] },
        { id: 3, type: 'popup', tabs: [{ url: 'https://other.example/' }] },
        { id: 4, type: 'popup', tabs: [{ url: 'https://safeid.example/realms/test/login' }] }]);
    vi.stubGlobal('chrome', {
      windows: { getAll, get: vi.fn(async () => ({ type: 'popup', width: 664, height: 306 })), update },
      tabs: { onUpdated: { addListener: vi.fn(), removeListener: vi.fn() } },
      identity: { launchWebAuthFlow: vi.fn(() => new Promise<string>((resolve) => { finishOAuth = resolve; })) },
    });
    const auth = {
      beginAuthorizationCode: vi.fn(async () => ({ authorizationUrl: 'https://safeid.example/realms/test/authorize' })),
      completeAuthorizationCode: vi.fn(async () => undefined),
    };

    const signingIn = signIn(auth as never);
    await vi.waitFor(() => expect(update).toHaveBeenCalledWith(4, { width: 960, height: 760 }));
    expect(update).toHaveBeenCalledTimes(1);
    finishOAuth('https://extension.example/oauth?code=fresh');
    await signingIn;
    expect(auth.completeAuthorizationCode).toHaveBeenCalledOnce();
  });

  it('enlarges the login after SafeID navigation if the popup appeared before its URL', async () => {
    let finishOAuth!: (callback: string) => void;
    let onUpdated!: Parameters<typeof chrome.tabs.onUpdated.addListener>[0];
    const update = vi.fn(async () => undefined);
    const removeListener = vi.fn();
    vi.stubGlobal('chrome', {
      windows: { getAll: vi.fn(async () => []), get: vi.fn(async () => ({ type: 'popup', width: 664, height: 306 })), update },
      tabs: { onUpdated: { addListener: vi.fn((listener) => { onUpdated = listener; }), removeListener } },
      identity: { launchWebAuthFlow: vi.fn(() => new Promise<string>((resolve) => { finishOAuth = resolve; })) },
    });
    const auth = { beginAuthorizationCode: vi.fn(async () => ({ authorizationUrl: 'https://safeid.example/authorize' })),
      completeAuthorizationCode: vi.fn(async () => undefined) };

    const signingIn = signIn(auth as never);
    await vi.waitFor(() => expect(chrome.identity.launchWebAuthFlow).toHaveBeenCalledOnce());
    onUpdated(7, { url: 'https://safeid.example/realms/test/login' }, { windowId: 4 } as chrome.tabs.Tab);
    await vi.waitFor(() => expect(update).toHaveBeenCalledWith(4, { width: 960, height: 760 }));
    finishOAuth('https://extension.example/oauth?code=fresh');
    await signingIn;
    expect(removeListener).toHaveBeenCalledWith(onUpdated);
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
