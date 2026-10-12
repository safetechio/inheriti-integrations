import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Terminal } from '../src/output.js';

function terminal(): Terminal & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, stdoutIsTTY: false, interactive: false, columns: 80, write: line => lines.push(line), writeError: line => errors.push(line) };
}

const automationEnvironment = {
  INHERITI_AUTOMATION_CONNECTION_ID: 'connection-1',
  INHERITI_AUTOMATION_AUDIENCE: 'audience-1',
};

async function runInDeployment(deployment: 'dev' | 'stg' | 'prod', args: string[], environment: Record<string, string> = {}) {
  vi.resetModules();
  const withAutomationSecrets = vi.fn();
  vi.doMock('../src/configuration.js', async (original) => ({
    ...(await original<object>()),
    BUILD_DEPLOYMENT: deployment,
    resolveConfiguration: vi.fn(() => ({ business: true, apiUrl: 'https://business.example/api' })),
  }));
  vi.doMock('../src/automation-secrets.js', async (original) => ({ ...(await original<object>()), withAutomationSecrets }));
  const { run } = await import('../src/main.js');
  const output = terminal();
  const result = await run(args, environment, output);
  return { result, output, withAutomationSecrets };
}

afterEach(() => {
  vi.doUnmock('../src/configuration.js');
  vi.doUnmock('../src/automation-secrets.js');
});

describe('automation deployment routing', () => {
  it.each(['dev', 'stg', 'prod'] as const)('rejects explicit exec automation in %s', async (deployment) => {
    const { result, output, withAutomationSecrets } = await runInDeployment(
      deployment,
      ['secrets', 'exec', 'plan-1', '--automation', '--', 'fixture'],
    );
    expect(result).toBe(1);
    expect(output.errors).toHaveLength(1);
    expect(withAutomationSecrets).not.toHaveBeenCalled();
  }, 15_000);

  it.each(['dev', 'stg', 'prod'] as const)('rejects explicit resolve automation in %s', async (deployment) => {
    const { result, output, withAutomationSecrets } = await runInDeployment(
      deployment,
      ['secrets', 'resolve', 'plan-1', '--automation', '--field', 'asset.field', '--allow-plaintext-output'],
    );
    expect(result).toBe(1);
    expect(output.errors).toHaveLength(1);
    expect(withAutomationSecrets).not.toHaveBeenCalled();
  }, 15_000);

  it.each(['dev', 'stg', 'prod'] as const)('rejects environment-triggered automation in %s', async (deployment) => {
    const { result, output, withAutomationSecrets } = await runInDeployment(
      deployment,
      ['secrets', 'exec', 'plan-1', '--env', 'TOKEN=asset.field', '--', 'fixture'],
      automationEnvironment,
    );
    expect(result).toBe(1);
    expect(output.errors).toHaveLength(1);
    expect(withAutomationSecrets).not.toHaveBeenCalled();
  }, 15_000);
});
