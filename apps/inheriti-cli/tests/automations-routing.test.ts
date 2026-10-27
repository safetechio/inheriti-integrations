import { afterEach, expect, it, vi } from 'vitest';

const { manage, metadata, publish, selectedOrganization, context } = vi.hoisted(() => ({
  manage: vi.fn(async () => 0), metadata: vi.fn(async () => 0),
  publish: vi.fn(async () => 0),
  selectedOrganization: vi.fn(async () => ({ id: 'org-1', name: 'Acme' })),
  context: vi.fn(() => ({ core: { getAccessToken: async () => 'human-token' }, sessions: { load: async () => false } })),
}));
vi.mock('../src/commands/automations.js', () => ({ automationManage: manage, automationMetadata: metadata }));
vi.mock('../src/commands/automation-setup.js', () => ({ automationSetup: vi.fn(async () => 0) }));
vi.mock('../src/commands/secrets-publish-aws.js', () => ({ publishAwsSecrets: publish }));
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

it('routes management and setup in dev, rejects stg and prod', async () => {
  expect((await run('dev', ['automations', 'create'])).code).toBe(0);
  expect(manage).toHaveBeenCalledOnce();
  vi.clearAllMocks();
  expect((await run('stg', ['automations', 'create'])).code).toBe(1);
  expect((await run('prod', ['automations', 'create'])).code).toBe(1);
  expect((await run('local', ['automations', 'setup'])).code).toBe(0);
  expect(manage).not.toHaveBeenCalled();
});

it('shows the complete AWS inspection error in the terminal', async () => {
  const error = new Error('automation_cloud_inspection_failed');
  Object.defineProperty(error, 'providerDiagnostic', { value: 'AWS CLI: An error occurred (AccessDeniedException) when calling the DescribeTaskDefinition operation: not authorized to perform: ecs:DescribeTaskDefinition' });
  manage.mockRejectedValueOnce(error);
  const { code, output } = await run('dev', ['automations', 'create']);
  expect(code).toBe(1);
  expect(output.writeError).toHaveBeenCalledWith(expect.stringContaining('not authorized to perform: ecs:DescribeTaskDefinition'));
});

it('does not print free-form provider diagnostics that contain secrets', async () => {
  manage.mockRejectedValueOnce(Object.assign(new Error('automation_cloud_inspection_failed'), {
    providerDiagnostic: 'AWS CLI: rejected environment value sentinel-secret',
  }));
  const { code, output } = await run('dev', ['automations', 'create']);
  expect(code).toBe(1);
  expect(output.writeError).not.toHaveBeenCalledWith(expect.stringContaining('sentinel-secret'));
});

it('keeps unexpected automation error details private while naming the command', async () => {
  manage.mockRejectedValueOnce(new Error('secret-value'));
  const { code, output } = await run('dev', ['automations', 'create']);
  expect(code).toBe(1);
  expect(output.writeError).toHaveBeenCalledWith(expect.stringContaining('Automations create failed unexpectedly'));
  expect(output.writeError).not.toHaveBeenCalledWith(expect.stringContaining('secret-value'));
});

it('shows provider diagnostics when publishing automation secrets', async () => {
  const error = new Error('automation_aws_provider_failed');
  Object.defineProperty(error, 'providerDiagnostic', { value: 'AWS CLI: AccessDeniedException in PutSecretValue' });
  publish.mockRejectedValueOnce(error);
  const { code, output } = await run('dev', ['secrets', 'publish', 'aws', '--plan', 'plan-1']);
  expect(code).toBe(1);
  expect(output.writeError).toHaveBeenCalledWith(expect.stringContaining('AWS CLI: AccessDeniedException in PutSecretValue'));
});

it('routes safe metadata commands and rejects missing plan IDs', async () => {
  expect((await run('local', ['automations', 'list'], false)).code).toBe(0);
  expect((await run('local', ['automations', 'grants', 'plan-1'], false)).code).toBe(0);
  expect(metadata).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.anything(), 'plan-1');
  expect((await run('local', ['automations', 'grants'], false)).code).toBe(1);
});

it('routes AWS publication through secrets', async () => {
  expect((await run('local', ['secrets', 'publish', 'aws', '--plan', 'plan-1'])).code).toBe(0);
  expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({ organization: { id: 'org-1', name: 'Acme' } }),
    expect.anything(), ['--plan', 'plan-1']);
  expect((await run('local', ['secrets', 'publish', 'other'])).code).toBe(1);
  expect(publish).toHaveBeenCalledTimes(1);
});

it('shows management help without configuration', async () => {
  const { code, output } = await run('local', ['help', 'automations', 'verify'], false);
  expect(code).toBe(0);
  expect(output.write).toHaveBeenCalledWith(expect.stringContaining('native window'));
});
