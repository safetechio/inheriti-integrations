import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { organizationCommand, selectedOrganization } from '../src/organizations.js';
import type { CliContext } from '../src/session.js';
import type { CliConfiguration } from '../src/configuration.js';
import type { Terminal } from '../src/output.js';

const home = mkdtempSync(resolve(tmpdir(), 'inheriti-organizations-'));
afterAll(() => rmSync(home, { force: true, recursive: true }));
const path = resolve(home, 'config.json');
const configuration = { issuer: 'issuer', environment: 'TEST' } as CliConfiguration;
const items = [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }];
const terminal = { interactive: false, columns: 80, write: () => {}, writeError: () => {} } as Terminal;

function context(subject: string, available = items): CliContext {
  return {
    core: { getAccessToken: async () => 'token', listOrganizations: async () => available },
    sessions: { load: async () => ({ principal: { subject } }) },
  } as unknown as CliContext;
}

it('requires an explicit choice for several organizations and keeps user preferences isolated', async () => {
  await expect(selectedOrganization(context('alice'), configuration, path, terminal))
    .rejects.toThrow('organization_selection_required: One (one), Two (two)');
  await organizationCommand(context('alice'), configuration, path, terminal, ['use', 'two']);
  expect((await selectedOrganization(context('alice'), configuration, path, terminal)).id).toBe('two');
  await expect(selectedOrganization(context('bob'), configuration, path, terminal))
    .rejects.toThrow('organization_selection_required');
  await expect(selectedOrganization(context('alice'), { ...configuration, environment: 'LIVE' }, path, terminal))
    .rejects.toThrow('organization_selection_required');
  expect((await selectedOrganization(context('alice'), { ...configuration, issuer: 'other' }, path, terminal, 'one')).id).toBe('one');
  expect((await selectedOrganization(context('alice'), configuration, path, terminal)).id).toBe('two');
  expect(Object.values(JSON.parse(readFileSync(resolve(home, 'organizations.json'), 'utf8')))).toEqual(['two']);
});

it('clears a stale choice and allows the sole current organization', async () => {
  expect((await selectedOrganization(context('alice', [{ id: 'one', name: 'One' }]), configuration, path, terminal)).id).toBe('one');
  expect(Object.values(JSON.parse(readFileSync(resolve(home, 'organizations.json'), 'utf8')))).toEqual([]);
  await expect(selectedOrganization(context('alice', []), configuration, path, terminal)).rejects.toThrow('organization_required');
});
