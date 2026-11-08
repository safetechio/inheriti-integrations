import { beforeEach, expect, it, vi } from 'vitest';
import { githubAutomationDevWorkflow } from '@safetech/inheriti-elements-core/node-base';
import { githubAutomationSetup } from '../src/commands/github-automation-setup.js';
import type { AutomationSetupOperations } from '@safetech/inheriti-elements-core/node-base';
const { pairGithubWorkflow } = vi.hoisted(() => ({ pairGithubWorkflow: vi.fn(async (input: { prepare: () => Promise<void> }) => {
  await input.prepare(); return { status: 'VERIFIED' as const, pairingId: 'pairing' };
}) }));
vi.mock('../src/commands/github-workflow-pairing.js', () => ({ pairGithubWorkflow }));

const { loadGithubDevArtifact, uploadGithubDevArtifact } = vi.hoisted(() => ({
  loadGithubDevArtifact: vi.fn(async () => ({ profile: { schema: 1, deployment: 'dev', tarball: '/tmp/cli.tgz',
    cliVersion: '0.0.24-dev.1', sha256: 'a'.repeat(64), artifactApiUrl: 'http://127.0.0.1:3400/',
    downloadOrigin: 'https://tunnel.example' }, bytes: Buffer.from('archive') })),
  uploadGithubDevArtifact: vi.fn(async () => 'https://tunnel.example/test/cli-artifacts/artifact?expires=123&signature=SENSITIVE'),
}));
vi.mock('../src/configuration.js', async original => ({ ...(await original<object>()), BUILD_DEPLOYMENT: 'dev' }));
vi.mock('../src/commands/github-dev-artifact.js', () => ({ loadGithubDevArtifact, uploadGithubDevArtifact }));
const id = '3a37e640-7588-433c-b922-6d0476f5caa0';
const selected = { id, name: 'DEV', provider: 'GITHUB' as const, environment: 'TEST' as const, status: 'VERIFIED',
  trust: { method: 'GITHUB_ACTIONS_OIDC' as const, repositoryName: 'owner/repo', environment: 'inheriti',
    workflow: 'owner/repo/.github/workflows/inheriti.yml@refs/heads/main' } };
const args = ['--connection', id, '--plan', id, '--field', 'account.password'];
function fixture(existing?: string) {
  const output: string[] = [];
  const errors: string[] = [];
  const writes: { args: string[]; body?: unknown }[] = [];
  const run = vi.fn(async (command: string[], body?: unknown) => {
    const path = command[1] ?? '';
    if (command[0] === '--version' || command[0] === 'auth') return undefined;
    if (command[0] === 'api' && path === 'user' && command.includes('--include')) return 'HTTP/2 200\r\nx-oauth-scopes: repo, workflow\r\n\r\n{}';
    if (command[0] === 'repo') return { nameWithOwner: 'owner/repo' };
    if (command[0] === 'secret') { writes.push({ args: command, body }); return undefined; }
    if (command.includes('--method')) { writes.push({ args: command, body }); return { sha: 'b'.repeat(40) }; }
    if (path === 'repos/owner/repo') return { full_name: 'owner/repo', default_branch: 'main', permissions: { push: true } };
    if (path.includes('/contents/')) {
      if (existing) return { encoding: 'base64', content: Buffer.from(existing).toString('base64'), sha: 'c'.repeat(40) };
      throw new Error('404');
    }
    if (path.includes('/git/ref/')) return { ref: 'refs/heads/main' };
    throw new Error(`Unexpected ${path}`);
  });
  const operations = { getVerifiedGithubRelease: vi.fn(), getConnection: vi.fn(async () => selected),
    createConnection: vi.fn(), startPairing: vi.fn(), listGrants: vi.fn(), createGrant: vi.fn(), activateGrant: vi.fn() } as unknown as AutomationSetupOperations;
  const context = { organization: { id }, core: { getAccessToken: async () => 'token',
    getPlan: async () => ({ assets: [{ id: 'one', code: 'account', fieldNames: ['password'] }] }) } } as any;
  const configuration = { apiUrl: 'http://127.0.0.1:3400/', deployment: 'dev' } as any;
  const terminal = { write: (s: string) => output.push(s), writeError: (s: string) => errors.push(s), interactive: false } as any;
  return { run, operations, context, configuration, terminal, output, errors, writes };
}
const setup = (f: ReturnType<typeof fixture>, flags: string[] = []) => githubAutomationSetup(f.context, f.configuration, f.terminal, [...args, ...flags], { run: f.run, operations: f.operations });
beforeEach(() => { loadGithubDevArtifact.mockClear(); uploadGithubDevArtifact.mockClear(); });
it('DEV preview validates profile but does not upload, store a secret, or commit', async () => {
  const f = fixture();
  expect(await setup(f)).toBe(0);
  expect(loadGithubDevArtifact).toHaveBeenCalledOnce();
  expect(f.operations.getVerifiedGithubRelease).not.toHaveBeenCalled();
  expect(uploadGithubDevArtifact).not.toHaveBeenCalled();
  expect(f.writes).toEqual([]);
});
it('does not upload, replace a workflow, or change a secret when a pending attempt owns another digest', async () => {
  const f = fixture();
  pairGithubWorkflow.mockRejectedValueOnce(new Error('github_pairing_workflow_changed'));
  expect(await setup(f, ['--apply'])).toBe(1);
  expect(f.errors.join()).toContain('github_pairing_workflow_changed');
  expect(uploadGithubDevArtifact).not.toHaveBeenCalled();
  expect(f.writes).toEqual([]);
});
it('does not bypass the verified release gate outside DEV configuration', async () => {
  const f = fixture();
  f.configuration.deployment = 'stg';
  vi.mocked(f.operations.getVerifiedGithubRelease).mockRejectedValue(new Error('release unavailable'));
  expect(await setup(f, ['--apply'])).toBe(1);
  expect(loadGithubDevArtifact).not.toHaveBeenCalled();
  expect(f.writes).toEqual([]);
});
it('DEV apply commits before storing signed URL through raw stdin', async () => {
  const f = fixture();
  expect(await setup(f, ['--apply'])).toBe(0);
  expect(uploadGithubDevArtifact).toHaveBeenCalledOnce();
  expect(f.writes[0]?.args).toContain('PUT');
  expect(f.writes[1]?.args).toEqual(['secret', 'set', 'INHERITI_DEV_CLI_3A37E6407588433CB9226D0476F5CAA0', '--repo', 'owner/repo']);
  expect(Buffer.isBuffer(f.writes[1]?.body)).toBe(true);
  expect((f.writes[1]?.body as Buffer).toString('utf8')).toContain('signature=SENSITIVE');
  expect(JSON.stringify(f.output)).not.toContain('SENSITIVE');
  expect(f.operations.getVerifiedGithubRelease).not.toHaveBeenCalled();
  expect(f.operations.startPairing).not.toHaveBeenCalled();
});
it('refreshes the artifact secret for an unchanged verified workflow without new commit or pairing', async () => {
  const existing = githubAutomationDevWorkflow({ environment: 'inheriti', planId: id, connectionId: id,
    selector: 'account.password', artifact: { cliVersion: '0.0.24-dev.1', sha256: 'a'.repeat(64), downloadOrigin: 'https://tunnel.example' } });
  const f = fixture(existing);
  expect(await setup(f, ['--apply'])).toBe(0);
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0]?.args[0]).toBe('secret');
  expect(f.operations.startPairing).not.toHaveBeenCalled();
});
it('replaces only pristine managed DEV workflow with an atomic SHA', async () => {
  const existing = githubAutomationDevWorkflow({ environment: 'inheriti', planId: id, connectionId: id,
    selector: 'account.password', artifact: { cliVersion: '0.0.24-dev.0', sha256: 'b'.repeat(64), downloadOrigin: 'https://tunnel.example' } });
  const f = fixture(existing);
  expect(await setup(f, ['--apply'])).toBe(0);
  expect(f.writes[0]?.body).toMatchObject({ sha: 'c'.repeat(40) });
  const edited = fixture(`${existing}# manual edit\n`);
  expect(await setup(edited, ['--apply'])).toBe(1);
  expect(edited.writes).toEqual([]);
});
