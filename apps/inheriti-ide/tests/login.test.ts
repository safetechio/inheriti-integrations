import { describe, expect, it, vi } from 'vitest';
import { LoginCancelled, LoginTimedOut, signIn } from '../src/login.js';
import { ExtensionConfigurationInvalid, REDIRECT_URI, resolveConfiguration } from '../src/configuration.js';

const settings: Record<string, string> = {
  apiUrl: 'http://127.0.0.1:3201',
  applicationId: 'application-1',
  issuer: 'http://127.0.0.1:4564/realms/elements',
  clientId: 'elements-test-vscode',
};

function authDouble(overrides: Record<string, unknown> = {}) {
  return {
    beginAuthorizationCode: async () => ({ authorizationUrl: 'https://issuer.test/auth?code_challenge_method=S256', expiresAt: 0 }),
    completeAuthorizationCode: vi.fn(async () => undefined),
    ...overrides,
  } as never;
}

describe('signIn', () => {
  it('opens the operator’s own browser and completes with the callback VS Code received', async () => {
    const auth = authDouble();
    const opened: string[] = [];
    await signIn(auth, {
      openExternal: async (url) => { opened.push(url); return true; },
      awaitCallback: async () => `${REDIRECT_URI}?code=abc&state=xyz`,
    });
    expect(opened[0]).toContain('code_challenge_method=S256');
    expect((auth as unknown as { completeAuthorizationCode: ReturnType<typeof vi.fn> }).completeAuthorizationCode)
      .toHaveBeenCalledWith(`${REDIRECT_URI}?code=abc&state=xyz`);
  });

  it('stops when the operator declines to open the browser', async () => {
    const auth = authDouble();
    await expect(signIn(auth, { openExternal: async () => false, awaitCallback: async () => 'unused' }))
      .rejects.toBeInstanceOf(LoginCancelled);
    expect((auth as unknown as { completeAuthorizationCode: ReturnType<typeof vi.fn> }).completeAuthorizationCode)
      .not.toHaveBeenCalled();
  });

  it('gives up rather than waiting forever when no callback arrives', async () => {
    await expect(signIn(authDouble(), { openExternal: async () => true, awaitCallback: async () => undefined }))
      .rejects.toBeInstanceOf(LoginTimedOut);
  });
});

describe('extension configuration', () => {
  it('defaults to TEST and uses the registered vscode:// redirect', () => {
    const configuration = resolveConfiguration((key) => settings[key]);
    expect(configuration.environment).toBe('TEST');
    expect(configuration.applicationId).toBe('application-1');
    expect(configuration.redirectUri).toBe('vscode://safetech.inheriti-integrations/oauth/callback');
    expect(configuration.scopes).toEqual(['openid', 'plan:list', 'plan:read', 'plan:reveal', 'asset:insert']);
  });

  it('refuses LIVE in a development build', () => {
    expect(() => resolveConfiguration((key) => (key === 'environment' ? 'LIVE' : settings[key])))
      .toThrow(ExtensionConfigurationInvalid);
  });

  it('asks the operator to configure rather than guessing an endpoint', () => {
    for (const missing of Object.keys(settings).filter((key) => key !== 'applicationId')) {
      expect(() => resolveConfiguration((key) => (key === missing ? undefined : settings[key])))
        .toThrow(ExtensionConfigurationInvalid);
    }
  });

  it('uses embedded Business when no Application id is configured', () => {
    const configuration = resolveConfiguration((key) => key === 'applicationId' ? undefined : settings[key]);
    expect(configuration).toMatchObject({ business: true, clientId: settings.clientId, scopes: ['openid'] });
    expect(configuration.applicationId).toBeUndefined();
  });

  it('resolves a Business deployment and rejects prod in this development build', () => {
    expect(resolveConfiguration((key) => key === 'deployment' ? 'dev' : undefined)).toMatchObject({
      business: true,
      apiUrl: 'https://business-api-dev.inheriti.com/integrations/',
      issuer: 'https://safeid-dev.safetech.io/realms/SafeID',
      clientId: 'inheriti-business-integrations-interactive',
    });
    expect(() => resolveConfiguration((key) => key === 'deployment' ? 'prod' : undefined))
      .toThrow('production build is required');
  });
});
