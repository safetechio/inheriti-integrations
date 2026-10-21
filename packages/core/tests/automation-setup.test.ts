import { describe, expect, it, vi } from 'vitest';
import { createAutomationSetupOperations, githubAutomationWorkflow, githubAutomationWorkflowLocation } from '../src/automation-setup.js';
import type { AutomationSetupOperations } from '../src/automation-setup.js';
import { runLocalAutomationSetupBrowser, runLocalAutomationProofBrowser } from '../src/local-automation-setup-browser.js';

const org = '00000000-0000-4000-8000-000000000001';
const id = '00000000-0000-4000-8000-000000000002';

describe('automation setup', () => {
  it('uses the exact verified repository, workflow file and non-main branch', () => {
    expect(githubAutomationWorkflowLocation('owner/repo', 'owner/repo/.github/workflows/deploy.yml@refs/heads/release/v2')).toEqual({ repository: 'owner/repo', path: '.github/workflows/deploy.yml', branch: 'release/v2' });
    expect(() => githubAutomationWorkflowLocation('owner/repo', 'other/repo/.github/workflows/deploy.yml@refs/heads/release/v2')).toThrow('automation_github_workflow_ref_invalid');
    expect(() => githubAutomationWorkflowLocation('owner/repo', 'owner/repo/.github/workflows/deploy.yml@refs/heads/../main')).toThrow('automation_github_workflow_ref_invalid');
  });
  it('uses only a verified release to print copyable GitHub workflow', async () => {
    const release = { actionRepository: 'safetechio/inheriti-integrations', actionRef: 'a'.repeat(40), cliVersion: '1.2.3' };
    const operations = createAutomationSetupOperations({ apiUrl: 'http://localhost:3400/integrations/', organizationId: org, getBearerToken: async () => 'jwt', fetchImpl: async () => new Response(JSON.stringify({ ok: true, result: release })) });
    expect(await operations.getVerifiedGithubRelease()).toEqual(release);
    const yaml = githubAutomationWorkflow({ release, environment: 'production', planId: id, connectionId: id, selector: 'account.password' });
    expect(yaml).toContain(`uses: safetechio/inheriti-integrations/integrations/github-actions@${'a'.repeat(40)}`);
    expect(yaml).toContain('INHERITI_SECRET=account.password');
    expect(yaml).toContain('run: "test -n \\"$INHERITI_SECRET\\""');
    const devRelease = { ...release, cliVersion: '0.0.14-dev.0' };
    expect(githubAutomationWorkflow({ release: devRelease, environment: 'test', planId: id, connectionId: id, selector: 'account.password' })).toContain('cli-version: "0.0.14-dev.0"');
    await expect(createAutomationSetupOperations({ apiUrl: 'http://localhost:3400/integrations/', organizationId: org, getBearerToken: async () => 'jwt', fetchImpl: async () => new Response(JSON.stringify({ ok: true, result: devRelease })) }).getVerifiedGithubRelease()).resolves.toEqual(devRelease);
    const stgRelease = { ...release, cliVersion: '0.0.14-stg.0' };
    expect(githubAutomationWorkflow({ release: stgRelease, environment: 'staging', planId: id, connectionId: id, selector: 'account.password' })).toContain('cli-version: "0.0.14-stg.0"');
    await expect(createAutomationSetupOperations({ apiUrl: 'http://localhost:3400/integrations/', organizationId: org, getBearerToken: async () => 'jwt', fetchImpl: async () => new Response(JSON.stringify({ ok: true, result: stgRelease })) }).getVerifiedGithubRelease()).resolves.toEqual(stgRelease);
    for (const cliVersion of ['0.0.14-dev.01', '0.0.14-stg.01', '0.0.14-stg.0;echo secret', '0.0.14-dev.0;echo secret', 'latest', '0.0.14-stg']) {
      expect(() => githubAutomationWorkflow({ release: { ...release, cliVersion }, environment: 'test', planId: id, connectionId: id, selector: 'account.password' })).toThrow('Invalid GitHub workflow input');
    }
    expect(githubAutomationWorkflow({ release, environment: 'production', planId: id, connectionId: id, selector: '123-asset.password' })).toContain('INHERITI_SECRET=123-asset.password');
    expect(() => githubAutomationWorkflow({ release: { ...release, actionRef: 'main' }, environment: 'production', planId: id, connectionId: id, selector: 'account.password' })).toThrow();
    expect(() => githubAutomationWorkflow({ release, environment: 'production', planId: id, connectionId: id, selector: 'account.password\nBAD=secret' })).toThrow();
    for (const selector of ['-account.password', 'account-.password', '_account.password', 'account_.password', 'account.-password', 'account.1password', `${'a'.repeat(65)}.password`]) {
      expect(() => githubAutomationWorkflow({ release, environment: 'production', planId: id, connectionId: id, selector })).toThrow('Invalid GitHub workflow input');
    }
    for (const status of [400, 404]) {
      const unavailable = createAutomationSetupOperations({ apiUrl: 'http://localhost:3400/integrations/', organizationId: org, getBearerToken: async () => 'jwt', fetchImpl: async () => new Response('{}', { status }) });
      await expect(unavailable.getVerifiedGithubRelease()).rejects.toThrow('automation_verified_release_unavailable');
      await expect(unavailable.listConnections()).rejects.toThrow(status === 400 ? 'automation_setup_request_failed' : 'automation_setup_permission_denied');
    }
  });
  it('routes management through Elements operator auth with selected organization and exact payload', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: URL | RequestInfo, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
    }) as typeof fetch;
    const operations = createAutomationSetupOperations({ apiUrl: 'http://business.localhost:3400/integrations/', organizationId: org, getBearerToken: async () => 'jwt', fetchImpl });
    await operations.createConnection({ id, name: 'CI', provider: 'GITHUB', environment: 'TEST', trust: { method: 'GITHUB_ACTIONS_OIDC', repositoryName: 'owner/repo', environment: 'test', workflow: 'publish.yml' } });
    await operations.verifyConnection(id, 'secret proof');
    await operations.createGrant(id, { id, connectionId: id, responsibleMemberId: id });
    expect(calls.map(({ url, init }) => [new URL(url).pathname, init.method])).toEqual([
      ['/integrations/v1/automation-connections', 'POST'],
      [`/integrations/v1/automation-connections/${id}/verify-identity`, 'POST'],
      [`/integrations/v1/plans/${id}/automation-grants`, 'POST'],
    ]);
    expect(calls.every(({ init }) => (init.headers as Record<string, string>).Authorization === 'Bearer jwt')).toBe(true);
    expect(calls.every(({ init }) => (init.headers as Record<string, string>)['x-organization-id'] === org && (init.headers as Record<string, string>)['x-elements-environment'] === 'TEST')).toBe(true);
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ proof: 'secret proof' });
    expect(calls[1]!.url).not.toContain('secret proof');
  });

  it('opens an authenticated pairing window and rejects malformed responses', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const pairing = { expiresAt: new Date(Date.now() + 60_000).toISOString() };
    const fetchImpl = vi.fn(async (url: URL | RequestInfo, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return Response.json({ ok: true, result: pairing });
    }) as typeof fetch;
    const operations = createAutomationSetupOperations({ apiUrl: 'https://business.example/integrations/', organizationId: org,
      getBearerToken: async () => 'jwt', fetchImpl });
    expect(await operations.startPairing(id, 'd38f2da2-94c3-4718-8ebd-6ba5e0375a0c')).toEqual(pairing);
    expect(new URL(calls[0]!.url).pathname).toBe(`/integrations/v1/automation-connections/${id}/identity-pairings`);
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ id: 'd38f2da2-94c3-4718-8ebd-6ba5e0375a0c' });
    expect(calls[0]!.init.headers).toMatchObject({ Authorization: 'Bearer jwt', 'x-organization-id': org });
    pairing.expiresAt = new Date(Date.now() - 1_000).toISOString();
    await expect(operations.startPairing(id)).rejects.toThrow('Invalid Business API response');
  });

  it('fails closed on malformed Business envelopes', async () => {
    const operations = createAutomationSetupOperations({ apiUrl: 'http://localhost:3400/integrations/', organizationId: org, getBearerToken: async () => 'jwt', fetchImpl: async () => new Response(JSON.stringify({ ok: false, result: [] })) });
    await expect(operations.listConnections()).rejects.toThrow('Invalid Business API response');
  });

  it('rejects connections whose provider and trust method disagree', async () => {
    const connection = { id, name: 'CI', provider: 'GITHUB', status: 'VERIFIED', trust: { method: 'AWS_IAM_ROLE', roleArn: 'arn:aws:iam::123456789012:role/CI' } };
    const operations = createAutomationSetupOperations({ apiUrl: 'http://localhost:3400/integrations/', organizationId: org, getBearerToken: async () => 'jwt', fetchImpl: async () => new Response(JSON.stringify({ ok: true, result: [connection] })) });
    await expect(operations.listConnections()).rejects.toThrow('Invalid Business API response');
  });

  it('loads every page of eligible members for the responsible picker', async () => {
    const calls: string[] = [];
    const operations = createAutomationSetupOperations({ apiUrl: 'http://localhost:3400/integrations/', organizationId: org, getBearerToken: async () => 'jwt', fetchImpl: async (url) => {
      calls.push(String(url));
      const id = calls.length === 1 ? 'member-a' : 'member-b';
      return new Response(JSON.stringify({ ok: true, result: { items: [{ id, status: 'ACTIVE' }], total: 2 } }));
    } });
    await expect(operations.listMembers()).resolves.toEqual([{ id: 'member-a', status: 'ACTIVE' }, { id: 'member-b', status: 'ACTIVE' }]);
    expect(calls.map((url) => new URL(url).searchParams.get('skip'))).toEqual(['0', '1']);
  });

  it('cancels during initial loading without opening a window', async () => {
    let release!: () => void;
    const loading = new Promise<[]>((resolve) => { release = () => resolve([]); });
    const controller = new AbortController();
    const open = vi.fn();
    const operations = { getVerifiedGithubRelease: vi.fn(),
      listConnections: () => loading, listPlans: async () => [], listMembers: async () => [], listGrants: async () => [],
      getConnection: vi.fn(), createConnection: vi.fn(), verifyConnection: vi.fn(), startPairing: vi.fn(), changeTrust: vi.fn(), disableConnection: vi.fn(), createGrant: vi.fn(), activateGrant: vi.fn(), replaceResponsibleMember: vi.fn(), revokeGrant: vi.fn(),
    };
    const session = runLocalAutomationSetupBrowser({ operations, open, signal: controller.signal });
    controller.abort();
    await expect(session).rejects.toThrow('automation_setup_canceled');
    release();
    expect(open).not.toHaveBeenCalled();
  });

  it('proof-only browser accepts proof by protected POST and returns safe metadata', async () => {
    let opened = '';
    const operations = { getVerifiedGithubRelease: vi.fn(),
      getConnection: async () => ({ id, name: 'CI', provider: 'GITHUB' as const, environment: 'TEST' as const, status: 'PENDING_VERIFICATION', trust: { method: 'GITHUB_ACTIONS_OIDC' as const, repositoryName: 'acme/ci', environment: 'test', workflow: 'ci.yml' } }),
      verifyConnection: vi.fn(async () => {}), startPairing: vi.fn(), listConnections: vi.fn(), listPlans: vi.fn(), listMembers: vi.fn(), listGrants: vi.fn(), createConnection: vi.fn(), changeTrust: vi.fn(), disableConnection: vi.fn(), createGrant: vi.fn(), activateGrant: vi.fn(), replaceResponsibleMember: vi.fn(), revokeGrant: vi.fn(),
    };
    const session = runLocalAutomationProofBrowser({ operations, connectionId: id, open: (url) => { opened = url; } });
    await vi.waitFor(() => expect(opened).not.toBe(''));
    const page = await (await fetch(opened)).text();
    expect(page).toContain('Verify identity');
    expect(page).not.toContain('Create connection');
    expect(page).not.toContain('Plan grants');
    const csrf = page.match(/name="csrf" value="([a-f0-9]+)"/)?.[1] ?? '';
    const headers = { Origin: new URL(opened).origin, 'Content-Type': 'application/x-www-form-urlencoded' };
    const invalid = await fetch(opened, { method: 'POST', headers, body: new URLSearchParams({ csrf, action: 'create', provider: 'GITHUB', name: 'Wrong' }) });
    expect(invalid.status).toBe(400);
    expect(operations.createConnection).not.toHaveBeenCalled();
    await fetch(opened, { method: 'POST', headers, body: new URLSearchParams({ csrf, action: 'verify', connectionId: id, proof: 'signed proof' }) });
    expect(operations.verifyConnection).toHaveBeenCalledWith(id, 'signed proof');
    expect(await session).toEqual({ action: 'verified', id });
    expect(opened).not.toContain('signed proof');
  });

  it('appends the generated connection ID to a Google audience base', async () => {
    let opened = '';
    const operations = { getVerifiedGithubRelease: vi.fn(),
      listConnections: async () => [], listPlans: async () => [], listMembers: async () => [], listGrants: async () => [],
      getConnection: vi.fn(), createConnection: vi.fn(async (_input: Parameters<AutomationSetupOperations['createConnection']>[0]) => {}), verifyConnection: vi.fn(), startPairing: vi.fn(), changeTrust: vi.fn(), disableConnection: vi.fn(), createGrant: vi.fn(), activateGrant: vi.fn(), replaceResponsibleMember: vi.fn(), revokeGrant: vi.fn(),
    };
    const session = runLocalAutomationSetupBrowser({ operations, open: (url) => { opened = url; } });
    await vi.waitFor(() => expect(opened).not.toBe(''));
    const page = await (await fetch(opened)).text();
    expect(page).toContain('Audience base');
    expect(page).toContain('The connection ID is appended automatically.');
    expect(page).toContain('e.g. acme/deploy');
    expect(page).toContain('Use the numeric service account unique ID, not its email.');
    expect(page).toContain('Share only the public key; keep the private key on the runner.');
    expect(page).toContain('Service account subject (numeric unique ID)');
    const csrf = page.match(/name="csrf" value="([a-f0-9]+)"/)?.[1] ?? '';
    const headers = { Origin: new URL(opened).origin, 'Content-Type': 'application/x-www-form-urlencoded' };
    await fetch(opened, { method: 'POST', headers, body: new URLSearchParams({ csrf, action: 'create', provider: 'GOOGLE_CLOUD', name: 'Google CI', deploymentEnvironment: 'TEST', audienceBase: 'https://example.test/runner/', serviceAccountSubject: '123456789' }) });
    const input = operations.createConnection.mock.calls[0]?.[0];
    expect(input).toBeDefined();
    expect(input).toMatchObject({ provider: 'GOOGLE_CLOUD', trust: { method: 'GOOGLE_CLOUD_SERVICE_ACCOUNT_OIDC', serviceAccountSubject: '123456789', audience: `https://example.test/runner/${input!.id}` } });
    await fetch(opened, { method: 'POST', headers, body: new URLSearchParams({ csrf, action: 'done' }) });
    await session;
  });

  it('keeps deployment and provider environments separate, and exposes Portable fields', async () => {
    let opened = '';
    const operations = { getVerifiedGithubRelease: vi.fn(),
      listConnections: async () => [], listPlans: async () => [], listMembers: async () => [], listGrants: async () => [],
      getConnection: vi.fn(), createConnection: vi.fn(async () => {}), verifyConnection: vi.fn(), startPairing: vi.fn(), changeTrust: vi.fn(), disableConnection: vi.fn(), createGrant: vi.fn(), activateGrant: vi.fn(), replaceResponsibleMember: vi.fn(), revokeGrant: vi.fn(),
    };
    const promise = runLocalAutomationSetupBrowser({ operations, open: (url) => { opened = url; } });
    await vi.waitFor(() => expect(opened).not.toBe(''));
    const page = await (await fetch(opened)).text();
    expect(page).toContain('name="deploymentEnvironment"');
    expect(page).toContain('"PORTABLE":"PORTABLE_SIGNED_ASSERTION"');
    expect(page).toContain("['trustEnvironment','Runner environment']");
    const csrf = page.match(/name="csrf" value="([a-f0-9]+)"/)?.[1] ?? '';
    await fetch(opened, { method: 'POST', headers: { Origin: new URL(opened).origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf, action: 'create', provider: 'PORTABLE', name: 'Runner', deploymentEnvironment: 'LIVE', keyId: 'kid', publicKey: 'pub', runnerSubject: 'runner', trustEnvironment: 'ci' }) });
    expect(operations.createConnection).toHaveBeenCalledWith(expect.objectContaining({ environment: 'LIVE', trust: { method: 'PORTABLE_SIGNED_ASSERTION', keyId: 'kid', publicKey: 'pub', runnerSubject: 'runner', environment: 'ci' } }));
    await fetch(opened, { method: 'POST', headers: { Origin: new URL(opened).origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ csrf, action: 'done' }) });
    await promise;
  });

  it('rejects a posted trust method that does not match the connection provider', async () => {
    let opened = '';
    const operations = { getVerifiedGithubRelease: vi.fn(),
      listConnections: async () => [{ id, name: 'CI', provider: 'GITHUB' as const, environment: 'TEST' as const, status: 'VERIFIED', trust: { method: 'GITHUB_ACTIONS_OIDC' as const, repositoryName: 'owner/repo', environment: 'test', workflow: 'publish.yml' } }],
      listPlans: async () => [], listMembers: async () => [], listGrants: async () => [],
      getConnection: vi.fn(), createConnection: vi.fn(), verifyConnection: vi.fn(), startPairing: vi.fn(), changeTrust: vi.fn(), disableConnection: vi.fn(), createGrant: vi.fn(), activateGrant: vi.fn(), replaceResponsibleMember: vi.fn(), revokeGrant: vi.fn(),
    };
    const session = runLocalAutomationSetupBrowser({ operations, open: (url) => { opened = url; }, initialConnectionId: id });
    await vi.waitFor(() => expect(opened).not.toBe(''));
    const page = await (await fetch(opened)).text();
    const csrf = page.match(/name="csrf" value="([a-f0-9]+)"/)?.[1] ?? '';
    const headers = { Origin: new URL(opened).origin, 'Content-Type': 'application/x-www-form-urlencoded' };
    const posted = { csrf, method: 'AWS_IAM_ROLE', roleArn: 'arn:aws:iam::123456789012:role/CI', connectionId: id };
    expect((await fetch(opened, { method: 'POST', headers, body: new URLSearchParams({ ...posted, action: 'create', provider: 'GITHUB', name: 'Wrong' }) })).status).toBe(400);
    expect((await fetch(opened, { method: 'POST', headers, body: new URLSearchParams({ ...posted, action: 'change-trust' }) })).status).toBe(400);
    expect(operations.createConnection).not.toHaveBeenCalled();
    expect(operations.changeTrust).not.toHaveBeenCalled();
    await fetch(opened, { method: 'POST', headers, body: new URLSearchParams({ csrf, action: 'done' }) });
    await session;
  });

  it('uses a local capability path, CSRF, and POST-only proof', async () => {
    let opened = '';
    const operations = { getVerifiedGithubRelease: vi.fn(),
      listConnections: async () => [{ id, name: 'CI', provider: 'GITHUB' as const, environment: 'TEST' as const, status: 'PENDING_VERIFICATION', trust: { method: 'GITHUB_ACTIONS_OIDC' as const, repositoryName: 'owner/repo', environment: 'test', workflow: 'publish.yml' } }],
      listPlans: async () => [], listMembers: async () => [], listGrants: async () => [],
      getConnection: vi.fn(), createConnection: vi.fn(), verifyConnection: vi.fn(), startPairing: vi.fn(), changeTrust: vi.fn(), disableConnection: vi.fn(), createGrant: vi.fn(), activateGrant: vi.fn(), replaceResponsibleMember: vi.fn(), revokeGrant: vi.fn(),
    };
    const promise = runLocalAutomationSetupBrowser({ operations, open: (url) => { opened = url; }, initialConnectionId: id });
    await vi.waitFor(() => expect(opened).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{48}$/));
    const url = new URL(opened);
    const page = await (await fetch(opened)).text();
    expect(page).not.toContain('secret proof');
    expect(page).toContain('Step 2: Verify identity');
    expect(page).toContain(`urn:inheriti:automation:connection:${id}`);
    expect(page).toContain('Connection ID:');
    expect(page).toContain('maxlength="16384"');
    expect(page).toContain('Provide a fresh proof from the configured provider.');
    expect(page).not.toContain('Step 1: Create connection');
    expect((await fetch(opened, { method: 'POST', body: 'action=done' })).status).toBe(403);
    const csrf = page.match(/name="csrf" value="([a-f0-9]+)"/)?.[1];
    const invalid = await fetch(opened, { method: 'POST', headers: { Origin: url.origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `action=verify&csrf=bad&proof=secret` });
    expect(invalid.status).toBe(403);
    expect(operations.verifyConnection).not.toHaveBeenCalled();
    await fetch(opened, { method: 'POST', headers: { Origin: url.origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ action: 'done', csrf: csrf! }) });
    expect(await promise).toEqual({ action: 'done' });
  });
});
