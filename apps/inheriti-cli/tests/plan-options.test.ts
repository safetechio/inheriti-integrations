import { beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from '../src/main.js';
import type { Terminal } from '../src/output.js';

const { configure, makeContext, download, loginBrowser, logout, selectedOrganization } = vi.hoisted(() => ({
  configure: vi.fn(),
  makeContext: vi.fn(),
  download: vi.fn(),
  loginBrowser: vi.fn(),
  logout: vi.fn(),
  selectedOrganization: vi.fn(),
}));

vi.mock('../src/configuration.js', async (original) => ({ ...(await original<object>()), resolveConfiguration: configure }));
vi.mock('../src/session.js', async (original) => ({ ...(await original<object>()), createCliContext: makeContext }));
vi.mock('../src/commands/download.js', async (original) => ({ ...(await original<object>()), downloadPlanAsset: download }));
vi.mock('../src/commands/login.js', async (original) => ({ ...(await original<object>()), login: loginBrowser }));
vi.mock('../src/commands/logout.js', async (original) => ({ ...(await original<object>()), logout }));
vi.mock('../src/organizations.js', async (original) => ({ ...(await original<object>()), selectedOrganization }));

function terminal(): Terminal & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, stdoutIsTTY: false, interactive: false, columns: 120, write: line => lines.push(line), writeError: line => errors.push(line) };
}

beforeEach(() => {
  vi.clearAllMocks();
  configure.mockReturnValue({ business: false });
  makeContext.mockReturnValue({
    core: {
      getAccessToken: async () => 'token',
      listPlans: vi.fn(async () => ({ items: [], nextCursor: null })),
      listPlanLogs: vi.fn(async () => ({ items: [], total: 0 })),
      getPlan: vi.fn(async () => ({ id: 'plan-1' })),
    },
  });
  download.mockResolvedValue(0);
  loginBrowser.mockResolvedValue(0);
  logout.mockResolvedValue(0);
  selectedOrganization.mockResolvedValue({ id: 'org-1', name: 'Acme' });
});

describe('plan command option routing', () => {
  it('passes list pagination and JSON format to the plan service', async () => {
    const output = terminal();
    await expect(run(['plans', 'list', '--limit', '2', '--cursor', 'cursor-2', '--all', '--json'], {}, output)).resolves.toBe(0);
    const context = makeContext.mock.results[0]?.value;
    expect(context.core.listPlans).toHaveBeenCalledWith({ limit: 2, cursor: 'cursor-2' });
    expect(JSON.parse(output.lines[0] as string)).toMatchObject({ items: [], nextCursor: null });
  });

  it('passes logs pagination and JSON format to the plan service', async () => {
    const output = terminal();
    await expect(run(['plans', 'logs', 'plan-1', '--limit', '5', '--offset', '3', '--json'], {}, output)).resolves.toBe(0);
    const context = makeContext.mock.results[0]?.value;
    expect(context.core.listPlanLogs).toHaveBeenCalledWith('plan-1', { limit: 5, offset: 3 });
    expect(JSON.parse(output.lines[0] as string)).toMatchObject({ items: [], total: 0 });
  });

  it('accepts explicit table output for list and logs', async () => {
    const listOutput = terminal();
    await expect(run(['plans', 'list', '--table'], {}, listOutput)).resolves.toBe(0);
    const logsOutput = terminal();
    await expect(run(['plans', 'logs', 'plan-1', '--table'], {}, logsOutput)).resolves.toBe(0);
    expect(listOutput.lines).toContain('No plans in this Application.');
    expect(logsOutput.lines).toContain('No logs for this plan.');
  });

  it('extracts an organization override before running a Business plan command', async () => {
    configure.mockReturnValue({ business: true });
    const output = terminal();
    await expect(run(['plans', 'list', '--organization', 'org-1', '--json'], {}, output)).resolves.toBe(0);
    expect(selectedOrganization).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ business: true }), expect.any(String), expect.anything(), 'org-1',
    );
    expect(JSON.parse(output.lines[0] as string)).toMatchObject({ organization: { id: 'org-1', name: 'Acme' } });
  });

  it('routes show table and JSON modes to the same plan lookup', async () => {
    const table = terminal();
    await expect(run(['plans', 'show', 'plan-1', '--table'], {}, table)).resolves.toBe(0);
    const json = terminal();
    await expect(run(['plans', 'show', 'plan-1', '--json'], {}, json)).resolves.toBe(0);
    expect(makeContext.mock.results[0]?.value.core.getPlan).toHaveBeenCalledWith('plan-1');
    expect(makeContext.mock.results[1]?.value.core.getPlan).toHaveBeenCalledWith('plan-1');
    expect(JSON.parse(json.lines[0] as string)).toEqual({ id: 'plan-1' });
  });

  it.each([
    ['login', '--device'],
    ['login', '--device', '--device'],
    ['login', '--unknown'],
    ['login', '--device', '--unknown'],
  ])('rejects removed or unsupported login arguments before dispatch: %j', async (...args) => {
    const output = terminal();
    await expect(run(args, {}, output)).resolves.toBe(1);
    expect(loginBrowser).not.toHaveBeenCalled();
    expect(output.errors).toHaveLength(1);
  });

  it('rejects unknown logout arguments before clearing the session', async () => {
    const output = terminal();
    await expect(run(['logout', '--unknown'], {}, output)).resolves.toBe(1);
    expect(logout).not.toHaveBeenCalled();
    expect(output.errors).toHaveLength(1);
  });

  it('rejects malformed list, logs, and download options before command execution', async () => {
    for (const args of [
      ['plans', 'list', '--limit', '0'],
      ['plans', 'logs', 'plan-1', '--offset', '-1'],
      ['plans', 'download', 'plan-1', '--asset', 'document'],
    ]) {
      const output = terminal();
      expect(await run(args, {}, output)).toBe(1);
      expect(output.lines).toEqual([]);
      expect(output.errors.length).toBe(1);
    }
    expect(download).not.toHaveBeenCalled();
  });
});
