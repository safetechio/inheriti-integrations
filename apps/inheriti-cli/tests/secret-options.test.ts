import { beforeEach, describe, expect, it, vi } from 'vitest';
import { messageFor, run } from '../src/main.js';
import type { Terminal } from '../src/output.js';

const { configure, makeContext, resolveId, reveal, use, resolveField } = vi.hoisted(() => ({
  configure: vi.fn(), makeContext: vi.fn(), resolveId: vi.fn(), reveal: vi.fn(), use: vi.fn(), resolveField: vi.fn(),
}));
vi.mock('../src/configuration.js', async (original) => ({ ...(await original<object>()), resolveConfiguration: configure }));
vi.mock('../src/session.js', async (original) => ({ ...(await original<object>()), createCliContext: makeContext }));
vi.mock('../src/commands/plans.js', async (original) => ({ ...(await original<object>()), resolvePlanId: resolveId }));
vi.mock('../src/commands/reveal.js', async (original) => ({ ...(await original<object>()), revealPlan: reveal, resolvePlanField: resolveField }));
vi.mock('../src/commands/use.js', async (original) => ({ ...(await original<object>()), usePlan: use }));

function output(stdoutIsTTY = false): Terminal & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { stdoutIsTTY, interactive: false, columns: 80, lines, errors, write: (line) => lines.push(line), writeError: (line) => errors.push(line) };
}

beforeEach(() => {
  vi.clearAllMocks();
  configure.mockReturnValue({ business: false });
  makeContext.mockReturnValue({});
  resolveId.mockResolvedValue('plan-1');
  reveal.mockResolvedValue(0);
  use.mockResolvedValue(0);
  resolveField.mockResolvedValue(0);
});

describe('secret command options', () => {
  it('requires an explicit complete automation opt-in and preserves human child arguments', async () => {
    const args = ['secrets', 'exec', 'plan-1', '--env', 'TOKEN=service.token', '--', 'fixture', '--automation'];
    expect(await run(args, {}, output())).toBe(0);
    expect(use).toHaveBeenCalledWith({}, expect.anything(), 'plan-1', expect.objectContaining({ command: ['fixture', '--automation'] }));
    use.mockClear();
    const workloadEnv = { INHERITI_AUTOMATION_CONNECTION_ID: 'connection-1', INHERITI_AUTOMATION_AUDIENCE: 'audience-1' };
    expect(await run(args, workloadEnv, output())).toBe(1);
    expect(await run(['secrets', 'exec', 'plan-1', '--automation', '--env', 'TOKEN=service.token', '--', 'fixture'], {}, output())).toBe(1);
    expect(use).not.toHaveBeenCalled();
    expect(makeContext).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['--field', 'asset.password'],
    ['--field', 'asset.password', '--allow-plaintext-output', '--allow-plaintext-output'],
    ['--field', 'asset.password', '--field', 'asset.other', '--allow-plaintext-output'],
    ['--field', 'fixture-secret', '--allow-plaintext-output'],
    ['--field', 'asset.', '--allow-plaintext-output'],
    ['--field', 'asset.password', '--allow-plaintext-output=fixture-secret'],
    ['--field', 'asset.password', '--allow-plaintext-output', '--fixture-secret'],
    ['--field', '--fixture-secret.password', '--allow-plaintext-output'],
  ])('rejects invalid resolve options before configuration: %j', async (...args) => {
    const terminal = output();
    expect(await run(['secrets', 'resolve', 'plan-1', ...args], {}, terminal)).toBe(1);
    expect(configure).not.toHaveBeenCalled();
    expect(makeContext).not.toHaveBeenCalled();
    expect(resolveId).not.toHaveBeenCalled();
    expect(resolveField).not.toHaveBeenCalled();
    expect(terminal.lines).toEqual([]);
    expect(terminal.errors.join('\n')).not.toContain('fixture-secret');
  });

  it('rejects terminal stdout with piped stdin before configuration', async () => {
    const terminal = output(true);
    expect(await run(['secrets', 'resolve', 'plan-1', '--field', 'asset.password', '--allow-plaintext-output'], {}, terminal)).toBe(1);
    expect(configure).not.toHaveBeenCalled();
    expect(terminal.errors).toEqual(['Plaintext output requires non-terminal stdout.']);
  });

  it('accepts acknowledged resolve without a positional plan ID', async () => {
    expect(await run(['secrets', 'resolve', '--field', 'legacy.asset.password', '--allow-plaintext-output'], {}, output())).toBe(0);
    expect(resolveId).toHaveBeenCalledWith({}, expect.anything(), undefined);
    expect(resolveField).toHaveBeenCalledWith({}, expect.anything(), 'plan-1', 'legacy.asset.password', expect.objectContaining({ allowPlaintextOutput: true }));
  });

  it('parses clipboard flags when the positional plan ID is omitted', async () => {
    expect(await run(['plans', 'reveal', '--field', 'asset.password', '--clipboard-ttl', '1s'], {}, output())).toBe(0);
    expect(resolveId).toHaveBeenCalledWith({}, expect.anything(), undefined, expect.any(AbortSignal));
    expect(reveal).toHaveBeenCalledWith({}, expect.anything(), 'plan-1', expect.objectContaining({ fields: ['asset.password'], clipboardTtlMs: 1_000 }));
  });

  it.each(['0ms', '2147483648ms', '999999999999999999999h', '-1s', '1.5s'])('rejects unsafe timer duration %s for use and reveal', async (duration) => {
    for (const args of [
      ['plans', 'reveal', 'plan-1', '--clipboard-ttl', duration],
      ['plans', 'use', 'plan-1', '--ttl', duration, '--', 'fixture'],
    ]) {
      const terminal = output();
      expect(await run(args, {}, terminal)).toBe(1);
      expect(terminal.errors.join('\n')).toContain('2147483647ms');
    }
    expect(use).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
    expect(resolveId).not.toHaveBeenCalled();
  });

  it('accepts the maximum timer duration for use and reveal', async () => {
    expect(await run(['plans', 'reveal', 'plan-1', '--clipboard-ttl', '2147483647ms'], {}, output())).toBe(0);
    expect(reveal).toHaveBeenCalledWith({}, expect.anything(), 'plan-1', expect.objectContaining({ clipboardTtlMs: 2_147_483_647 }));
    expect(await run(['plans', 'use', 'plan-1', '--ttl', '2147483647ms', '--', 'fixture'], {}, output())).toBe(0);
    expect(use).toHaveBeenCalledWith({}, expect.anything(), 'plan-1', expect.objectContaining({ ttlMs: 2_147_483_647 }));
  });

  it.each([
    ['plans', 'reveal', '--clipboard-ttl', '1s', '--clipboard-ttl', '2s'],
    ['plans', 'reveal', '--field', 'asset.password', '--field', 'asset.password'],
    ['plans', 'reveal', '--field', '--clipboard-ttl'],
    ['plans', 'use', 'plan-1', '--ttl', '1s', '--ttl', '2s', '--', 'fixture'],
  ])('rejects duplicate or malformed flags: %j', async (...args) => {
    expect(await run(args, {}, output())).toBe(1);
    expect(reveal).not.toHaveBeenCalled();
    expect(use).not.toHaveBeenCalled();
    expect(resolveId).not.toHaveBeenCalled();
  });
});

it('maps process cancellation without exposing internal code or cause', () => {
  expect(messageFor({ code: 'use_canceled', cause: new Error('fixture-secret') })).toBe('Secret delivery canceled.');
});
