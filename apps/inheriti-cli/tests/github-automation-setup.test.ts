import { describe, expect, it, vi } from 'vitest';
import { githubAutomationCreate, githubAutomationSetup } from '../src/commands/github-automation-setup.js';
import type { AutomationSetupOperations } from '@safetech/inheriti-elements-core/node-base';
const { pairGithubWorkflow } = vi.hoisted(() => ({ pairGithubWorkflow: vi.fn(async (input: { prepare: () => Promise<void>; onProgress?: (phase: string) => void }) => {
  await input.prepare(); return { status: 'VERIFIED' as const, pairingId: 'pairing' };
}) }));
vi.mock('../src/commands/github-workflow-pairing.js', () => ({ pairGithubWorkflow }));

const id = '3a37e640-7588-433c-b922-6d0476f5caa0';
const trust = { method: 'GITHUB_ACTIONS_OIDC' as const, repositoryName: 'owner/repo', environment: 'production',
  workflow: 'owner/repo/.github/workflows/protected.yml@refs/heads/main' };
const selected = { id, name: 'Existing', provider: 'GITHUB' as const, environment: 'TEST' as const, status: 'VERIFIED', trust };
const release = { actionRepository: 'safetechio/inheriti-integrations', actionRef: 'a'.repeat(40), cliVersion: '0.0.14-dev.0' };
const setupArgs = ['--connection', id, '--plan', id, '--field', 'account.password'];
function fixture(opts: { connection?: typeof selected; connections?: typeof selected[]; existing?: string; empty?: boolean; releaseFails?: boolean; discoveryFails?: boolean; ghMissing?: boolean | undefined; authFails?: boolean | undefined; scopes?: string } = {}) {
  const output: string[] = [];
  const errors: string[] = [];
  const writes: string[] = [];
  const run = vi.fn(async (args: string[], body?: unknown) => {
    const path = args[1] ?? '';
    if (args[0] === '--version') { if (opts.ghMissing) throw new Error('ENOENT'); return undefined; }
    if (args[0] === 'auth') { if (opts.authFails) throw new Error('not authenticated'); return undefined; }
    if (args[0] === 'api' && path === 'user' && args.includes('--include')) return opts.scopes ?? 'HTTP/2 200\r\nx-oauth-scopes: repo, workflow\r\n\r\n{}';
    if (args[0] === 'repo') {
      if (opts.discoveryFails) throw new Error('not in a repo');
      return { nameWithOwner: 'owner/repo' };
    }
    if (args[0] === 'workflow') return undefined;
    if (args.includes('--method')) { writes.push(`${args[3]} ${path}`); return { sha: 'b'.repeat(40), body }; }
    if (path === 'repos/owner/repo') return { full_name: 'owner/repo', default_branch: 'main', permissions: { push: true } };
    if (path.includes('/contents/')) {
      if (opts.existing) return { encoding: 'base64', content: Buffer.from(opts.existing).toString('base64') };
      throw new Error('404');
    }
    if (path.includes('/git/ref/')) {
      if (opts.empty) throw new Error('404');
      return { ref: 'refs/heads/main' };
    }
    throw new Error(`Unexpected ${path}`);
  });
  const operations = {
    getVerifiedGithubRelease: vi.fn(async () => { if (opts.releaseFails) throw new Error('release unavailable'); return release; }),
    listConnections: vi.fn(async () => opts.connections ?? (opts.connection ? [opts.connection] : [])),
    listPlans: vi.fn(async () => [{ id, name: 'Selected plan' }]),
    getConnection: vi.fn(async () => opts.connection ?? selected),
    createConnection: vi.fn(async () => {}), startPairing: vi.fn(async () => ({ expiresAt: new Date(Date.now() + 500).toISOString() })),
    listGrants: vi.fn(async () => []), createGrant: vi.fn(async () => {}), activateGrant: vi.fn(async () => {}),
  } as unknown as AutomationSetupOperations;
  const context = { organization: { id }, core: { getAccessToken: async () => 'token',
    getPlan: async () => ({ assets: [{ id: 'one', code: 'account', fieldNames: ['password'] }] }) } } as any;
  const configuration = { apiUrl: 'https://business.example/' } as any;
  const terminal = { write: (s: string) => output.push(s), writeError: (s: string) => errors.push(s) } as any;
  return { run, operations, context, configuration, terminal, output, errors, writes };
}
const create = (f: ReturnType<typeof fixture>, args: string[] = []) => githubAutomationCreate(f.context, f.configuration, f.terminal, args, { run: f.run, operations: f.operations });
const setup = (f: ReturnType<typeof fixture>, args: string[] = setupArgs) => githubAutomationSetup(f.context, f.configuration, f.terminal, args, { run: f.run, operations: f.operations, wait: async () => {} });
function noGrants(f: ReturnType<typeof fixture>) {
  expect(f.operations.listGrants).not.toHaveBeenCalled();
  expect(f.operations.createGrant).not.toHaveBeenCalled();
  expect(f.operations.activateGrant).not.toHaveBeenCalled();
}

describe('GitHub connection creation', () => {
  it('requires workflow scope for a classic OAuth token before creating metadata', async () => {
    const f = fixture({ scopes: 'HTTP/2 200\r\nx-oauth-scopes: gist, repo, read:org\r\n\r\n{}' });
    expect(await create(f)).toBe(1);
    expect(f.errors.join()).toContain('requires the workflow scope to create or update the Inheriti workflow');
    expect(f.errors.join()).toContain('gh auth refresh -h github.com -s workflow');
    expect(f.operations.createConnection).not.toHaveBeenCalled();
    expect(f.writes).toEqual([]);
  });
  it('allows a fine-grained token when the classic scopes header is absent', async () => {
    const f = fixture({ scopes: 'HTTP/2 200\r\ncontent-type: application/json\r\n\r\n{}' });
    expect(await create(f)).toBe(0);
  });
  it.each([{ ghMissing: true, message: 'gh_cli_required' }, { authFails: true, message: 'gh_authentication_required' }])
  ('fails before mutation when GitHub CLI preflight fails', async ({ ghMissing, authFails, message }) => {
    const f = fixture({ ghMissing, authFails });
    expect(await create(f)).toBe(1);
    expect(f.errors.join()).toContain(message);
    expect(f.operations.createConnection).not.toHaveBeenCalled();
    expect(f.writes).toEqual([]);
  });
  it('creates metadata from the current repository without a release, repo write, pairing, or grant', async () => {
    const f = fixture({ releaseFails: true });
    expect(await create(f)).toBe(0);
    expect(f.operations.createConnection).toHaveBeenCalledWith(expect.objectContaining({ trust: {
      method: 'GITHUB_ACTIONS_OIDC', repositoryName: 'owner/repo', environment: 'inheriti',
      workflow: 'owner/repo/.github/workflows/inheriti.yml@refs/heads/main',
    } }));
    expect(f.operations.getVerifiedGithubRelease).not.toHaveBeenCalled();
    expect(f.operations.startPairing).not.toHaveBeenCalled();
    expect(f.writes).toEqual([]);
    noGrants(f);
  });
  it('reuses one exact pending connection', async () => {
    const f = fixture({ connection: { ...selected, status: 'PENDING_VERIFICATION' } });
    expect(await create(f, ['--environment', 'production', '--workflow', 'protected.yml'])).toBe(0);
    expect(f.output.join('\n')).toContain(`Reused GitHub connection ${id}`);
    expect(f.operations.createConnection).not.toHaveBeenCalled();
    noGrants(f);
  });
  it('creates a fresh stable connection after an exact disabled match and reuses it on retry', async () => {
    const f = fixture({ connection: { ...selected, status: 'DISABLED' } });
    expect(await create(f, ['--environment', 'production', '--workflow', 'protected.yml'])).toBe(0);
    const freshId = vi.mocked(f.operations.createConnection).mock.calls[0]?.[0].id;
    expect(freshId).toBeTruthy();
    expect(freshId).not.toBe(id);
    const retry = fixture({ connections: [{ ...selected, status: 'DISABLED' }, { ...selected, id: freshId!, status: 'PENDING_VERIFICATION' }] });
    expect(await create(retry, ['--environment', 'production', '--workflow', 'protected.yml'])).toBe(0);
    expect(retry.operations.createConnection).not.toHaveBeenCalled();
    expect(retry.output.join()).toContain(`Reused GitHub connection ${freshId}`);
    noGrants(f);
  });
  it('reuses a stable ID and accepts only an exact persisted row after a lost create response', async () => {
    const first = fixture();
    let persisted: any;
    vi.mocked(first.operations.createConnection).mockImplementation(async input => {
      persisted = { ...input, status: 'PENDING_VERIFICATION' };
      throw new Error('response lost');
    });
    vi.mocked(first.operations.getConnection).mockImplementation(async () => persisted);
    expect(await create(first)).toBe(0);
    const createdId = vi.mocked(first.operations.createConnection).mock.calls[0]?.[0].id;
    expect(createdId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    const retry = fixture();
    expect(await create(retry)).toBe(0);
    expect(vi.mocked(retry.operations.createConnection).mock.calls[0]?.[0].id).toBe(createdId);
    noGrants(first); noGrants(retry);
  });
  it('reports a failed create when no matching row was persisted', async () => {
    const f = fixture();
    vi.mocked(f.operations.createConnection).mockRejectedValue(new Error('create failed'));
    vi.mocked(f.operations.getConnection).mockRejectedValue(new Error('missing'));
    expect(await create(f)).toBe(1);
    expect(f.errors.join()).toContain('create failed');
    noGrants(f);
  });
});

describe('GitHub workflow setup', () => {
  it('requires workflow scope before applying a workflow for a classic OAuth token', async () => {
    const f = fixture({ scopes: 'HTTP/2 200\r\nx-oauth-scopes: repo, gist\r\n\r\n{}' });
    expect(await setup(f, [...setupArgs, '--apply'])).toBe(1);
    expect(f.errors.join()).toContain('requires the workflow scope to create or update the Inheriti workflow');
    expect(f.errors.join()).toContain('gh auth refresh -h github.com -s workflow');
    expect(f.writes).toEqual([]);
  });
  it('prompts only for missing safe inputs and defaults to preview', async () => {
    const f = fixture({ connection: selected });
    f.terminal.interactive = true;
    const choices = [id, 'account.password', id, 'no'];
    const select = vi.fn(async (_title: string) => choices.shift());
    expect(await githubAutomationSetup(f.context, f.configuration, f.terminal, [], { run: f.run, operations: f.operations, select })).toBe(0);
    expect(select.mock.calls.map(call => call[0])).toEqual(['Which protected plan?', 'Which plan field?', 'Which GitHub connection?', 'Apply this GitHub workflow setup?']);
    expect(f.writes).toEqual([]);
  });
  it('does not prompt again for supplied inputs', async () => {
    const f = fixture();
    f.terminal.interactive = true;
    const select = vi.fn(async (_title: string) => 'no');
    expect(await githubAutomationSetup(f.context, f.configuration, f.terminal, setupArgs, { run: f.run, operations: f.operations, select })).toBe(0);
    expect(select).toHaveBeenCalledOnce();
    expect(select.mock.calls[0]?.[0]).toBe('Apply this GitHub workflow setup?');
  });
  it.each([{ ghMissing: true, message: 'gh_cli_required' }, { authFails: true, message: 'gh_authentication_required' }])
  ('fails before mutation when GitHub CLI preflight fails', async ({ ghMissing, authFails, message }) => {
    const f = fixture({ ghMissing, authFails });
    expect(await setup(f, [...setupArgs, '--apply'])).toBe(1);
    expect(f.errors.join()).toContain(message);
    expect(f.operations.startPairing).not.toHaveBeenCalled();
    expect(f.writes).toEqual([]);
  });
  it('requires a selected connection', async () => {
    const f = fixture();
    expect(await setup(f, ['--plan', id, '--field', 'account.password', '--apply'])).toBe(1);
    expect(f.run).not.toHaveBeenCalled();
    expect(f.operations.createConnection).not.toHaveBeenCalled();
    noGrants(f);
  });
  it('derives environment and filename from the selected connection and previews without mutation', async () => {
    const f = fixture();
    expect(await setup(f)).toBe(0);
    expect(f.output.join('\n')).toContain('protected.yml@main; environment production');
    expect(f.writes).toEqual([]);
    expect(f.operations.createConnection).not.toHaveBeenCalled();
    noGrants(f);
  });
  it('does not create connection or grant on apply of a verified connection', async () => {
    const f = fixture();
    expect(await setup(f, [...setupArgs, '--apply'])).toBe(0);
    expect(f.writes).toEqual(['PUT repos/owner/repo/contents/.github/workflows/protected.yml']);
    expect(f.operations.createConnection).not.toHaveBeenCalled();
    expect(f.operations.startPairing).not.toHaveBeenCalled();
    noGrants(f);
  });
  it('initializes an empty repo using the contents API', async () => {
    const f = fixture({ empty: true });
    expect(await setup(f, [...setupArgs, '--apply'])).toBe(0);
    expect(f.writes).toEqual(['PUT repos/owner/repo/contents/.github/workflows/protected.yml']);
    noGrants(f);
  });
  it('fails closed when release is unavailable or a workflow differs', async () => {
    const missing = fixture({ releaseFails: true });
    expect(await setup(missing, [...setupArgs, '--apply'])).toBe(1);
    expect(missing.writes).toEqual([]);
    const conflict = fixture({ existing: 'other' });
    expect(await setup(conflict, [...setupArgs, '--apply'])).toBe(1);
    expect(conflict.errors.join()).toContain('refusing to overwrite');
    expect(conflict.writes).toEqual([]);
    noGrants(missing); noGrants(conflict);
  });
  it('pairs pending identity once before reporting ready', async () => {
    const f = fixture({ connection: { ...selected, status: 'PENDING_VERIFICATION' } });
    vi.mocked(f.operations.getConnection).mockResolvedValueOnce({ ...selected, status: 'PENDING_VERIFICATION' }).mockResolvedValue(selected);
    expect(await setup(f, [...setupArgs, '--apply'])).toBe(0);
    expect(pairGithubWorkflow).toHaveBeenCalledWith(expect.objectContaining({ connectionId: id, repository: 'owner/repo', workflowPath: '.github/workflows/protected.yml', ref: 'main', retry: false }));
    noGrants(f);
  });
  it('prints each progress phase once and explains how to resume pending pairing', async () => {
    const f = fixture({ connection: { ...selected, status: 'PENDING_VERIFICATION' } });
    pairGithubWorkflow.mockImplementationOnce(async input => {
      input.onProgress?.('verifying'); input.onProgress?.('running'); input.onProgress?.('verifying');
      throw new Error('github_pairing_pending');
    });
    expect(await setup(f, [...setupArgs, '--apply'])).toBe(1);
    expect(f.output.filter(line => line === 'Verifying connection identity…')).toHaveLength(1);
    expect(f.output.filter(line => line === 'Pairing job running…')).toHaveLength(1);
    expect(f.output.join('\n')).not.toContain('Connection verified.');
    expect(f.errors.join('\n')).toContain('Rerun the same setup command to resume');
  });
  it('forwards explicit retry without changing grants', async () => {
    const f = fixture({ connection: { ...selected, status: 'PENDING_VERIFICATION' } });
    pairGithubWorkflow.mockClear();
    expect(await setup(f, [...setupArgs, '--apply', '--retry'])).toBe(0);
    expect(pairGithubWorkflow).toHaveBeenCalledWith(expect.objectContaining({ retry: true }));
    noGrants(f);
  });
  it('stops when current project is not the selected connection repository', async () => {
    const f = fixture({ discoveryFails: true });
    expect(await setup(f, [...setupArgs, '--apply'])).toBe(1);
    expect(f.operations.startPairing).not.toHaveBeenCalled();
    expect(f.writes).toEqual([]);
    noGrants(f);
  });
});
