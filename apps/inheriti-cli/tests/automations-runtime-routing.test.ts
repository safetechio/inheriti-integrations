import { afterEach, expect, it, vi } from 'vitest';

const { image } = vi.hoisted(() => ({ image: vi.fn(async () => 0) }));
vi.mock('../src/commands/automation-runtime-image.js', () => ({ automationRuntimeImage: image }));
const { manage, runtime, installEc2, login, token } = vi.hoisted(() => ({
  manage: vi.fn(async () => 0),
  runtime: vi.fn(() => 0),
  installEc2: vi.fn(() => 0),
  login: vi.fn(async () => { token.value = 'signed-in'; return 0; }),
  token: { value: 'signed-in' as string | undefined },
}));
vi.mock('../src/commands/automations.js', () => ({ automationManage: manage, automationRuntimeInstructions: runtime, automationRuntimeInstallEc2: installEc2 }));
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
  expect(runtime).toHaveBeenCalledWith(terminal, '0.0.19', []);
  expect(manage).not.toHaveBeenCalled();
}, 15_000);

it('prints runtime instructions without a Business session', async () => {
  token.value = undefined;
  const { run } = await import('../src/main.js');
  const terminal = { interactive: true, stdoutIsTTY: true, columns: 80, write: vi.fn(), writeError: vi.fn() };
  expect(await run(['automations', 'runtime', 'install-instructions'], {}, terminal)).toBe(0);
  expect(login).not.toHaveBeenCalled();
  expect(runtime).toHaveBeenCalledOnce();
});

it('routes container instructions without a Business session', async () => {
  token.value = undefined;
  const { run } = await import('../src/main.js');
  const terminal = { interactive: true, stdoutIsTTY: true, columns: 80, write: vi.fn(), writeError: vi.fn() };
  expect(await run(['automations', 'runtime', 'install-instructions', '--container'], {}, terminal)).toBe(0);
  expect(login).not.toHaveBeenCalled();
  expect(runtime).toHaveBeenCalledWith(terminal, '0.0.19', ['--container']);
});

it('routes EC2 CLI installation without signing in to Business', async () => {
  const { run } = await import('../src/main.js');
  const terminal = { interactive: false, stdoutIsTTY: false, columns: 80, write: vi.fn(), writeError: vi.fn() };
  expect(await run(['automations', 'runtime', 'install', 'ec2', '--region', 'us-east-1',
    '--instance', 'i-09ce8440ae7294ab9'], {}, terminal)).toBe(0);
  expect(login).not.toHaveBeenCalled();
  expect(installEc2).toHaveBeenCalledWith(terminal, '0.0.19', ['--region', 'us-east-1',
    '--instance', 'i-09ce8440ae7294ab9'], expect.objectContaining({ apiUrl: 'http://business.localhost:3400/integrations/' }),
    expect.any(AbortSignal));
});

it('routes local artifact installation without a Business session', async () => {
  token.value = undefined;
  const { run } = await import('../src/main.js');
  const terminal = { interactive: false, stdoutIsTTY: false, columns: 80, write: vi.fn(), writeError: vi.fn() };
  expect(await run(['automations', 'runtime', 'install', 'ec2', '--region', 'us-east-1',
    '--instance', 'i-09ce8440ae7294ab9', '--cli-tarball', '/tmp/cli.tgz', '--artifact-api-url', 'http://127.0.0.1:3400',
    '--artifact-download-origin', 'https://local-api-tunnel.example'], {}, terminal)).toBe(0);
  expect(installEc2).toHaveBeenCalledWith(terminal, '0.0.19', expect.arrayContaining(['--cli-tarball', '/tmp/cli.tgz']),
    expect.anything(), expect.any(AbortSignal));
  expect(login).not.toHaveBeenCalled();
});

it('routes image preview without Business sign-in', async () => {
  token.value = undefined;
  const { run } = await import('../src/main.js');
  const terminal = { interactive: false, stdoutIsTTY: false, columns: 80, write: vi.fn(), writeError: vi.fn() };
  expect(await run(['automations', 'runtime', 'image', '--image', '123456789012.dkr.ecr.us-east-1.amazonaws.com/app:test'], {}, terminal)).toBe(0);
  expect(login).not.toHaveBeenCalled();
  expect(image).toHaveBeenCalledWith(terminal, '0.0.19', ['--image', '123456789012.dkr.ecr.us-east-1.amazonaws.com/app:test'], expect.any(AbortSignal));
});

it('rejects an unknown runtime action without selecting an organisation', async () => {
  const { run } = await import('../src/main.js');
  const terminal = { interactive: false, stdoutIsTTY: false, columns: 80, write: vi.fn(), writeError: vi.fn() };
  expect(await run(['automations', 'runtime', 'unknown'], {}, terminal)).toBe(1);
  expect(runtime).not.toHaveBeenCalled();
  expect(manage).not.toHaveBeenCalled();
  expect(terminal.writeError).toHaveBeenCalledWith(expect.stringContaining('install-instructions'));
});
