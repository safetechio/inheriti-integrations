import { describe, expect, it } from 'vitest';
import { discoverOrganizations, saveOrganization } from '../src/organizations.js';
import type { ExtensionConfiguration } from '../src/configuration.js';

const configuration = { issuer: 'issuer', environment: 'TEST' } as ExtensionConfiguration;
const organizations = [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }];

function fixture(subject = 'alice', items = organizations) {
  let selected: Record<string, string> = {};
  const state = {
    get: (_key: string, fallback: Record<string, string>) => Object.keys(selected).length ? selected : fallback,
    update: async (_key: string, value: Record<string, string>) => { selected = { ...value }; },
  } as never;
  const core = { getAccessToken: async () => 'token', listOrganizations: async () => items } as never;
  const sessions = { load: async () => ({ principal: { subject } }) } as never;
  return { core, sessions, state, saved: () => selected };
}

describe('Business organization selection', () => {
  it('keeps several organizations unselected until the user chooses one, scoped to account and environment', async () => {
    const { core, sessions, state, saved } = fixture();
    expect(await discoverOrganizations(core, sessions, state, configuration)).toEqual({ items: organizations });
    await saveOrganization(core, sessions, state, configuration, 'two');
    expect((await discoverOrganizations(core, sessions, state, configuration)).selected?.id).toBe('two');
    expect((await discoverOrganizations(core, { load: async () => ({ principal: { subject: 'bob' } }) } as never, state, configuration)).selected).toBeUndefined();
    expect((await discoverOrganizations(core, sessions, state, { ...configuration, environment: 'LIVE' })).selected).toBeUndefined();
    expect(Object.values(saved())).toEqual(['two']);
  });

  it('auto-selects one, clears stale choices, and reports zero without a plan context', async () => {
    const { core, sessions, state, saved } = fixture('alice', [{ id: 'one', name: 'One' }]);
    expect((await discoverOrganizations(core, sessions, state, configuration)).selected?.id).toBe('one');
    expect(Object.values(saved())).toEqual(['one']);
    const emptyCore = { getAccessToken: async () => 'token', listOrganizations: async () => [] } as never;
    expect(await discoverOrganizations(emptyCore, sessions, state, configuration)).toEqual({ items: [] });
    expect(saved()).toEqual({});
  });

  it('refuses a guessed organization ID', async () => {
    const { core, sessions, state } = fixture();
    await expect(saveOrganization(core, sessions, state, configuration, 'foreign'))
      .rejects.toMatchObject({ code: 'organization_access_denied' });
  });
});
