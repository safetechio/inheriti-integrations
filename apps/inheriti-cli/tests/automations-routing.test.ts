import { afterEach, expect, it, vi } from 'vitest';

const { manage, metadata, selectedOrganization, context } = vi.hoisted(() => ({
  manage: vi.fn(async () => 0), metadata: vi.fn(async () => 0),
  selectedOrganization: vi.fn(async () => ({ id: 'org-1', name: 'Acme' })),
  context: vi.fn(() => ({ core: { getAccessToken: async () => 'human-token' } })),
}));
vi.mock('../src/commands/automations.js', () => ({ automationManage: manage, automationMetadata: metadata }));
vi.mock('../src/organizations.js', async original => ({ ...(await original<object>()), selectedOrganization }));
vi.mock('../src/session.js', async original => ({ ...(await original<object>()), createCliContext: context }));

const terminal = (interactive = true) => ({ interactive, stdoutIsTTY: interactive, columns: 80, write: vi.fn(), writeError: vi.fn() });

afterEach(() => { vi.doUnmock('../src/configuration.js'); vi.resetModules(); vi.clearAllMocks(); });

async function run(deployment: 'local' | 'dev' | 'stg' | 'prod', args: string[], interactive = true) {
  vi.resetModules();
  vi.doMock('../src/configuration.js', async original => ({
    ...(await original<object>()), BUILD_DEPLOYMENT: deployment,
    resolveConfiguration: () => ({ business: true, apiUrl: 'http://business.localhost:3400/integrations/', issuer: 'issuer', environment: 'TEST' }),
  }));
  const { run } = await import('../src/main.js');
  const output = terminal(interactive);
  return { code: await run(args, {}, output), output };
}

it('routes management with selected human organisation and nonsecret arguments', async () => {
  expect((await run('local', ['automations', 'create', '--name', 'CI'])).code).toBe(0);
  expect(selectedOrganization).toHaveBeenCalledOnce();
  expect(manage).toHaveBeenCalledWith(expect.objectContaining({ organization: { id: 'org-1', name: 'Acme' } }), expect.anything(), expect.anything(), expect.any(AbortSignal), ['create', '--name', 'CI']);
}, 15_000);

it('routes management in dev, rejects stg and prod, and removes full-window setup', async () => {
  expect((await run('dev', ['automations', 'create'])).code).toBe(0);
  expect(manage).toHaveBeenCalledOnce();
  vi.clearAllMocks();
  expect((await run('stg', ['automations', 'create'])).code).toBe(1);
  expect((await run('prod', ['automations', 'create'])).code).toBe(1);
  expect((await run('local', ['automations', 'setup'])).code).toBe(1);
  expect(manage).not.toHaveBeenCalled();
});

it('routes safe metadata commands and rejects missing plan IDs', async () => {
  expect((await run('local', ['automations', 'list'], false)).code).toBe(0);
  expect((await run('local', ['automations', 'grants', 'plan-1'], false)).code).toBe(0);
  expect(metadata).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.anything(), 'plan-1');
  expect((await run('local', ['automations', 'grants'], false)).code).toBe(1);
});

it('shows management help without configuration', async () => {
  const { run } = await import('../src/main.js');
  const output = terminal(false);
  expect(await run(['help', 'automations', 'verify'], {}, output)).toBe(0);
  expect(output.write).toHaveBeenCalledWith(expect.stringContaining('native window'));
});
