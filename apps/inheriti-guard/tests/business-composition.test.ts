import { describe, expect, it, vi } from 'vitest';
import { createCore } from '../src/background/plans.js';
import { resolveConfiguration } from '../src/shared/configuration.js';

vi.mock('@safetech/inheriti-elements-core/browser', () => ({
  createBrowserIntegrationCore: (options: unknown) => options,
}));

describe('Chrome Business composition', () => {
  it('passes only the selected organization to the shared browser core', () => {
    Object.assign(globalThis, { chrome: { identity: { getRedirectURL: vi.fn(() => 'https://extension.test/oauth') } } });
    const configuration = resolveConfiguration({ apiUrl: 'https://business.test/integrations/',
      issuer: 'https://safeid.test/realms/test', clientId: 'chrome-business', environment: 'TEST' });
    const core = createCore({ ...configuration, environment: 'LIVE' }, { load: async () => undefined, save: async () => undefined,
      clear: async () => undefined }, undefined, 'org-a') as unknown as Record<string, unknown>;

    expect(core).toMatchObject({ business: true, organizationId: 'org-a', liveConfirmation: 'LIVE' });
    expect(core.configuration).toMatchObject({ audience: 'inheriti-integrations-api', scopes: ['openid'] });
    expect(chrome.identity.getRedirectURL).toHaveBeenCalledWith('integrations-oauth');
    expect(core).not.toHaveProperty('applicationId');
    expect(core).not.toHaveProperty('masterKey');
  });
});
