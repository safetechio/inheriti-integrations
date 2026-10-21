import { expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const mock = vi.hoisted(() => ({
  connections: vi.fn(), grants: vi.fn(), members: vi.fn(), browser: vi.fn(), open: vi.fn(), close: vi.fn(), complete: vi.fn(),
  createConnection: vi.fn(), changeTrust: vi.fn(), disableConnection: vi.fn(), createGrant: vi.fn(), activateGrant: vi.fn(), replaceResponsibleMember: vi.fn(), revokeGrant: vi.fn(),
  getConnection: vi.fn(), getVerifiedGithubRelease: vi.fn(), startPairing: vi.fn(),
}));
vi.mock('@safetech/inheriti-elements-core/node-base', async importOriginal => ({
  ...await importOriginal<typeof import('@safetech/inheriti-elements-core/node-base')>(),
  createAutomationSetupOperations: () => ({ listConnections: mock.connections, listGrants: mock.grants, listMembers: mock.members, getConnection: mock.getConnection, getVerifiedGithubRelease: mock.getVerifiedGithubRelease, startPairing: mock.startPairing, createConnection: mock.createConnection,
    changeTrust: mock.changeTrust, disableConnection: mock.disableConnection, createGrant: mock.createGrant,
    activateGrant: mock.activateGrant, replaceResponsibleMember: mock.replaceResponsibleMember, revokeGrant: mock.revokeGrant }),
  runLocalAutomationProofBrowser: mock.browser,
  createNativeWindowSession: () => ({ open: mock.open, close: mock.close, complete: mock.complete }),
}));

import { MetadataTools, createServer, safeResult } from '../src/server.js';
import { registerGetAutomationRuntimeInstallInstructions } from '../src/tools/get_automation_runtime_install_instructions.js';
import { registerGithubAutomationUsage } from '../src/tools/github_automation_usage.js';

const setup = (apiUrl = 'http://business.localhost:3400', deployment = 'local') => {
  const tools = new MetadataTools() as any;
  tools.config = { apiUrl, deployment, environment: 'TEST' };
  tools.selected = async () => ({ organizationId: 'org', core: { getAccessToken: async () => 'private-token' } });
  return tools;
};

it('rejects disabled automation without opening a window', async () => {
  const tools = setup('https://business-api.inheriti.com/integrations/', 'prod');
  expect(await safeResult(() => tools.startAutomationSetup('connection'))({})).toEqual({ isError: true, content: [{ type: 'text', text: 'automation_local_only' }] });
  expect(await safeResult(() => tools.createAutomationConnection({ name: 'Runner', provider: 'AWS', environment: 'TEST', trust: { method: 'AWS_IAM_ROLE', roleArn: 'arn' } }))({})).toEqual({ isError: true, content: [{ type: 'text', text: 'automation_local_only' }] });
  expect(mock.browser).not.toHaveBeenCalled();
  expect(mock.createConnection).not.toHaveBeenCalled();
});

it('allows automation only in local and dev deployments', async () => {
  mock.connections.mockResolvedValue([]);
  for (const [deployment, apiUrl] of [
    ['local', 'http://business.localhost:3400/integrations/'],
    ['dev', 'https://business-api-dev.inheriti.com/integrations/'],
  ]) {
    await expect(setup(apiUrl, deployment).listAutomationConnections()).resolves.toEqual({ organizationId: 'org', items: [] });
  }
  for (const [deployment, apiUrl] of [
    ['stg', 'https://business-api-stg.inheriti.com/integrations/'],
    ['prod', 'https://business-api.inheriti.com/integrations/'],
    ['invalid', 'https://business.example.com'],
  ]) {
    await expect(setup(apiUrl, deployment).listAutomationConnections()).rejects.toMatchObject({ code: 'automation_local_only' });
  }
});

it('returns only allowlisted connection and grant metadata', async () => {
  const tools = setup();
  mock.connections.mockResolvedValue([{ id: 'connection', name: 'Runner', provider: 'PORTABLE', environment: 'TEST', status: 'ACTIVE', trust: { publicKey: 'private-looking' }, proof: 'proof' }]);
  mock.grants.mockResolvedValue([{ id: 'grant', planId: 'plan', connectionId: 'connection', responsibleMemberId: 'member', status: 'ACTIVE', proof: 'proof' }]);
  mock.members.mockResolvedValue([{ id: 'member', firstName: 'Alex', lastName: 'Rivera', status: 'ACTIVE', email: 'private@example.test', masterKeyStatus: 'ACTIVE' }]);
  expect(await tools.listAutomationConnections()).toEqual({ organizationId: 'org', items: [{ id: 'connection', name: 'Runner', provider: 'PORTABLE', environment: 'TEST', status: 'ACTIVE' }] });
  expect(await tools.listAutomationGrants('plan')).toEqual({ organizationId: 'org', planId: 'plan', items: [{ id: 'grant', connectionId: 'connection', responsibleMemberId: 'member', status: 'ACTIVE' }] });
  expect(await tools.listAutomationMembers()).toEqual({ organizationId: 'org', items: [{ id: 'member', displayName: 'Alex Rivera', status: 'ACTIVE' }] });
});

it('registers GitHub usage tool and returns verified workflow destination and YAML', async () => {
  mock.grants.mockResolvedValueOnce([{ id: 'grant', planId: 'plan', connectionId: 'connection', status: 'ACTIVE', responsibleMemberId: 'member' }]);
  mock.getConnection.mockResolvedValueOnce({ id: 'connection', name: 'CI', provider: 'GITHUB', status: 'VERIFIED', trust: { method: 'GITHUB_ACTIONS_OIDC', repositoryName: 'owner/repo', environment: 'production', workflow: 'owner/repo/.github/workflows/deploy.yml@refs/heads/release/v2' } });
  mock.getVerifiedGithubRelease.mockResolvedValueOnce({ actionRepository: 'safetechio/inheriti-integrations', actionRef: 'a'.repeat(40), cliVersion: '1.2.3' });
  const registered = new Map<string, (input: unknown) => Promise<unknown>>();
  const operations = vi.spyOn(MetadataTools.prototype as never, 'automationOperations').mockResolvedValue({ organizationId: 'org', operations: { listGrants: mock.grants, getConnection: mock.getConnection, getVerifiedGithubRelease: mock.getVerifiedGithubRelease } } as never);
  const registration = vi.spyOn(McpServer.prototype, 'registerTool').mockImplementation(((name: string, _schema: unknown, handler: (input: unknown) => Promise<unknown>) => { registered.set(name, handler); return {} as never; }) as never);
  let result: unknown;
  try {
    registerGithubAutomationUsage(new McpServer({ name: 'test', version: '0' }), setup());
    result = await registered.get('github_automation_usage')!({ planId: 'plan', connectionId: 'connection', field: '123-asset.password' });
  } finally { operations.mockRestore(); registration.mockRestore(); }
  const text = (result as { content: { text: string }[] }).content[0]!.text;
  expect(JSON.parse(text)).toMatchObject({ location: { repository: 'owner/repo', path: '.github/workflows/deploy.yml', branch: 'release/v2' }, workflow: expect.stringContaining('INHERITI_SECRET=123-asset.password') });
  expect(text).toContain('github-actions@' + 'a'.repeat(40));
  expect(text).not.toContain('private-token');
});

it('returns verified runtime installation instructions without release channel input', async () => {
  mock.getVerifiedGithubRelease.mockResolvedValueOnce({ actionRepository: 'safetechio/inheriti-integrations', actionRef: 'a'.repeat(40), cliVersion: '1.2.3-stg.4' });
  const operations = vi.spyOn(MetadataTools.prototype as never, 'automationOperations').mockResolvedValue({ organizationId: 'org', operations: { getVerifiedGithubRelease: mock.getVerifiedGithubRelease } } as never);
  try {
    const result = await setup().getAutomationRuntimeInstallInstructions();
    expect(result).toMatchObject({ organizationId: 'org', packageSpec: '@safetech/inheriti-cli@1.2.3-stg.4', prerequisite: expect.stringContaining('engines metadata'), dockerfile: expect.stringContaining('npm install --engine-strict --global @safetech/inheriti-cli@1.2.3-stg.4'), instruction: expect.stringContaining('IMAGE@sha256:DIGEST') });
    expect(JSON.stringify(result)).not.toContain('private-token');
    mock.getVerifiedGithubRelease.mockRejectedValueOnce(new Error('automation_verified_release_unavailable'));
    await expect(setup().getAutomationRuntimeInstallInstructions()).rejects.toThrow('automation_verified_release_unavailable');
  } finally { operations.mockRestore(); }
});

it('keeps runtime installation tool hidden while automation is disabled', () => {
  const names: string[] = [];
  const registration = vi.spyOn(McpServer.prototype, 'registerTool').mockImplementation(((name: string) => { names.push(name); return {} as never; }) as never);
  try { createServer(); } finally { registration.mockRestore(); }
  expect(names).not.toContain('get_automation_runtime_install_instructions');
});

it('registers a zero-input runtime installation tool', () => {
  const registerTool = vi.fn();
  registerGetAutomationRuntimeInstallInstructions({ registerTool } as never, setup());
  expect(registerTool).toHaveBeenCalledWith(
    'get_automation_runtime_install_instructions',
    expect.objectContaining({ inputSchema: expect.any(Object) }),
    expect.any(Function),
  );
  expect(registerTool.mock.calls[0]?.[1].inputSchema.safeParse({}).success).toBe(true);
  expect(registerTool.mock.calls[0]?.[1].inputSchema.safeParse({ deployment: 'prod' }).success).toBe(false);
});

it('cancels an active window and reports safe status', async () => {
  const tools = setup();
  mock.browser.mockImplementation(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('private proof')), { once: true })));
  const { jobId } = await tools.startAutomationSetup('connection');
  expect((await tools.automationSetupStatus(jobId)).status).toBe('WAITING');
  expect(mock.browser.mock.calls.at(-1)?.[0]).toMatchObject({ connectionId: 'connection', operations: expect.any(Object), signal: expect.any(AbortSignal) });
  await tools.cancelAutomationJob();
  expect(await tools.automationSetupStatus(jobId)).toEqual({ jobId, status: 'CANCELED', phase: 'CANCELED' });
  expect(mock.close).toHaveBeenCalled();
});

it('starts server-side pairing without returning a proof or local ticket', async () => {
  const tools = setup();
  mock.startPairing.mockResolvedValue({ expiresAt: '2030-01-01T00:00:00.000Z' });
  const result = await tools.startAutomationPairing('connection');
  expect(result).toMatchObject({ organizationId: 'org', connectionId: 'connection', expiresAt: '2030-01-01T00:00:00.000Z' });
  expect(JSON.stringify(result)).not.toMatch(/ticket|proof.*:/i);
  expect(mock.startPairing).toHaveBeenCalledWith('connection');
});

it('cancels automation setup on logout', async () => {
  const tools = setup();
  mock.browser.mockImplementation(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('private proof')), { once: true })));
  const { jobId } = await tools.startAutomationSetup('connection');
  expect(await tools.logout()).toEqual({ signedOut: true });
  expect(await tools.automationSetupStatus(jobId)).toEqual({ jobId, status: 'CANCELED', phase: 'CANCELED' });
});

it('creates a connection with nonsecret trust and returns no trust or proof', async () => {
  const tools = setup();
  const trust = { method: 'AWS_IAM_ROLE', roleArn: 'arn:aws:iam::123:role/runner' };
  const result = await tools.createAutomationConnection({ name: 'Runner', provider: 'AWS', environment: 'TEST', trust });
  expect(mock.createConnection).toHaveBeenCalledWith({ id: result.connectionId, name: 'Runner', provider: 'AWS', environment: 'TEST', trust });
  expect(result).toEqual({ organizationId: 'org', connectionId: result.connectionId, status: 'PENDING_VERIFICATION', instruction: expect.stringContaining('Start one-use workload pairing') });
});

it('appends the generated connection ID to Google audience base and returns the exact audience', async () => {
  const tools = setup();
  const result = await tools.createAutomationConnection({ name: 'Google runner', provider: 'GOOGLE_CLOUD', environment: 'TEST',
    trust: { method: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC', audienceBase: 'https://example.test/workload/', serviceAccountSubject: '1234567890' } });
  expect(mock.createConnection).toHaveBeenLastCalledWith(expect.objectContaining({ trust: {
    method: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC', audience: `https://example.test/workload/${result.connectionId}`, serviceAccountSubject: '1234567890',
  } }));
  expect(result.expectedAudience).toBe(`https://example.test/workload/${result.connectionId}`);
  mock.getConnection.mockResolvedValueOnce({ provider: 'GOOGLE_CLOUD' });
  const changed = await tools.changeAutomationTrust('existing', { method: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC', audienceBase: 'https://example.test/workload', serviceAccountSubject: '1234567890' });
  expect(mock.changeTrust).toHaveBeenLastCalledWith('existing', { method: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC', audience: 'https://example.test/workload/existing', serviceAccountSubject: '1234567890' });
  expect(changed.expectedAudience).toBe('https://example.test/workload/existing');
});

it('rejects provider and trust mismatches before changing a connection', async () => {
  const tools = setup();
  mock.changeTrust.mockClear();
  mock.createConnection.mockClear();
  const trust = { method: 'AWS_IAM_ROLE' as const, roleArn: 'arn:aws:iam::123:role/runner' };
  await expect(tools.createAutomationConnection({ name: 'Runner', provider: 'GITHUB', environment: 'TEST', trust })).rejects.toMatchObject({ code: 'automation_provider_trust_mismatch' });
  expect(mock.createConnection).not.toHaveBeenCalled();
  mock.getConnection.mockResolvedValueOnce({ provider: 'GITHUB' });
  await expect(tools.changeAutomationTrust('existing', trust)).rejects.toMatchObject({ code: 'automation_provider_trust_mismatch' });
  expect(mock.changeTrust).not.toHaveBeenCalled();
});

it('does not report completion when the proof window ends without verification', async () => {
  const tools = setup();
  mock.browser.mockResolvedValueOnce({ action: 'done' });
  const { jobId } = await tools.startAutomationSetup('connection');
  await vi.waitFor(async () => expect((await tools.automationSetupStatus(jobId)).status).toBe('CANCELED'));
});

it('routes grant changes through Business operations and returns IDs only', async () => {
  const tools = setup();
  const created = await tools.manageAutomationGrant('create', 'plan', { connectionId: 'connection', responsibleMemberId: 'member' });
  expect(mock.createGrant).toHaveBeenCalledWith('plan', { id: created.grantId, connectionId: 'connection', responsibleMemberId: 'member' });
  await tools.manageAutomationGrant('activate', 'plan', { grantId: created.grantId });
  await tools.manageAutomationGrant('replace', 'plan', { grantId: created.grantId, responsibleMemberId: 'other' });
  await tools.manageAutomationGrant('revoke', 'plan', { grantId: created.grantId });
  expect(mock.activateGrant).toHaveBeenCalledWith('plan', created.grantId);
  expect(mock.replaceResponsibleMember).toHaveBeenCalledWith('plan', created.grantId, 'other');
  expect(mock.revokeGrant).toHaveBeenCalledWith('plan', created.grantId);
  expect(created).toEqual({ organizationId: 'org', planId: 'plan', grantId: created.grantId, action: 'create' });
});
