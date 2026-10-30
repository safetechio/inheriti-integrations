import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { OperatorRuntime } = require('../../electron/lib/operator-runtime.cjs');

describe('cancelled browser authorization', () => {
  it('answers a late browser callback without enrolling the account', async () => {
    const controller = new AbortController();
    const runtime = Object.create(OperatorRuntime.prototype);
    runtime.revision = 0;
    runtime.sdk = { MemoryOperatorSessionStore: class {} };
    const configuration = { redirectUri: '' };
    runtime.configuration = () => configuration;
    runtime.core = () => ({ auth: { beginAuthorizationCode: async () => ({ authorizationUrl: `https://example.test/auth?redirect_uri=${encodeURIComponent(configuration.redirectUri)}` }) } });
    const openBrowser = vi.fn(async (_url: string) => {});

    const pending = runtime.authorize(openBrowser, controller.signal, { activate: false });
    await vi.waitFor(() => expect(openBrowser).toHaveBeenCalledOnce());
    const redirectUri = new URL(openBrowser.mock.calls[0][0]).searchParams.get('redirect_uri');
    expect(redirectUri).toBeTruthy();

    controller.abort();
    await expect(pending).rejects.toThrow('operator_authorization_canceled');
    const response = await fetch(`${redirectUri}?code=late&state=late`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Sign-in was cancelled');
  });
});
