import { expect, it, vi } from 'vitest';

const withAutomationSecrets = vi.hoisted(() => vi.fn());
vi.mock('../src/configuration.js', async original => ({
  ...(await original<object>()), BUILD_DEPLOYMENT: 'dev',
  resolveConfiguration: () => ({ business: true, apiUrl: 'https://business.example/integrations/' }),
}));
vi.mock('../src/feature-flags.js', () => ({ CLI_FEATURE_FLAGS: { dev: { automation: true } } }));
vi.mock('../src/automation-secrets.js', async original => ({
  ...(await original<object>()), automationConfigurationComplete: () => true, withAutomationSecrets,
}));

import { run } from '../src/main.js';

const argv = ['secrets', 'exec', 'plan-id', '--automation', '--env', 'SECRET=asset.field', '--', '/usr/bin/env'];
const environment = { INHERITI_AUTOMATION_PROVIDER: 'AWS' };
const terminal = () => ({ interactive: false, stdoutIsTTY: false, columns: 80, write: vi.fn(), writeError: vi.fn() });

it('returns a non-restarting status only for explicit automation denial', async () => {
  const output = terminal();
  withAutomationSecrets.mockRejectedValueOnce(Object.assign(new Error('Rejected in SafeKey Mobile'), { code: 'governance_denied' }));
  expect(await run(argv, environment, output)).toBe(77);
  expect(output.writeError).toHaveBeenCalledWith('Rejected in SafeKey Mobile');
  withAutomationSecrets.mockRejectedValueOnce(Object.assign(new Error('reveal_denied'), { code: 'reveal_denied' }));
  expect(await run(argv, environment, output)).toBe(77);
  withAutomationSecrets.mockRejectedValueOnce(new Error('network failed'));
  expect(await run(argv, environment, output)).toBe(1);
});
