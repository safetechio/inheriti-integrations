import { expect, it, vi } from 'vitest';
import { MetadataTools } from '../src/server.js';

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
