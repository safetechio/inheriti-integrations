import { expect, it, vi } from 'vitest';

const { createGrant, select } = vi.hoisted(() => ({ createGrant: vi.fn(),
  select: vi.fn(async (_title: string, choices: { value: string }[]) => choices[0]?.value) }));
vi.mock('../src/render/select.js', () => ({ promptSelect: select }));
vi.mock('@safetech/inheriti-elements-core/node-base', async original => ({ ...(await original<object>()),
  createAutomationSetupOperations: () => ({ createGrant, listMembers: async () => [
    { id: 'removed', firstName: 'Former', status: 'REMOVED' },
    { id: 'active', firstName: 'Morgan', lastName: 'Lee', email: 'morgan@example.test', status: 'ACTIVE', masterKeyStatus: 'DISTRIBUTED' },
  ] }),
}));
import { automationManage } from '../src/commands/automations.js';

it('offers active responsible members with names and approval context', async () => {
  const terminal = { interactive: true, stdoutIsTTY: true, columns: 100, write: vi.fn(), writeError: vi.fn() };
  const context = { organization: { id: 'org' }, core: { getAccessToken: async () => 'operator-token' } };
  expect(await automationManage(context as never, { apiUrl: 'https://business.example/integrations/' } as never,
    terminal, new AbortController().signal, ['grant', 'create', '--plan', 'plan', '--connection', 'connection', '--id', 'grant']))
    .toBe(0);
  expect(select).toHaveBeenCalledWith('Which responsible member?', [{ value: 'active',
    description: 'Morgan Lee · morgan@example.test · Organisation key: DISTRIBUTED' }], expect.any(AbortSignal));
  expect(createGrant).toHaveBeenCalledWith('plan', { id: 'grant', connectionId: 'connection', responsibleMemberId: 'active' });
});
