import { expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';

const { listConnections, listGrants, proofBrowser, createConnection, createGrant, activateGrant, getVerifiedGithubRelease, close, complete, windowClosed } = vi.hoisted(() => ({
  listConnections: vi.fn(async () => [{ id: 'connection-1', name: 'CI', provider: 'GITHUB', environment: 'TEST', status: 'ACTIVE', trust: { privateKey: 'NEVER_PRINT' }, verifiedIdentity: 'NEVER_PRINT' }]),
  listGrants: vi.fn(async () => [{ id: 'grant-1', connectionId: 'connection-1', responsibleMemberId: 'member-1', status: 'ACTIVE', proof: 'NEVER_PRINT' }]),
  close: vi.fn(), complete: vi.fn(), windowClosed: { callback: undefined as undefined | ((reason: 'unavailable' | 'closed') => void) },
  proofBrowser: vi.fn(async (_options: { signal: AbortSignal }) => ({ action: 'verified' })),
  createConnection: vi.fn(async () => {}), createGrant: vi.fn(async () => {}), activateGrant: vi.fn(async () => {}),
  getVerifiedGithubRelease: vi.fn(async () => ({ actionRepository: 'safetechio/inheriti-integrations', actionRef: 'a'.repeat(40), cliVersion: '1.2.3' })),
}));
vi.mock('@safetech/inheriti-elements-core/node-base', async original => ({
  ...(await original<object>()),
  createAutomationSetupOperations: () => ({ listConnections, listGrants, createConnection, createGrant, activateGrant, getVerifiedGithubRelease }),
  createNativeWindowSession: (callback: (reason: 'unavailable' | 'closed') => void) => { windowClosed.callback = callback; return { open: vi.fn(), close, complete }; },
  runLocalAutomationProofBrowser: proofBrowser,
}));

import { automationManage, automationMetadata } from '../src/commands/automations.js';

const terminal = (interactive = true) => ({ interactive, stdoutIsTTY: interactive, columns: 80, write: vi.fn(), writeError: vi.fn() });
const context = { organization: { id: 'org-1', name: 'Acme' }, core: { getAccessToken: vi.fn(async () => 'human-token') } };
const configuration = { apiUrl: 'http://business.localhost:3400/integrations/', business: true };

it('prints only allowlisted connection and grant metadata', async () => {
  const output = terminal(false);
  expect(await automationMetadata(context as never, configuration as never, output)).toBe(0);
  expect(await automationMetadata(context as never, configuration as never, output, 'plan-1')).toBe(0);
  const printed = output.write.mock.calls.flat().join('\n');
  expect(printed).toContain('connection-1');
  expect(printed).toContain('member-1');
  expect(printed).not.toContain('NEVER_PRINT');
  expect(listGrants).toHaveBeenCalledWith('plan-1');
});

it('prints GitHub usage only for an active grant and verified connection with exact destination', async () => {
  listConnections.mockResolvedValueOnce([{ id: 'connection-1', name: 'CI', provider: 'GITHUB', status: 'VERIFIED', trust: { method: 'GITHUB_ACTIONS_OIDC', repositoryName: 'owner/repo', environment: 'production', workflow: 'owner/repo/.github/workflows/deploy.yml@refs/heads/release/v2' } }] as never);
  const output = terminal(false);
  expect(await automationManage(context as never, configuration as never, output, new AbortController().signal, ['usage', '--plan', 'plan-1', '--connection', 'connection-1', '--field', '123-asset.password'])).toBe(0);
  const printed = output.write.mock.calls.flat().join('\n');
  expect(printed).toContain('owner/repo/.github/workflows/deploy.yml on branch release/v2');
  expect(printed).toContain(`uses: safetechio/inheriti-integrations/integrations/github-actions@${'a'.repeat(40)}`);
  expect(printed).toContain('INHERITI_SECRET=123-asset.password');
  expect(printed).not.toContain('NEVER_PRINT');
  expect(getVerifiedGithubRelease).toHaveBeenCalledOnce();
});

it('does not print a guessed workflow when the verified release is unavailable', async () => {
  listConnections.mockResolvedValueOnce([{ id: 'connection-1', name: 'CI', provider: 'GITHUB', status: 'VERIFIED', trust: { method: 'GITHUB_ACTIONS_OIDC', repositoryName: 'owner/repo', environment: 'production', workflow: 'owner/repo/.github/workflows/deploy.yml@refs/heads/main' } }] as never);
  getVerifiedGithubRelease.mockRejectedValueOnce(new Error('automation_verified_release_unavailable'));
  const output = terminal(false);
  await expect(automationManage(context as never, configuration as never, output, new AbortController().signal, ['usage', '--plan', 'plan-1', '--connection', 'connection-1', '--field', 'account.password'])).rejects.toThrow('automation_verified_release_unavailable');
  expect(output.write).not.toHaveBeenCalled();
});

it('prints the exact verified runtime package and Dockerfile instruction', async () => {
  getVerifiedGithubRelease.mockResolvedValueOnce({ actionRepository: 'safetechio/inheriti-integrations', actionRef: 'a'.repeat(40), cliVersion: '1.2.3-stg.4' });
  const output = terminal(false);
  expect(await automationManage(context as never, configuration as never, output, new AbortController().signal, ['runtime', 'install-instructions'])).toBe(0);
  const printed = output.write.mock.calls.flat().join('\n');
  expect(printed).toContain('RUN npm install --engine-strict --global @safetech/inheriti-cli@1.2.3-stg.4');
  expect(printed).toContain(`&& test "$(inheriti --version)" = '1.2.3-stg.4'`);
  expect(printed).toContain('IMAGE@sha256:DIGEST');
  expect(printed).not.toContain('NEVER_PRINT');
});

it('does not print installation instructions without a verified release', async () => {
  getVerifiedGithubRelease.mockRejectedValueOnce(new Error('automation_verified_release_unavailable'));
  const output = terminal(false);
  await expect(automationManage(context as never, configuration as never, output, new AbortController().signal, ['runtime', 'install-instructions'])).rejects.toThrow('automation_verified_release_unavailable');
  expect(output.write).not.toHaveBeenCalled();
});

it('requires human authentication before fetching or managing automation', async () => {
  const output = terminal();
  const unsigned = { ...context, core: { getAccessToken: vi.fn(async () => undefined) } };
  expect(await automationMetadata(unsigned as never, configuration as never, output)).toBe(1);
  expect(await automationManage(unsigned as never, configuration as never, output, new AbortController().signal, ['verify', '--connection', 'connection-1'])).toBe(1);
  expect(output.writeError).toHaveBeenCalledWith('Sign in before managing automations.');
});

it('rejects secret options before opening verification', async () => {
  const output = terminal();
  expect(await automationManage(context as never, configuration as never, output, new AbortController().signal, ['verify', '--connection', 'connection-1', '--proof', 'secret'])).toBe(1);
  expect(output.writeError).toHaveBeenCalledWith(expect.stringContaining('Usage: inheriti automations'));
});

it('passes window closure and CLI cancellation to proof browser and closes on failure', async () => {
  const output = terminal();
  proofBrowser.mockImplementationOnce(async ({ signal }: { signal: AbortSignal }) => {
    windowClosed.callback?.('closed');
    expect(signal.aborted).toBe(true);
    throw new Error('canceled');
  });
  await expect(automationManage(context as never, configuration as never, output, new AbortController().signal, ['verify', '--connection', 'connection-1'])).rejects.toThrow('canceled');
  expect(close).toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
});

it('creates a connection from nonsecret provider fields and prints only its ID', async () => {
  const output = terminal(false);
  expect(await automationManage(context as never, configuration as never, output, new AbortController().signal,
    ['create', '--id', 'connection-2', '--name', 'Deploy', '--provider', 'GITHUB', '--deployment-environment', 'TEST', '--repository', 'acme/deploy', '--environment', 'test', '--workflow', 'deploy.yml'])).toBe(0);
  expect(createConnection).toHaveBeenCalledWith(expect.objectContaining({ id: 'connection-2', trust: { method: 'GITHUB_ACTIONS_OIDC', repositoryName: 'acme/deploy', environment: 'test', workflow: 'deploy.yml' } }));
  expect(output.write.mock.calls.flat().join('\n')).not.toContain('deploy.yml');
  expect(output.write.mock.calls.flat()).toContain('Expected audience: urn:inheriti:automation:connection:connection-2');
});

it('appends the connection ID once to a Google audience base with trailing slashes', async () => {
  const output = terminal(false);
  expect(await automationManage(context as never, configuration as never, output, new AbortController().signal,
    ['create', '--id', 'connection-google', '--name', 'GCP', '--provider', 'GOOGLE_CLOUD', '--deployment-environment', 'TEST', '--audience-base', 'https://example.com/workload///', '--subject', '123456789'])).toBe(0);
  expect(createConnection).toHaveBeenCalledWith(expect.objectContaining({ trust: { method: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC', audience: 'https://example.com/workload/connection-google', serviceAccountSubject: '123456789' } }));
  expect(output.write.mock.calls.flat()).toContain('Expected audience: https://example.com/workload/connection-google');
});

it('accepts a multiline Portable PEM public key without changing its newlines', async () => {
  const publicKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const output = terminal(false);
  expect(await automationManage(context as never, configuration as never, output, new AbortController().signal,
    ['create', '--id', 'portable-1', '--name', 'Runner', '--provider', 'PORTABLE', '--deployment-environment', 'TEST', '--key-id', 'key-1', '--public-key', publicKey, '--subject', 'runner-1', '--environment', 'test'])).toBe(0);
  expect(createConnection).toHaveBeenCalledWith(expect.objectContaining({ trust: expect.objectContaining({ publicKey }) }));
  expect(output.write.mock.calls.flat().join('\n')).not.toContain(publicKey);
  expect(await automationManage(context as never, configuration as never, output, new AbortController().signal,
    ['create', '--name', 'Runner', '--provider', 'PORTABLE', '--deployment-environment', 'TEST', '--key-id', 'key-1', '--public-key', '--subject', 'runner-1', '--environment', 'test'])).toBe(1);
});

it('refuses proof flags and passes identity verification to the secure window', async () => {
  const output = terminal();
  expect(await automationManage(context as never, configuration as never, output, new AbortController().signal, ['verify', '--connection', 'connection-1', '--proof', 'NEVER_PRINT'])).toBe(1);
  expect(proofBrowser).not.toHaveBeenCalled();
  expect(await automationManage(context as never, configuration as never, output, new AbortController().signal, ['verify', '--connection', 'connection-1'])).toBe(0);
  expect(proofBrowser).toHaveBeenCalledWith(expect.objectContaining({ connectionId: 'connection-1', operations: expect.anything(), signal: expect.any(AbortSignal) }));
  expect(output.write.mock.calls.flat().join('\n')).not.toContain('NEVER_PRINT');
  expect(output.write.mock.calls.flat()).toContain('Identity verified for connection connection-1.');
});

it('does not report success when the proof window is closed without verification', async () => {
  proofBrowser.mockResolvedValueOnce({ action: 'done' });
  const output = terminal();
  expect(await automationManage(context as never, configuration as never, output, new AbortController().signal, ['verify', '--connection', 'connection-1'])).toBe(1);
  expect(output.write.mock.calls.flat()).toContain('Identity verification canceled.');
  expect(output.write.mock.calls.flat().join('\n')).not.toContain('Identity verified');
});

it('creates and activates a grant with explicit nonsecret IDs', async () => {
  const output = terminal(false);
  expect(await automationManage(context as never, configuration as never, output, new AbortController().signal,
    ['grant', 'create', '--plan', 'plan-1', '--connection', 'connection-1', '--member', 'member-1', '--id', 'grant-2'])).toBe(0);
  expect(createGrant).toHaveBeenCalledWith('plan-1', { id: 'grant-2', connectionId: 'connection-1', responsibleMemberId: 'member-1' });
  expect(await automationManage(context as never, configuration as never, output, new AbortController().signal,
    ['grant', 'activate', '--plan', 'plan-1', '--grant', 'grant-2'])).toBe(0);
  expect(activateGrant).toHaveBeenCalledWith('plan-1', 'grant-2');
  expect(output.write.mock.calls.flat()).toContain('Grant created: grant-2');
  expect(output.write.mock.calls.flat()).toContain('Grant activated: grant-2');
});
