import { expect, it, vi } from 'vitest';
import { createExtensionCore } from '../src/elements.js';
import { resolveConfiguration } from '../src/configuration.js';

const composed = vi.hoisted(() => vi.fn((_options: unknown) => ({})));
vi.mock('@safetech/inheriti-elements-core/node', () => ({ createNodeIntegrationCore: composed }));

const configuration = resolveConfiguration((key) => ({
  apiUrl: 'http://business', issuer: 'http://issuer', clientId: 'vscode',
}[key as 'apiUrl' | 'issuer' | 'clientId']));

it('composes Business requests with the chosen organization and identity scope', () => {
  createExtensionCore({ ...configuration, environment: 'LIVE' }, {} as never, {} as never, 'organization-one');
  expect(composed).toHaveBeenCalledWith(expect.objectContaining({
    business: true,
    liveConfirmation: 'LIVE',
    organizationId: 'organization-one',
    configuration: expect.objectContaining({ audience: 'inheriti-integrations-api', scopes: ['openid'] }),
  }));
  expect(composed.mock.lastCall?.[0]).not.toHaveProperty('applicationId');
});
