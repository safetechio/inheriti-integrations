import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { MetadataTools, safeResult } from '../src/server.js';
import { beginBrowserLogin } from '../src/browser-login.js';

vi.mock('../src/safekey-pro.js', () => ({ openSafeKeyProPrompt: async () => ({ selectCustodianDevice: () => 'SK_MOBILE', close: () => undefined }) }));
vi.mock('../src/browser-login.js', () => ({ beginBrowserLogin: vi.fn() }));

it.each([{ operator: 'revoked-org' }, {}])('forgets held keys when organization membership is revoked with preferences %j', async preferences => {
  const preferenceCount = Object.keys(preferences).length;
  const tools = new MetadataTools();
  const controller = new AbortController();
  const forgetMasterKey = vi.fn();
  const save = vi.fn();
  Object.assign(tools, {
    scoped: { organizationId: 'revoked-org', core: { forgetMasterKey } },
    job: { status: 'WAITING', controller, done: Promise.resolve() },
    ready: async () => ({ core: { listOrganizations: async () => [] } }),
    key: async () => 'operator',
    preferences: async () => preferences,
    save,
  });
  expect(await tools.listOrganizations()).toEqual({ items: [], selectedId: null });
  expect(controller.signal.aborted).toBe(true);
  expect(forgetMasterKey).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledTimes(preferenceCount);
  if (preferenceCount) expect(save).toHaveBeenCalledWith({});
});

it('allows organization selection after a finished cancellation failure without hiding its outcome', async () => {
  const tools = new MetadataTools();
  const job = { status: 'FAILED', code: 'reveal_cancellation_failed' };
  const save = vi.fn();
  Object.assign(tools, {
    job,
    ready: async () => ({ core: { listOrganizations: async () => [{ id: 'org-1', name: 'Org' }] } }),
    key: async () => 'operator',
    preferences: async () => ({}),
    save,
  });
  expect(await tools.selectOrganization('org-1')).toEqual({ selectedId: 'org-1' });
  expect(save).toHaveBeenCalledWith({ operator: 'org-1' });
  expect(job).toEqual({ status: 'FAILED', code: 'reveal_cancellation_failed' });
});

it('cancels a plan assistant job on organization switch without a reveal job', async () => {
  const tools = new MetadataTools() as any;
  const controller = new AbortController();
  tools.planJob = { id: 'job', status: 'WAITING', phase: 'WINDOW', controller, done: Promise.resolve() };
  tools.ready = async () => ({ core: { listOrganizations: async () => [{ id: 'org-1', name: 'Org' }] } });
  tools.key = async () => 'operator';
  tools.preferences = async () => ({});
  tools.save = async () => undefined;
  expect(await tools.selectOrganization('org-1')).toEqual({ selectedId: 'org-1' });
  expect(controller.signal.aborted).toBe(true);
});

it('returns only safe plan creation status fields', async () => {
  const tools = new MetadataTools() as any;
  tools.planJob = { id: 'job', status: 'PENDING', phase: 'COMPLETE', planId: 'plan-1', controller: new AbortController(), done: Promise.resolve(), secret: 'hidden' };
  expect(await tools.planCreationStatus('job')).toEqual({ jobId: 'job', status: 'PENDING', phase: 'COMPLETE', planId: 'plan-1' });
});

it('uses the selected organization core for plan logs and returns the safe page', async () => {
  const tools = new MetadataTools() as any;
  const listPlanLogs = vi.fn().mockResolvedValue({ items: [{ id: 'log-1', event: 'PLAN_UPDATED', details: [] }], total: 1 });
  tools.selected = async () => ({ organizationId: 'org-1', core: { listPlanLogs } });
  expect(await tools.listPlanLogs('plan-1', 5, 10)).toEqual({ organizationId: 'org-1', items: [{ id: 'log-1', event: 'PLAN_UPDATED', details: [] }], total: 1 });
  expect(listPlanLogs).toHaveBeenCalledWith('plan-1', { limit: 5, offset: 10 });
});

it('uses the selected organization core for filtered member logs', async () => {
  const tools = new MetadataTools() as any;
  const page = { items: [{ id: 'log-1', memberId: 'member-1', source: 'AUTOMATION', event: 'AUTOMATION_CREATED', occurredOn: '2026-10-15T00:00:00Z' }], total: 1 };
  const listMemberLogs = vi.fn().mockResolvedValue(page);
  tools.selected = async () => ({ organizationId: 'org-1', core: { listMemberLogs } });
  expect(await tools.listMemberLogs('member-1', { source: 'AUTOMATION', limit: 5 })).toEqual({ organizationId: 'org-1', ...page });
  expect(listMemberLogs).toHaveBeenCalledWith('member-1', { source: 'AUTOMATION', limit: 5 });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

it('clears an admitted OAuth token when tester access is denied', async () => {
  const tools = new MetadataTools() as any;
  const clear = vi.fn();
  tools.client = async () => ({
    getAccessToken: async () => 'token',
    listOrganizations: async () => { throw Object.assign(new Error('denied'), { status: 403, code: 'integration_tester_required' }); },
  });
  tools.sessions = { load: async () => ({ principal: {} }), clear };
  expect(await safeResult(() => tools.authorized())({})).toEqual({
    isError: true, content: [{ type: 'text', text: 'You are not an integration tester. Contact developer support.' }],
  });
  expect(clear).toHaveBeenCalledOnce();
});

it('keeps network errors distinct from tester denial', async () => {
  const tools = new MetadataTools() as any;
  const clear = vi.fn();
  tools.client = async () => ({ getAccessToken: async () => 'token', listOrganizations: async () => { throw new Error('network unavailable'); } });
  tools.sessions = { load: async () => ({ principal: {} }), clear };
  await expect(tools.authorized()).rejects.toThrow('network unavailable');
  expect(clear).not.toHaveBeenCalled();
});

it('does not clear a newer login after an older admission check rejects', async () => {
  const tools = new MetadataTools() as any;
  const admission = deferred<never>();
  const entered = deferred<void>();
  const oldClear = vi.fn();
  const newClear = vi.fn();
  tools.client = async () => ({ getAccessToken: async () => 'old-token', listOrganizations: () => { entered.resolve(); return admission.promise; } });
  tools.sessions = { load: async () => ({ principal: {} }), clear: oldClear };
  const pending = tools.authorized();
  await entered.promise;
  await tools.logout();
  tools.sessions = { load: async () => ({ principal: {} }), clear: newClear };
  tools.client = async () => ({ getAccessToken: async () => 'new-token', listOrganizations: async () => [] });
  admission.reject(Object.assign(new Error('denied'), { status: 403, code: 'integration_tester_required' }));
  await expect(pending).rejects.toMatchObject({ code: 'operator_reauthentication_required' });
  expect(await tools.authorized()).toHaveProperty('listOrganizations');
  expect(newClear).not.toHaveBeenCalled();
});

it('starts a fresh browser login after successful login and later session loss', async () => {
  const tools = new MetadataTools() as any;
  tools.silentAttempted = true;
  let authenticated = false;
  const first = deferred<void>();
  const second = deferred<void>();
  const begin = vi.mocked(beginBrowserLogin).mockReset().mockResolvedValueOnce({ authorizationUrl: 'https://login/first', completed: first.promise, cancel: vi.fn() })
    .mockResolvedValueOnce({ authorizationUrl: 'https://login/second', completed: second.promise, cancel: vi.fn() });
  tools.authConfiguration = { redirectUri: 'http://127.0.0.1/oauth/callback' };
  tools.client = async () => ({ getAccessToken: async () => authenticated ? 'token' : undefined, listOrganizations: async () => [], auth: {} });
  expect((await tools.authorized()).login.authorizationUrl).toBe('https://login/first');
  authenticated = true;
  expect(await tools.authorized()).toHaveProperty('auth');
  tools.silentAttempted = true;
  authenticated = false;
  expect((await tools.authorized()).login.authorizationUrl).toBe('https://login/second');
  expect(begin).toHaveBeenCalledTimes(2);
  first.resolve(); second.resolve();
});

it('reports a failed browser login before offering another URL', async () => {
  const tools = new MetadataTools() as any;
  tools.silentAttempted = true;
  const completed = deferred<void>();
  const begin = vi.mocked(beginBrowserLogin).mockReset().mockResolvedValueOnce({ authorizationUrl: 'https://login/first', completed: completed.promise, cancel: vi.fn() })
    .mockResolvedValueOnce({ authorizationUrl: 'https://login/second', completed: new Promise(() => undefined), cancel: vi.fn() });
  tools.authConfiguration = { redirectUri: 'http://127.0.0.1/oauth/callback' };
  tools.client = async () => ({ getAccessToken: async () => undefined, auth: {} });

  expect((await tools.authorized()).login.authorizationUrl).toBe('https://login/first');
  completed.reject(Object.assign(new Error('private token details'), { code: 'access_denied' }));
  await vi.waitFor(() => expect(tools.loginFailure).toBe('access_denied'));
  expect(await safeResult(() => tools.listOrganizations())({})).toEqual({
    isError: true, content: [{ type: 'text', text: 'access_denied' }],
  });
  expect(begin).toHaveBeenCalledTimes(1);
  expect((await tools.authorized()).login.authorizationUrl).toBe('https://login/second');
});

it('uses an existing browser session without presenting an interactive challenge', async () => {
  const tools = new MetadataTools() as any;
  let authenticated = false;
  const begin = vi.mocked(beginBrowserLogin).mockReset().mockImplementationOnce(async () => {
    authenticated = true;
    return { authorizationUrl: 'https://login/silent', completed: Promise.resolve(), cancel: vi.fn() };
  });
  tools.authConfiguration = { redirectUri: 'http://127.0.0.1/oauth/callback' };
  const core = { getAccessToken: async () => authenticated ? 'token' : undefined, listOrganizations: async () => [], auth: {} };
  tools.client = async () => core;
  expect(await tools.authorized()).toBe(core);
  expect(begin).toHaveBeenCalledExactlyOnceWith(core.auth, tools.authConfiguration, undefined, { prompt: 'none', timeoutMs: 30_000 });
});

it('falls back to one interactive challenge after silent login is unavailable', async () => {
  const tools = new MetadataTools() as any;
  const begin = vi.mocked(beginBrowserLogin).mockReset()
    .mockResolvedValueOnce({ authorizationUrl: 'https://login/silent', completed: Promise.reject(Object.assign(new Error('login_required'), { code: 'login_required' })), cancel: vi.fn() })
    .mockResolvedValueOnce({ authorizationUrl: 'https://login/interactive', completed: new Promise(() => undefined), cancel: vi.fn() });
  tools.authConfiguration = { redirectUri: 'http://127.0.0.1/oauth/callback' };
  tools.client = async () => ({ getAccessToken: async () => undefined, auth: {} });
  expect((await tools.authorized()).login.authorizationUrl).toBe('https://login/interactive');
  expect((await tools.authorized()).login.authorizationUrl).toBe('https://login/interactive');
  expect(begin).toHaveBeenCalledTimes(2);
  expect(begin.mock.calls[1]?.[3]).toBeUndefined();
});

it('falls back to interactive login after the silent browser callback times out', async () => {
  const tools = new MetadataTools() as any;
  const begin = vi.mocked(beginBrowserLogin).mockReset()
    .mockResolvedValueOnce({ authorizationUrl: 'https://login/silent', completed: Promise.reject(new Error('login_browser_callback_timed_out')), cancel: vi.fn() })
    .mockResolvedValueOnce({ authorizationUrl: 'https://login/interactive', completed: new Promise(() => undefined), cancel: vi.fn() });
  tools.authConfiguration = { redirectUri: 'http://127.0.0.1/oauth/callback' };
  tools.client = async () => ({ getAccessToken: async () => undefined, auth: {} });
  expect((await tools.authorized()).login.authorizationUrl).toBe('https://login/interactive');
  expect(begin).toHaveBeenCalledTimes(2);
});

it('reserves a reveal before plan detail and blocks delivery after organization switch', async () => {
  const tools = new MetadataTools() as any;
  const plan = deferred<unknown>();
  const withReveal = vi.fn();
  tools.selected = async () => ({ organizationId: 'old', core: { getPlan: () => plan.promise, withReveal } });
  tools.ready = async () => ({ core: { listOrganizations: async () => [{ id: 'old', name: 'Old' }, { id: 'new', name: 'New' }] } });
  tools.preferences = async () => ({});
  tools.save = async () => undefined;
  tools.key = () => 'user';
  const started = await tools.reveal('plan', 'account.password');
  expect(started.status).toBe('WAITING');
  const switching = tools.selectOrganization('new');
  plan.resolve({ governance: { mode: 'DIRECT' } });
  await switching;
  expect(withReveal).not.toHaveBeenCalled();
  expect((await tools.revealStatus(started.jobId)).status).toBe('CANCELED');
});

it('reports moderator approvals without counting authentication', async () => {
  const tools = new MetadataTools() as any;
  const pending = deferred<void>();
  let onProgress!: (progress: unknown) => void;
  tools.selected = async () => ({ organizationId: 'org-1', core: {
    getPlan: async () => ({ governance: { mode: 'MODERATED' }, participants: [] }),
    withReveal: async (_planId: string, options: { onProgress: typeof onProgress }) => {
      onProgress = options.onProgress;
      await pending.promise;
    },
  } });
  const { jobId } = await tools.reveal('plan', 'account.password');
  await vi.waitFor(() => expect(onProgress).toBeTypeOf('function'));

  onProgress({ phase: 'WAITING_FOR_AUTHENTICATION', session: { approvedModerators: 0, requiredModerators: 1 } });
  expect((await tools.revealStatus(jobId)).message).toBe('Authentication request sent to SafeKey Mobile. Confirm it to continue.');
  onProgress({ phase: 'WAITING_FOR_MODERATION', session: { approvedModerators: 0, requiredModerators: 1 } });
  expect((await tools.revealStatus(jobId)).message).toBe('Waiting for moderators (0 of 1 approved).');
  onProgress({ phase: 'WAITING_FOR_MODERATION', session: { approvedModerators: 1, requiredModerators: 1 } });
  expect((await tools.revealStatus(jobId)).message).toBe('Waiting for moderators (1 of 1 approved).');
  pending.resolve(undefined);
});

it('reports an interrupted reveal without leaking the underlying error or opening a new request', async () => {
  const tools = new MetadataTools() as any;
  const withReveal = vi.fn().mockRejectedValue(Object.assign(new Error('secret diagnostic'), { code: 'reveal_restart_required' }));
  tools.selected = async () => ({ organizationId: 'org-1', core: {
    getPlan: async () => ({ governance: { mode: 'DIRECT' }, participants: [] }), withReveal,
  } });
  const { jobId } = await tools.reveal('plan-1', 'account.password');
  await vi.waitFor(async () => expect((await tools.revealStatus(jobId)).status).toBe('FAILED'));
  const status = await tools.revealStatus(jobId);
  expect(status).toMatchObject({ code: 'reveal_restart_required', message: expect.stringContaining('Inheriti® Business') });
  expect(JSON.stringify(status)).not.toContain('secret diagnostic');
  expect(withReveal).toHaveBeenCalledTimes(1);
});

it('keeps the governance repair code and instruction in a failed reveal job', async () => {
  const tools = new MetadataTools() as any;
  tools.selected = async () => ({ organizationId: 'org-1', core: {
    getPlan: async () => ({ governance: { mode: 'MODERATED' }, participants: [] }),
    withReveal: async () => { throw Object.assign(new Error('private diagnostic'), { code: 'plan_governance_reconfiguration_required' }); },
  } });
  const { jobId } = await tools.reveal('plan-1', 'account.password');
  await vi.waitFor(async () => expect((await tools.revealStatus(jobId)).status).toBe('FAILED'));
  const status = await tools.revealStatus(jobId);
  expect(status).toMatchObject({ code: 'plan_governance_reconfiguration_required', message: expect.stringContaining('Update Moderators in Inheriti Business plan settings') });
  expect(JSON.stringify(status)).not.toContain('private diagnostic');
});

it('points a full SafeKey PRO to the Desktop Tool', async () => {
  const tools = new MetadataTools() as any;
  tools.selected = async () => ({ organizationId: 'org-1', core: {
    getPlan: async () => ({ governance: { mode: 'DIRECT' }, participants: [] }),
    withReveal: async () => { throw new Error('SAFEKEY_NO_SPACE'); },
  } });
  const { jobId } = await tools.reveal('plan-1', 'account.password');
  await vi.waitFor(async () => expect((await tools.revealStatus(jobId)).status).toBe('FAILED'));
  expect((await tools.revealStatus(jobId)).message).toContain('https://safekey.be/tools/safekey-desktop/');
});

it.each(['EXPIRED', 'PARTICIPANT_REVOKED', 'RECONCILIATION_REQUIRED'])('preserves %s progress after SDK rejection', async phase => {
  const tools = new MetadataTools() as any;
  tools.selected = async () => ({ organizationId: 'org-1', core: {
    getPlan: async () => ({ governance: { mode: 'DIRECT' }, participants: [] }),
    withReveal: async (_id: string, options: any) => {
      options.onProgress({ phase, session: { id: 'reveal-1', expiresAt: '2026-01-01', governanceGate: 'MODERATION', requiredModerators: 2, approvedModerators: 1, secret: 'never expose' } });
      throw new Error('secret diagnostic');
    },
  } });
  const { jobId } = await tools.reveal('plan', 'account.password');
  await vi.waitFor(async () => expect((await tools.revealStatus(jobId)).status).toBe('FAILED'));
  const status = await tools.revealStatus(jobId);
  expect(status.message).not.toBe('Reveal could not continue.');
  expect(status.progress).toEqual({ revealId: 'reveal-1', expiresAt: '2026-01-01', governanceGate: 'MODERATION', requiredModerators: 2, approvedModerators: 1 });
  expect(JSON.stringify(status)).not.toContain('secret');
});

it.each(['reveal_cancellation_failed', 'master_key_relay_cancellation_failed'])('reports %s after a local abort', async code => {
  const tools = new MetadataTools() as any;
  tools.selected = async () => ({ organizationId: 'org-1', core: {
    getPlan: async () => ({ governance: { mode: 'DIRECT' }, participants: [] }),
    withReveal: async (_id: string, options: any) => {
      await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
      throw Object.assign(new Error('secret diagnostic'), { code });
    },
  } });
  const { jobId } = await tools.reveal('plan', 'account.password');
  await vi.waitFor(() => expect(tools.job.phase).toBe('STARTING'));
  await new Promise(resolve => setTimeout(resolve, 0));
  const status = await tools.revealStatus(jobId, true);
  expect(status).toMatchObject({ status: 'FAILED', code });
  expect(status.message).toContain(code === 'reveal_cancellation_failed' ? 'abort_plan_access' : 'SafeKey Mobile');
  expect(JSON.stringify(status)).not.toContain('secret diagnostic');
});

it('retires the session store on logout so late SDK writes cannot sign the operator back in', async () => {
  const tools = new MetadataTools() as any;
  const retired = tools.sessions;
  const token = deferred<string>();
  tools.client = async () => ({ getAccessToken: async () => {
    await token.promise;
    await retired.save({ accessToken: 'late-token' });
    return 'late-token';
  } });
  const pending = tools.authorized();
  await Promise.resolve();
  expect(await tools.logout()).toEqual({ signedOut: true });
  token.resolve('late-token');
  await expect(pending).rejects.toMatchObject({ code: 'operator_reauthentication_required' });
  expect(await tools.sessions.load()).toBeUndefined();
});

it('aborts matching local work before recovering server plan access', async () => {
  const tools = new MetadataTools() as any;
  const controller = new AbortController();
  const abortPlanAccess = vi.fn().mockResolvedValue({ aborted: true });
  tools.selected = async () => ({ organizationId: 'org-1', core: { abortPlanAccess } });
  tools.job = { organizationId: 'org-1', planId: 'plan', status: 'WAITING', controller, done: Promise.resolve() };
  expect(await tools.abortPlanAccess('plan', 'reveal')).toEqual({ organizationId: 'org-1', aborted: true });
  expect(controller.signal.aborted).toBe(true);
  expect(abortPlanAccess).toHaveBeenCalledWith('plan', 'reveal');
});

it('clears held keys and cancels local work when SDK refresh loses the session', async () => {
  const tools = new MetadataTools() as any;
  const controller = new AbortController();
  const forgetMasterKey = vi.fn();
  tools.scoped = { core: { forgetMasterKey } };
  tools.job = { status: 'WAITING', controller, done: Promise.resolve() };
  tools.client = async () => ({ getAccessToken: async () => { throw Object.assign(new Error('private'), { code: 'reauthentication_required' }); } });
  await expect(tools.authorized()).rejects.toMatchObject({ code: 'reauthentication_required' });
  expect(controller.signal.aborted).toBe(true);
  expect(forgetMasterKey).toHaveBeenCalledOnce();
  expect(tools.scoped).toBeUndefined();
});

it('does not let retired authorization clear a fresh single-flight challenge', async () => {
  const tools = new MetadataTools() as any;
  tools.silentAttempted = true;
  const oldChallenge = deferred<any>();
  const newChallenge = deferred<any>();
  const begin = vi.mocked(beginBrowserLogin).mockReset().mockImplementationOnce(() => oldChallenge.promise)
    .mockImplementationOnce(() => newChallenge.promise);
  tools.authConfiguration = { redirectUri: 'http://127.0.0.1/oauth/callback' };
  tools.client = async () => ({ getAccessToken: async () => undefined, auth: {} });
  const old = tools.authorized();
  await vi.waitFor(() => expect(begin).toHaveBeenCalledOnce());
  await tools.logout();
  tools.silentAttempted = true;
  tools.authConfiguration = { redirectUri: 'http://127.0.0.1/oauth/callback' };
  tools.client = async () => ({ getAccessToken: async () => undefined, auth: {} });
  const current = tools.authorized();
  await vi.waitFor(() => expect(begin).toHaveBeenCalledTimes(2));
  const cancelOld = vi.fn();
  oldChallenge.resolve({ authorizationUrl: 'old', completed: new Promise(() => undefined), cancel: cancelOld });
  await expect(old).rejects.toMatchObject({ code: 'operator_reauthentication_required' });
  expect(cancelOld).toHaveBeenCalledOnce();
  const concurrent = tools.authorized();
  expect(concurrent).toBe(current);
  newChallenge.resolve({ authorizationUrl: 'new', completed: new Promise(() => undefined), cancel: vi.fn() });
  expect((await current).login.authorizationUrl).toBe('new');
  expect(begin).toHaveBeenCalledTimes(2);
});

it('reuses the selected SDK client and auth until the operator session changes', async () => {
  const tools = new MetadataTools() as any;
  tools.config = { issuer: 'https://issuer.test', environment: 'TEST', apiUrl: 'https://api.test', clientId: 'client', redirectUri: 'http://localhost' };
  tools.preferences = async () => ({});
  const auth = { getAccessToken: vi.fn(async () => 'token') };
  tools.ready = async () => ({ core: { auth, listOrganizations: async () => [{ id: 'org-1', name: 'Org' }] } });
  await tools.sessions.save({ principal: { subject: 'operator', sessionId: 'first' } });
  const [first, concurrent] = await Promise.all([tools.selected(), tools.selected()]);
  expect(first.core).toBe(concurrent.core);
  expect(first.core.auth).toBe(auth);
  expect((await tools.selected()).core).toBe(first.core);
  const forget = vi.spyOn(first.core, 'forgetMasterKey');
  await tools.sessions.save({ principal: { subject: 'operator', sessionId: 'second' } });
  const second = await tools.selected();
  expect(second.core).not.toBe(first.core);
  expect(second.core.auth).toBe(auth);
  expect(forget).toHaveBeenCalledOnce();
});


it.each([
  ['LIVE', 'inheriti'], ['prod', 'inheriti'],
  ['LIVE', 'inheriti-elements'], ['prod', 'inheriti-elements'],
])('rejects development configuration %s from %s', async (environment, folder) => {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-config-'));
  vi.stubEnv('XDG_CONFIG_HOME', directory);
  try {
    await mkdir(join(directory, folder));
    await writeFile(join(directory, folder, 'config.json'), JSON.stringify(environment === 'prod'
      ? { deployment: 'prod', business: true }
      : { apiUrl: 'https://api.test', issuer: 'https://issuer.test', clientId: 'client', environment }));
    await expect((new MetadataTools() as any).client()).rejects.toMatchObject({ code: 'live_environment_unavailable_in_development_build' });
  } finally { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); }
});

it.each([null, undefined])('reports unknown rejection %s safely', async error => {
  const tools = new MetadataTools() as any;
  tools.selected = async () => ({ organizationId: 'org-1', core: {
    getPlan: async () => ({ governance: { mode: 'DIRECT' } }),
    withReveal: async () => { throw error; },
  } });
  const { jobId } = await tools.reveal('plan', 'account.password');
  await vi.waitFor(async () => expect((await tools.revealStatus(jobId)).status).toBe('FAILED'));
  expect((await tools.revealStatus(jobId)).message).toBe('Reveal could not continue.');
});
