import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLI_FEATURE_FLAGS } from '../src/feature-flags.js';
import type { Terminal } from '../src/output.js';

const { configure, withAutomationSecrets, usePlan, resolvePlanId } = vi.hoisted(() => ({
  configure: vi.fn(),
  withAutomationSecrets: vi.fn(),
  usePlan: vi.fn(),
  resolvePlanId: vi.fn(),
}));

vi.mock('../src/configuration.js', async (original) => ({
  ...(await original<object>()),
  BUILD_DEPLOYMENT: undefined,
  resolveConfiguration: configure,
}));
vi.mock('../src/automation-secrets.js', async (original) => ({
  ...(await original<object>()),
  withAutomationSecrets,
}));
vi.mock('../src/commands/use.js', async (original) => ({ ...(await original<object>()), usePlan }));
vi.mock('../src/commands/plans.js', async (original) => ({ ...(await original<object>()), resolvePlanId }));

function terminal(): Terminal & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, stdoutIsTTY: false, interactive: false, columns: 80, write: line => lines.push(line), writeError: line => errors.push(line) };
}

beforeEach(() => {
  vi.clearAllMocks();
  configure.mockReturnValue({ business: false, apiUrl: 'https://business.example/api' });
  resolvePlanId.mockResolvedValue('plan-1');
  usePlan.mockResolvedValue(0);
});

describe('automation feature flag', () => {
  it('disables automation and plan creation in every build', () => {
    expect(CLI_FEATURE_FLAGS).toEqual({
      local: { automation: false, planCreation: false },
      dev: { automation: false, planCreation: false },
      stg: { automation: false, planCreation: false },
      prod: { automation: false, planCreation: false },
    });
  });

  it.each([
    [['secrets', 'exec', 'plan-1', '--automation', '--', 'fixture']],
    [['secrets', 'exec', 'plan-1', '--env', 'TOKEN=asset.field', '--', 'fixture']],
  ])('rejects automation when the build has no enabled deployment flag: %j', async (args: string[]) => {
    const output = terminal();
    const environment = args.includes('--automation')
      ? {}
      : { INHERITI_AUTOMATION_CONNECTION_ID: 'connection-1', INHERITI_AUTOMATION_AUDIENCE: 'audience-1' };
    await expect((await import('../src/main.js')).run(args, environment, output)).resolves.toBe(1);
    expect(output.errors).toHaveLength(1);
    expect(withAutomationSecrets).not.toHaveBeenCalled();
    expect(usePlan).not.toHaveBeenCalled();
  }, 15_000);

  it('keeps ordinary secret delivery on the normal use path', async () => {
    const output = terminal();
    const { run } = await import('../src/main.js');
    await expect(run(['secrets', 'exec', 'plan-1', '--env', 'TOKEN=asset.field', '--', 'fixture'], {}, output)).resolves.toBe(0);
    expect(withAutomationSecrets).not.toHaveBeenCalled();
    expect(usePlan).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 'plan-1', expect.objectContaining({ workload: false }),
    );
  });
});
