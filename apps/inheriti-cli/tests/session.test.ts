import { expect, it, vi } from 'vitest';
import { createCliContext } from '../src/session.js';
import type { CliConfiguration } from '../src/configuration.js';

const composed = vi.hoisted(() => vi.fn(() => ({})));
vi.mock('@safetech/inheriti-elements-core/node', () => ({ createNodeIntegrationCore: composed }));

it('confirms the environment when composing the shared core', () => {
  createCliContext({
    apiUrl: 'https://business.test/integrations/', business: true, issuer: 'https://safeid.test',
    clientId: 'device', interactiveClientId: 'interactive', environment: 'LIVE', scopes: ['openid'],
    redirectUri: 'http://127.0.0.1:53682/oauth/callback',
  } satisfies CliConfiguration, '/tmp/inheriti-cli-session-test.json');

  expect(composed).toHaveBeenCalledWith(expect.objectContaining({ liveConfirmation: 'LIVE' }));
});
