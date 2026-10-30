import { expect, it } from 'vitest';
import { composeOperatorAuth } from '../src/operator-auth.js';
import type { OperatorAuthRuntime } from '../src/operator-auth.js';
import { INTEGRATION_AUTHORITY } from '../src/deployment.js';

const configuration = {
  issuer: 'https://issuer.test', clientId: 'host-client', audience: 'inheriti-integrations-api',
  environment: 'TEST' as const, redirectUri: 'http://127.0.0.1/callback', scopes: ['openid'],
};

it('selects Business auth only for Business composition', () => {
  const constructed: Array<Record<string, unknown>> = [];
  const runtime = {
    OperatorAuthClient: class {
      constructor(options: Record<string, unknown>) { constructed.push(options); }
    },
    HttpOperatorAuthTransport: class { exchangeBusinessSession() {} refreshBusinessSession() {} },
    SystemOAuthClock: class {},
    WebOAuthCrypto: class {},
  } as unknown as OperatorAuthRuntime;

  composeOperatorAuth(runtime, { configuration, business: true, apiUrl: 'https://business.test/integrations/' });
  composeOperatorAuth(runtime, { configuration, business: true, businessAuthority: 'safeid-oidc', apiUrl: 'https://business.test/integrations/' });
  composeOperatorAuth(runtime, { configuration });

  expect(constructed[0]?.businessApiUrl).toBe('https://business.test/integrations/');
  expect(constructed[0]?.businessAuthority).toBe(INTEGRATION_AUTHORITY);
  expect(constructed[1]?.businessApiUrl).toBe('https://business.test/integrations/');
  expect(constructed[1]?.businessAuthority).toBe('safeid-oidc');
  expect(constructed[2]?.businessApiUrl).toBeUndefined();
  expect(constructed[2]?.businessAuthority).toBeUndefined();
  expect(() => composeOperatorAuth(runtime, { configuration, business: true })).toThrow('Business operator auth requires an API URL');
  expect(() => composeOperatorAuth(runtime, { configuration: { ...configuration, audience: 'inheriti-elements-api' },
    business: true, businessAuthority: 'safeid-oidc', apiUrl: 'https://business.test/integrations/' }))
    .toThrow('SafeID OIDC Business auth requires the inheriti-integrations-api audience');
});

it('rejects a Client SDK that sends provider tokens directly to Business', () => {
  const runtime = {
    OperatorAuthClient: class {}, HttpOperatorAuthTransport: class {},
    SystemOAuthClock: class {}, WebOAuthCrypto: class {},
  } as unknown as OperatorAuthRuntime;
  expect(() => composeOperatorAuth(runtime, { configuration, business: true, apiUrl: 'https://business.test/integrations/' }))
    .toThrow('Business session auth requires a compatible Inheriti Client SDK');
});
