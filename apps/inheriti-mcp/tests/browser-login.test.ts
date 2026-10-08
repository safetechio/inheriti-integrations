import { expect, it, vi } from 'vitest';
import { beginBrowserLogin } from '../src/browser-login.js';

it('completes browser sign-in through the loopback callback', async () => {
  const configuration = { redirectUri: 'http://127.0.0.1/oauth/callback' };
  const completeAuthorizationCode = vi.fn().mockResolvedValue(undefined);
  const auth = {
    beginAuthorizationCode: vi.fn(async () => ({ authorizationUrl: `https://login.example/authorize?redirect_uri=${encodeURIComponent(configuration.redirectUri)}`, expiresAt: Date.now() + 60_000 })),
    completeAuthorizationCode,
  };
  const open = vi.fn();
  const login = await beginBrowserLogin(auth, configuration, open);
  try {
    expect(open).toHaveBeenCalledWith(login.authorizationUrl);
    expect(new URL(login.authorizationUrl).searchParams.get('redirect_uri')).toBe(configuration.redirectUri);
    expect(new URL(configuration.redirectUri).port).not.toBe('');
    const callback = `${configuration.redirectUri}?code=approved&state=expected`;
    const response = await fetch(callback);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Signed in');
    await expect(login.completed).resolves.toBeUndefined();
    expect(completeAuthorizationCode).toHaveBeenCalledExactlyOnceWith(callback);
  } finally {
    login.cancel();
  }
});

it('does not report sign-in success when the authorization exchange fails', async () => {
  const configuration = { redirectUri: 'http://127.0.0.1/oauth/callback' };
  const auth = {
    beginAuthorizationCode: vi.fn(async () => ({ authorizationUrl: 'https://login.example/authorize', expiresAt: Date.now() + 60_000 })),
    completeAuthorizationCode: vi.fn().mockRejectedValue(new Error('state_mismatch')),
  };
  const login = await beginBrowserLogin(auth, configuration, vi.fn());
  try {
    const response = await fetch(`${configuration.redirectUri}?code=wrong&state=wrong`);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain('Sign-in failed');
    await expect(login.completed).rejects.toThrow('state_mismatch');
  } finally {
    login.cancel();
  }
});
