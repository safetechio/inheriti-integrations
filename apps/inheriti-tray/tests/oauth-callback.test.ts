import { createNodeIntegrationCore } from '@safetech/inheriti-elements-core/node';
import type { NodeIntegrationCoreOptions } from '@safetech/inheriti-elements-core/node';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { waitForCallback } from '../src/modules/auth/main/oauth-callback.js';

describe('OAuth browser callback', () => {
  it.each([
    { query: 'code=private-code&state=private-state', status: 200, heading: 'Continue in Inheriti® Tray', rejection: null },
    { query: 'error=access_denied&error_description=private-description', status: 400, heading: 'Sign-in failed', rejection: 'access_denied' },
    { query: 'code=private-code', status: 400, heading: 'Sign-in failed', rejection: 'Invalid sign-in callback' },
  ])('renders a self-contained UTF-8 page for $query', async ({ query, status, heading, rejection }) => {
    let request: Promise<Response> | undefined;
    let redirectUri = '';
    const outcome = await waitForCallback(async (uri) => {
      redirectUri = uri;
      request = fetch(`${uri}?${query}`, { headers: { connection: 'close' } });
      await request;
      return 'https://issuer.test/authorize';
    }, async () => {}, new AbortController().signal).then((url) => ({ url, error: null }), (error: Error) => ({ url: null, error }));
    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:[1-9]\d*\/oauth\/callback$/);
    const response = await request!;
    expect(response.status).toBe(status);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const html = await response.text();
    expect(html).toContain(`<h1 class="${status === 200 ? '' : 'failed'}">${heading}</h1>`);
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('data:font/ttf;base64,');
    expect(html).toContain('Inheriti® Tray');
    expect(html).not.toMatch(/private-|\{\{|Ã|Â|Business/);
    if (rejection) {
      expect(outcome.error).toBeInstanceOf(Error);
      expect(outcome.error?.message).toBe(rejection);
      expect(outcome.url).toBeNull();
    } else {
      expect(outcome.url).toBe(`${redirectUri}?${query}`);
    }
  });
  it('preserves the assigned URI, state, and PKCE through real SDK authorization', async () => {
    const configuration: NodeIntegrationCoreOptions['configuration'] = {
      issuer: 'https://issuer.test', clientId: 'tray-test', audience: 'inheriti-integrations-api',
      environment: 'TEST', redirectUri: 'http://127.0.0.1/oauth/callback', scopes: ['openid', 'profile'],
    };
    const principal = {
      issuer: configuration.issuer, audience: configuration.audience, authorizedParty: configuration.clientId,
      environment: 'TEST' as const, subject: 'operator', sessionId: 'session', tokenId: 'token', scopes: ['openid', 'profile'],
    };
    let nonce = '';
    let exchanged: URLSearchParams | undefined;
    const core = createNodeIntegrationCore({
      apiUrl: 'https://business.test/integrations/', environment: 'TEST', business: true, configuration,
      tokenValidator: {
        validateAccessToken: async () => principal,
        validateIdToken: async () => Object.assign({}, principal, { audience: configuration.clientId, nonce }),
      },
      fetchImpl: async (input, init) => {
        if (String(input).endsWith('/.well-known/openid-configuration')) {
          return Response.json({ issuer: configuration.issuer, authorization_endpoint: 'https://issuer.test/authorize', token_endpoint: 'https://issuer.test/token' });
        }
        expect(String(input)).toBe('https://issuer.test/token');
        exchanged = new URLSearchParams(String(init?.body));
        return Response.json({ access_token: 'access', id_token: 'id', token_type: 'Bearer', expires_in: 3600 });
      },
    });
    const callbackUrl = await waitForCallback(async (redirectUri) => {
      configuration.redirectUri = redirectUri;
      const started = await core.auth.beginAuthorizationCode();
      const authorization = new URL(started.authorizationUrl);
      expect(authorization.searchParams.get('redirect_uri')).toBe(redirectUri);
      expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
      nonce = authorization.searchParams.get('nonce')!;
      return started.authorizationUrl;
    }, async (authorizationUrl) => {
      const authorization = new URL(authorizationUrl);
      await fetch(`${configuration.redirectUri}?code=code&state=${encodeURIComponent(authorization.searchParams.get('state')!)}`);
    }, new AbortController().signal);
    expect(callbackUrl.split('?')[0]).toBe(configuration.redirectUri);
    await core.auth.completeAuthorizationCode(callbackUrl);
    expect(exchanged?.get('redirect_uri')).toBe(configuration.redirectUri);
    expect(exchanged?.get('code')).toBe('code');
    expect(exchanged?.get('code_verifier')).toBeTruthy();
  });

  it('never opens the browser after timeout during authorization discovery', async () => {
    let release!: (url: string) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const discovery = new Promise<string>((resolve) => { release = resolve; });
    const openBrowser = vi.fn().mockResolvedValue(undefined);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const outcome = waitForCallback(async () => { started(); return discovery; }, openBrowser, new AbortController().signal);
      const rejected = expect(outcome).rejects.toThrow('Sign-in timed out');
      await ready;
      await vi.advanceTimersByTimeAsync(300_000);
      await rejected;
      release('https://issuer.test/authorize');
      await discovery;
      await Promise.resolve();
      expect(openBrowser).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('signs in while the former fixed port is occupied', async () => {
    const occupied = createServer();
    await new Promise<void>((resolve, reject) => {
      occupied.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EACCES' || error.code === 'EADDRINUSE') { resolve(); return; }
        reject(error);
      });
      occupied.listen(53682, '127.0.0.1', resolve);
    });
    try {
      const callback = await waitForCallback(async (uri) => {
        expect(new URL(uri).port).not.toBe('53682');
        await fetch(`${uri}?code=code&state=state`);
        return 'https://issuer.test/authorize';
      }, async () => {}, new AbortController().signal);
      expect(callback).toContain('?code=code&state=state');
    } finally {
      if (occupied.listening) await new Promise<void>((resolve) => occupied.close(() => resolve()));
    }
  });

  it.each(['failure', 'cancel'] as const)('closes the listener and connected sockets on %s', async (mode) => {
    const controller = new AbortController();
    let redirectUri = '';
    let socket: ReturnType<typeof connect> | undefined;
    let closed: Promise<void> | undefined;
    const outcome = waitForCallback(async (uri) => {
      redirectUri = uri;
      socket = connect(Number(new URL(uri).port), '127.0.0.1');
      closed = new Promise<void>((resolve) => socket!.once('close', () => resolve()));
      await new Promise<void>((resolve, reject) => { socket!.once('connect', resolve); socket!.once('error', reject); });
      if (mode === 'cancel') { controller.abort(); return 'https://issuer.test/authorize'; }
      throw new Error('authorization_failed');
    }, async () => {}, controller.signal);
    await expect(outcome).rejects.toThrow(mode === 'cancel' ? 'Sign-in canceled' : 'authorization_failed');
    await closed;
    await expect(fetch(redirectUri)).rejects.toThrow();
    expect(socket?.destroyed).toBe(true);
  });
});
