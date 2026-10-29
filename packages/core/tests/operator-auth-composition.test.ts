import { expect, it } from 'vitest';
import { composeOperatorAuth } from '../src/operator-auth.js';
import type { OperatorAuthRuntime } from '../src/operator-auth.js';

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
    HttpOperatorAuthTransport: class {},
    SystemOAuthClock: class {},
    WebOAuthCrypto: class {},
  } as unknown as OperatorAuthRuntime;

  composeOperatorAuth(runtime, { configuration, business: true, apiUrl: 'https://business.test/integrations/' });
  composeOperatorAuth(runtime, { configuration });

  expect(constructed[0]?.businessApiUrl).toBe('https://business.test/integrations/');
  expect(constructed[1]?.businessApiUrl).toBeUndefined();
  expect(() => composeOperatorAuth(runtime, { configuration, business: true })).toThrow('Business operator auth requires an API URL');
});
