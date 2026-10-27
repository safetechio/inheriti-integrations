import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { MetadataTools, safeResult } from '../src/server.js';

vi.mock('../src/runtime/configuration.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/runtime/configuration.js')>(),
  lockedDeployment: 'dev',
}));

const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;
const nextVersion = version.replace(/^(\d+\.\d+\.)(\d+)$/u, (_match, prefix: string, patch: string) => `${prefix}${Number(patch) + 1}`);
const newer = {
  id: 'mcp-next', integration: 'mcp', platform: `${process.platform}-${process.arch}`, version: nextVersion,
  fileName: 'mcp.tgz', size: 1, checksum: '0'.repeat(64), publishedAt: '2026-10-27T00:00:00Z',
};

function readyTools(listInternalBuilds: () => Promise<typeof newer[]>) {
  const tools = new MetadataTools();
  const core = { listInternalBuilds, listOrganizations: async () => [{ id: 'org', name: 'Org' }] };
  Object.assign(tools, {
    authorized: async () => core,
    preferences: async () => ({}),
    key: async () => 'operator',
  });
  return tools;
}

it('permits login and update status while blocking a protected tool with actionable structured result', async () => {
  const listInternalBuilds = vi.fn(async () => [newer]);
  const tools = readyTools(listInternalBuilds);
  expect(await tools.listOrganizations()).toMatchObject({ items: [{ id: 'org', name: 'Org' }], selectedId: 'org',
    update: { required: true, version, latestVersion: nextVersion } });
  expect(await tools.checkUpdate()).toMatchObject({ version, updateAvailable: true, latestVersion: nextVersion });
  const result = await safeResult(() => tools.listPlans())({});
  expect(result).toMatchObject({
    isError: true,
    structuredContent: { code: 'integration_update_required', version, latestVersion: nextVersion },
  });
  expect(result.content[0]?.text).toContain('inheriti-mcp update --install');
  expect(listInternalBuilds).toHaveBeenCalledTimes(1);
  expect(await tools.logout()).toMatchObject({ signedOut: true });
});

it('does not cache a failed version check as success', async () => {
  const listInternalBuilds = vi.fn().mockRejectedValueOnce(new Error('private provider failure')).mockResolvedValueOnce([]);
  const tools = readyTools(listInternalBuilds);
  expect(await safeResult(() => tools.listPlans())({})).toMatchObject({
    isError: true, structuredContent: { code: 'update_check_unavailable' },
  });
  expect(await tools.checkUpdate()).toMatchObject({ version, updateAvailable: false });
  expect(listInternalBuilds).toHaveBeenCalledTimes(2);
});

it('preserves authentication failures during the update check', async () => {
  const tools = readyTools(async () => { throw Object.assign(new Error('expired'), { status: 401, code: 'operator_reauthentication_required' }); });
  expect(await safeResult(() => tools.listPlans())({})).toMatchObject({
    isError: true, content: [{ type: 'text', text: 'operator_reauthentication_required' }],
  });
});

it('preserves an authentication error without an HTTP status', async () => {
  const tools = readyTools(async () => { throw Object.assign(new Error('expired'), { code: 'operator_reauthentication_required' }); });
  expect(await safeResult(() => tools.listPlans())({})).toMatchObject({
    isError: true, content: [{ type: 'text', text: 'operator_reauthentication_required' }],
  });
});

it('blocks new work during a pending reveal but still allows its cancellation', async () => {
  const tools = readyTools(async () => [newer]);
  const abortPlanAccess = vi.fn(async () => ({ aborted: true }));
  const identity = JSON.stringify(['issuer', 'TEST', 'subject', 'session']);
  const controller = new AbortController();
  Object.assign(tools, {
    config: { issuer: 'issuer', environment: 'TEST' },
    sessions: { load: async () => ({ principal: { subject: 'subject', sessionId: 'session' } }) },
    scoped: { identity, organizationId: 'org', core: { abortPlanAccess } },
    job: { status: 'WAITING', planId: 'plan', organizationId: 'org', controller, done: Promise.resolve() },
  });
  expect(await safeResult(() => tools.listPlans())({})).toMatchObject({
    isError: true, structuredContent: { code: 'integration_update_required' },
  });
  expect(await tools.abortPlanAccess('plan')).toEqual({ organizationId: 'org', aborted: true });
  expect(controller.signal.aborted).toBe(true);
  expect(abortPlanAccess).toHaveBeenCalledWith('plan', undefined);
  Object.assign(tools, { job: undefined });
  expect(await tools.abortPlanAccess('server-interrupted')).toEqual({ organizationId: 'org', aborted: true });
  expect(abortPlanAccess).toHaveBeenCalledWith('server-interrupted', undefined);
});
