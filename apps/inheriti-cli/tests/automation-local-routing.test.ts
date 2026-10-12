import { beforeEach, expect, it, vi } from 'vitest';
import type { Terminal } from '../src/output.js';

const { configure, withAutomationSecrets, usePlan } = vi.hoisted(() => ({
  configure: vi.fn(),
  withAutomationSecrets: vi.fn(),
  usePlan: vi.fn(),
}));

vi.mock('../src/configuration.js', async (original) => ({
  ...(await original<object>()),
  BUILD_DEPLOYMENT: 'local',
  resolveConfiguration: configure,
}));
vi.mock('../src/automation-secrets.js', async (original) => ({ ...(await original<object>()), withAutomationSecrets }));
vi.mock('../src/commands/use.js', async (original) => ({ ...(await original<object>()), usePlan }));

function terminal(): Terminal & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, stdoutIsTTY: false, interactive: false, columns: 80, write: line => lines.push(line), writeError: line => errors.push(line) };
}

beforeEach(() => {
  vi.clearAllMocks();
  configure.mockReturnValue({ business: true, apiUrl: 'https://business.example/api' });
  usePlan.mockResolvedValue(0);
  withAutomationSecrets.mockImplementation(async (_apiUrl: string, _environment: unknown, work: (context: unknown) => Promise<number>) =>
    work({ core: { getAccessToken: async () => 'automation-token' } }));
});

it('routes explicit automation through the local automation session without network calls in the test', async () => {
  const { run } = await import('../src/main.js');
  const output = terminal();
  const environment = {
    INHERITI_AUTOMATION_CONNECTION_ID: 'connection-1',
    INHERITI_AUTOMATION_AUDIENCE: 'audience-1',
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.githubusercontent.com/oidc',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-token',
  };
  await expect(run(['secrets', 'exec', 'plan-1', '--automation', '--env', 'TOKEN=asset.field', '--', 'fixture'], environment, output))
    .resolves.toBe(0);
  expect(withAutomationSecrets).toHaveBeenCalledWith('https://business.example/api', environment, expect.any(Function));
  expect(usePlan).toHaveBeenCalledWith(
    expect.objectContaining({ core: expect.any(Object) }), expect.anything(), 'plan-1',
    expect.objectContaining({ workload: true, command: ['fixture'] }),
  );
}, 15_000);
