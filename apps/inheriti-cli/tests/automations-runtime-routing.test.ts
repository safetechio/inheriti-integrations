import { afterEach, expect, it, vi } from 'vitest';

const { manage, login, token } = vi.hoisted(() => ({
  manage: vi.fn(async () => 0),
  login: vi.fn(async () => { token.value = 'signed-in'; return 0; }),
  token: { value: 'signed-in' as string | undefined },
}));
vi.mock('../src/commands/automations.js', () => ({ automationManage: manage }));
vi.mock('../src/commands/login.js', () => ({ login }));
vi.mock('../src/session.js', async original => ({
  ...(await original<object>()), createCliContext: () => ({ core: { getAccessToken: async () => token.value } }),
}));
vi.mock('../src/organizations.js', async original => ({
  ...(await original<object>()), selectedOrganization: vi.fn(async () => ({ id: 'org-1', name: 'Acme' })),
}));
vi.mock('../src/configuration.js', async original => ({
  ...(await original<object>()), BUILD_DEPLOYMENT: 'local',
  resolveConfiguration: () => ({ business: true, apiUrl: 'http://business.localhost:3400/integrations/', issuer: 'issuer', environment: 'TEST' }),
}));

afterEach(() => { token.value = 'signed-in'; vi.clearAllMocks(); });

it('routes runtime installation instructions without signing in twice', async () => {
  const { run } = await import('../src/main.js');
  const terminal = { interactive: false, stdoutIsTTY: false, columns: 80, write: vi.fn(), writeError: vi.fn() };
  expect(await run(['automations', 'runtime', 'install-instructions'], {}, terminal)).toBe(0);
  expect(login).not.toHaveBeenCalled();
  expect(manage).toHaveBeenCalledWith(expect.anything(), expect.anything(), terminal, expect.any(AbortSignal), ['runtime', 'install-instructions']);
});

it('signs in only when runtime instructions need a session', async () => {
  token.value = undefined;
  const { run } = await import('../src/main.js');
  const terminal = { interactive: true, stdoutIsTTY: true, columns: 80, write: vi.fn(), writeError: vi.fn() };
  expect(await run(['automations', 'runtime', 'install-instructions'], {}, terminal)).toBe(0);
  expect(login).toHaveBeenCalledOnce();
  expect(manage).toHaveBeenCalledOnce();
});
