import { expect, it, vi } from 'vitest';
import { MetadataTools } from '../src/server.js';

vi.mock('../src/safekey-pro.js', () => ({ openSafeKeyProPrompt: async () => ({ selectCustodianDevice: () => 'SK_MOBILE', close: () => undefined }) }));

it('uses the selected organization core for plan logs and returns the safe page', async () => {
  const tools = new MetadataTools() as any;
  const listPlanLogs = vi.fn().mockResolvedValue({ items: [{ id: 'log-1', event: 'PLAN_UPDATED', details: [] }], total: 1 });
  tools.selected = async () => ({ organizationId: 'org-1', core: { listPlanLogs } });
  expect(await tools.listPlanLogs('plan-1', 5, 10)).toEqual({ organizationId: 'org-1', items: [{ id: 'log-1', event: 'PLAN_UPDATED', details: [] }], total: 1 });
  expect(listPlanLogs).toHaveBeenCalledWith('plan-1', { limit: 5, offset: 10 });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

it('starts a fresh device challenge after successful login and later session loss', async () => {
  const tools = new MetadataTools() as any;
  let authenticated = false;
  const poll = deferred<void>();
  const begin = vi.fn().mockResolvedValueOnce({ verificationUri: 'https://login', userCode: 'first' }).mockResolvedValueOnce({ verificationUri: 'https://login', userCode: 'second' });
  tools.client = async () => ({ getAccessToken: async () => authenticated ? 'token' : undefined, auth: { beginDeviceAuthorization: begin, pollDeviceAuthorization: () => poll.promise } });
  expect((await tools.authorized()).login.userCode).toBe('first');
  authenticated = true;
  expect(await tools.authorized()).toHaveProperty('auth');
  authenticated = false;
  expect((await tools.authorized()).login.userCode).toBe('second');
  expect(begin).toHaveBeenCalledTimes(2);
  poll.resolve(undefined);
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
  expect(status).toMatchObject({ code: 'reveal_restart_required', message: expect.stringContaining('Inheriti Business') });
  expect(JSON.stringify(status)).not.toContain('secret diagnostic');
  expect(withReveal).toHaveBeenCalledTimes(1);
});
