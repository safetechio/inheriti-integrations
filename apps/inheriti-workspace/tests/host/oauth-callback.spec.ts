import { EventEmitter } from 'node:events';
import type { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { openSystemBrowser, waitForOAuthCallback } from '../../src-tauri/sidecar/oauth-callback.js';

const spawn = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn }));

describe('Workspace system browser', () => {
  it.each([
    ['linux', 'xdg-open', ['https://issuer.test/auth?state=a&scope=b']],
    ['darwin', 'open', ['https://issuer.test/auth?state=a&scope=b']],
    ['win32', 'rundll32.exe', ['url.dll,FileProtocolHandler', 'https://issuer.test/auth?state=a&scope=b']],
  ] as const)('opens OAuth URL on %s without a shell', async (platform, command, args) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform);
    spawn.mockImplementation(() => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('spawn'));
      return child;
    });
    try {
      await openSystemBrowser('https://issuer.test/auth?state=a&scope=b');
      expect(spawn).toHaveBeenCalledWith(command, args, { stdio: 'ignore', shell: false });
    } finally {
      vi.restoreAllMocks();
      spawn.mockReset();
    }
  });
});

describe('Workspace OAuth loopback', () => {
  it.each([
    ['code=private-code&state=expected', 200, 'Continue in Inheriti Workspace', null],
    ['error=login_required&state=expected', 400, 'Sign-in failed', 'login_required'],
    ['code=private-code', 400, 'Sign-in failed', 'invalid_callback'],
  ] as const)('returns a branded callback for %s', async (query, status, heading, failure) => {
    let responsePromise!: Promise<Response>;
    const callback = waitForOAuthCallback(async (redirectUri) => redirectUri, async (redirectUri) => {
      responsePromise = fetch(`${redirectUri}?${query}`);
      await responsePromise;
    }, new AbortController().signal);
    if (failure) await expect(callback).rejects.toThrow(failure);
    else expect(await callback).toMatch(/\/oauth\/callback\?code=private-code&state=expected$/);
    const response = await responsePromise;
    const html = await response.text();
    expect(response.status).toBe(status);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(html).toContain(heading);
    expect(html).toContain('Inheriti Workspace');
    expect(html).not.toContain('private-code');
  });

  it('does not open the browser after cancellation during authorization', async () => {
    const listener = new EventEmitter() as EventEmitter & {
      listen: (port: number, host: string, callback: () => void) => void;
      address: () => { port: number };
      closeAllConnections: () => void;
      close: () => void;
    };
    listener.listen = (_port, _host, callback) => callback();
    listener.address = () => ({ port: 12345 });
    listener.closeAllConnections = vi.fn();
    listener.close = vi.fn();
    let resolveAuthorization!: (url: string) => void;
    const authorization = new Promise<string>((resolve) => { resolveAuthorization = resolve; });
    const controller = new AbortController();
    const openBrowser = vi.fn(async () => undefined);

    const callback = waitForOAuthCallback(() => authorization, openBrowser, controller.signal,
      (() => listener) as unknown as typeof createServer);
    controller.abort();
    await expect(callback).rejects.toThrow('canceled');
    resolveAuthorization('https://issuer.test/auth?secret=private');
    await new Promise((resolve) => setImmediate(resolve));

    expect(openBrowser).not.toHaveBeenCalled();
  });
});
