import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('local Business API endpoint override', () => {
  it('uses an HTTPS tunnel only for a local build, keeping the local issuer and TEST environment', async () => {
    vi.stubGlobal('__INHERITI_DEPLOYMENT__', 'local');
    vi.resetModules();
    const { resolveConfiguration } = await import('../src/configuration.js');
    const defaultConfiguration = resolveConfiguration({});
    expect(defaultConfiguration.apiUrl).toBe('http://business.localhost:3400/integrations/');

    const configuration = resolveConfiguration({ INHERITI_LOCAL_BUSINESS_API_URL: 'https://tunnel.example/integrations/' });
    expect(configuration).toMatchObject({
      apiUrl: 'https://tunnel.example/integrations/',
      issuer: defaultConfiguration.issuer,
      environment: 'TEST',
      business: true,
    });
  }, 15_000);

  it.each([
    'http://tunnel.example/integrations/',
    'https://user:password@tunnel.example/integrations/',
    'https://tunnel.example/integrations/?token=secret',
    'https://tunnel.example/integrations/#secret',
    'https://tunnel.example/other/',
    'not-a-url',
  ])('rejects an unsafe local endpoint: %s', async (value) => {
    vi.stubGlobal('__INHERITI_DEPLOYMENT__', 'local');
    vi.resetModules();
    const { resolveConfiguration } = await import('../src/configuration.js');
    expect(() => resolveConfiguration({ INHERITI_LOCAL_BUSINESS_API_URL: value }))
      .toThrow('Local Inheriti® Business API override must be an HTTPS /integrations/ URL');
  });

  it('does not redirect a dev build', async () => {
    vi.stubGlobal('__INHERITI_DEPLOYMENT__', 'dev');
    vi.resetModules();
    const { resolveConfiguration } = await import('../src/configuration.js');
    expect(resolveConfiguration({ INHERITI_LOCAL_BUSINESS_API_URL: 'https://tunnel.example/integrations/' }).apiUrl)
      .toBe('https://business-api-dev.inheriti.com/integrations/');
  });
});
