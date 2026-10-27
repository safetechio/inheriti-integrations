import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requireCliUpdate, updateCli } from '../src/commands/update.js';
import type { CliContext } from '../src/session.js';
import type { Terminal } from '../src/output.js';
import { latestIntegrationBuild } from '@safetech/inheriti-elements-core/node-base';
import type { InternalBuild } from '@safetech/inheriti-elements-core/node-base';

const spawnSync = vi.hoisted(() => vi.fn((..._args: unknown[]) => ({ status: 0 })));
const promptSelect = vi.hoisted(() => vi.fn(async () => 'yes'));
vi.mock('node:child_process', async original => ({ ...(await original<object>()), spawnSync }));
vi.mock('../src/render/select.jsx', () => ({ promptSelect }));

const build = (version: string, platform = 'linux-x64'): InternalBuild => ({
  id: version, integration: 'cli', platform, version, fileName: 'cli.tgz', size: 1,
  checksum: '0'.repeat(64), publishedAt: '2026-01-01T00:00:00Z',
});

afterEach(() => {
  vi.doUnmock('../src/configuration.js');
  vi.doUnmock('../src/session.js');
  vi.doUnmock('../src/commands/login.js');
  promptSelect.mockReset().mockResolvedValue('yes');
});

describe('CLI update selection', () => {
  it('only offers a newer build of the installed channel and platform', () => {
    const builds = [build('1.2.1'), build('1.2.0-dev.2'), build('1.2.0-dev.3', 'win32-x64'), build('1.2.0-dev.1')];
    expect(latestIntegrationBuild(builds, 'cli', '1.2.0-dev.1', 'linux-x64')?.version).toBe('1.2.0-dev.2');
    expect(latestIntegrationBuild(builds, 'cli', '1.2.1', 'linux-x64')).toBeUndefined();
  });
  it('prefers semantic version over publication time and never downgrades', () => {
    const older = { ...build('1.2.0-stg.2'), publishedAt: '2026-09-23T00:00:00Z' };
    const newer = { ...build('1.2.0-stg.3'), publishedAt: '2026-09-22T00:00:00Z' };
    expect(latestIntegrationBuild([older, newer], 'cli', '1.2.0-stg.1', 'linux-x64')?.version).toBe('1.2.0-stg.3');
    expect(latestIntegrationBuild([older], 'cli', '1.2.0-stg.3', 'linux-x64')).toBeUndefined();
  });
  it('keeps local builds separate from production', () => {
    expect(latestIntegrationBuild([build('1.2.1'), build('1.2.0-local.2')], 'cli', '1.2.0-local.1', 'linux-x64')?.version).toBe('1.2.0-local.2');
  });
  it('skips guests and blocks after an unavailable update check without caching failure', async () => {
    const load = vi.fn().mockResolvedValueOnce(null).mockResolvedValue({});
    const listInternalBuilds = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
    const context = { sessions: { load }, core: { listInternalBuilds } } as unknown as CliContext;
    const terminal = { interactive: true, write: vi.fn(), writeError: vi.fn() } as unknown as Terminal;
    expect(await requireCliUpdate(context, terminal, '1.2.0-dev.1')).toBe(0);
    expect(await requireCliUpdate(context, terminal, '1.2.0-dev.1')).toBe(1);
    expect(vi.mocked(terminal.writeError).mock.calls.flat().join(' ')).toContain('Could not check for a required update');
    expect(await requireCliUpdate(context, terminal, '1.2.0-dev.1')).toBe(0);
    expect(listInternalBuilds).toHaveBeenCalledTimes(2);
  });

  it('blocks noninteractive commands and declined updates without downloading', async () => {
    const listInternalBuilds = vi.fn(async () => [build('1.2.0-dev.2', `${process.platform}-${process.arch}`)]);
    const requestInternalBuildDownload = vi.fn();
    const context = { sessions: { load: vi.fn(async () => ({})) }, core: { listInternalBuilds, requestInternalBuildDownload } } as unknown as CliContext;
    const terminal = { interactive: false, write: vi.fn(), writeError: vi.fn() } as unknown as Terminal;
    expect(await requireCliUpdate(context, terminal, '1.2.0-dev.1')).toBe(1);
    expect(terminal.write).not.toHaveBeenCalled();
    expect(vi.mocked(terminal.writeError).mock.calls.flat().join(' ')).toContain('inheriti update --install');
    promptSelect.mockResolvedValueOnce('no');
    expect(await requireCliUpdate(context, { ...terminal, interactive: true }, '1.2.0-dev.1')).toBe(1);
    expect(requestInternalBuildDownload).not.toHaveBeenCalled();
  });

  it('shows real download progress and uses npm progress for installation', async () => {
    const bytes = new TextEncoder().encode('package data');
    const release = { ...build('1.2.0-dev.2', `${process.platform}-${process.arch}`), size: bytes.length,
      checksum: createHash('sha256').update(bytes).digest('hex') };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
    const update = vi.fn();
    const close = vi.fn();
    const write = vi.fn();
    const context = { sessions: { load: vi.fn(async () => ({})) }, core: { listInternalBuilds: vi.fn(async () => [release]),
      requestInternalBuildDownload: vi.fn(async () => ({ url: 'https://example.test/package' })) } } as unknown as CliContext;
    const terminal = { interactive: true, write, writeError: vi.fn(),
      createLiveRegion: () => ({ update, close }) } as unknown as Terminal;
    try {
      expect(await updateCli(context, terminal, '1.2.0-dev.1', true)).toBe(0);
      expect(update.mock.calls.flat().join(' ')).toContain('Downloading 100%');
      expect(update.mock.calls.flat().join(' ')).toContain('Verifying package');
      expect(close).toHaveBeenCalledOnce();
      expect(spawnSync.mock.calls[0]?.[1]).toContain('--progress=true');
      expect(spawnSync.mock.calls[0]?.[1]).toContain('--loglevel=error');
      expect(write).toHaveBeenCalledWith('Installed Inheriti CLI 1.2.0-dev.2. Start a new terminal session to use it.');
      expect(await requireCliUpdate(context, terminal, '1.2.0-dev.1')).toBe(2);
      expect(promptSelect).toHaveBeenCalledWith('Update required. Install now?', expect.any(Array));
      expect(write).toHaveBeenCalledWith('Installed Inheriti CLI 1.2.0-dev.2. Rerun your command to use it.');
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('Business CLI routing', () => {
  it.each([['login'], ['organizations', 'list'], ['plans', 'list']])('checks the signed-in session before %s', async (...args) => {
    vi.resetModules();
    const listInternalBuilds = vi.fn(async () => [build('0.0.21', `${process.platform}-${process.arch}`)]);
    const context = { sessions: { load: vi.fn(async () => ({})) }, core: { listInternalBuilds } } as unknown as CliContext;
    const login = vi.fn(async () => 0);
    vi.doMock('../src/configuration.js', async original => ({ ...(await original<object>()), BUILD_DEPLOYMENT: 'dev',
      resolveConfiguration: () => ({ business: true, apiUrl: 'https://business.example' }) }));
    vi.doMock('../src/session.js', async original => ({ ...(await original<object>()), createCliContext: () => context }));
    vi.doMock('../src/commands/login.js', async original => ({ ...(await original<object>()), login }));
    const { run } = await import('../src/main.js');
    const terminal = { interactive: false, write: vi.fn(), writeError: vi.fn() } as unknown as Terminal;
    expect(await run(args, {}, terminal)).toBe(1);
    expect(listInternalBuilds).toHaveBeenCalledOnce();
    if (args[0] === 'login') expect(login).toHaveBeenCalledOnce();
    expect(vi.mocked(terminal.writeError).mock.calls.flat().join(' ')).toContain('inheriti update --install');
  });

  it('lets an authenticated operator abort an open reveal without checking updates', async () => {
    vi.resetModules();
    const directory = await mkdtemp(join(tmpdir(), 'inheriti-cli-abort-update-'));
    const listInternalBuilds = vi.fn(async () => { throw new Error('offline'); });
    const abortPlanAccess = vi.fn(async () => ({ aborted: true }));
    const getAccessToken = vi.fn(async (): Promise<string | undefined> => 'token');
    const context = { sessions: { load: vi.fn(async () => ({ principal: { subject: 'operator' } })) },
      core: { getAccessToken, listOrganizations: vi.fn(async () => [{ id: 'org-1', name: 'One' }]),
        listInternalBuilds, abortPlanAccess } } as unknown as CliContext;
    vi.doMock('../src/configuration.js', async original => ({ ...(await original<object>()), BUILD_DEPLOYMENT: 'dev',
      resolveConfiguration: () => ({ business: true, issuer: 'issuer', environment: 'TEST' }) }));
    vi.doMock('../src/session.js', async original => ({ ...(await original<object>()), createCliContext: () => context }));
    const { run } = await import('../src/main.js');
    const terminal = { interactive: false, write: vi.fn(), writeError: vi.fn() } as unknown as Terminal;
    try {
      expect(await run(['plans', 'abort', 'plan-1'], { XDG_CONFIG_HOME: directory }, terminal)).toBe(0);
      expect(abortPlanAccess).toHaveBeenCalledWith('plan-1');
      expect(listInternalBuilds).not.toHaveBeenCalled();
      getAccessToken.mockResolvedValueOnce(undefined);
      expect(await run(['plans', 'abort', 'plan-1'], { XDG_CONFIG_HOME: directory }, terminal)).toBe(1);
      expect(abortPlanAccess).toHaveBeenCalledTimes(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('preserves re-login guidance when a saved session expires during the update check', async () => {
    vi.resetModules();
    const listInternalBuilds = vi.fn(async () => { throw Object.assign(new Error('expired'), { status: 401 }); });
    const context = { sessions: { load: vi.fn(async () => ({})) }, core: { listInternalBuilds } } as unknown as CliContext;
    vi.doMock('../src/configuration.js', async original => ({ ...(await original<object>()), BUILD_DEPLOYMENT: 'dev',
      resolveConfiguration: () => ({ business: true, apiUrl: 'https://business.example' }) }));
    vi.doMock('../src/session.js', async original => ({ ...(await original<object>()), createCliContext: () => context }));
    const { run } = await import('../src/main.js');
    const terminal = { interactive: false, write: vi.fn(), writeError: vi.fn() } as unknown as Terminal;
    expect(await run(['plans', 'list'], {}, terminal)).toBe(1);
    expect(listInternalBuilds).toHaveBeenCalledOnce();
    expect(vi.mocked(terminal.writeError).mock.calls.flat().join(' ')).toContain('Run `inheriti login` again');
  });

  it('preserves an authentication error without an HTTP status', async () => {
    const context = { sessions: { load: vi.fn(async () => ({})) }, core: {
      listInternalBuilds: vi.fn(async () => { throw Object.assign(new Error('expired'), { code: 'operator_reauthentication_required' }); }),
    } } as unknown as CliContext;
    const terminal = { interactive: false, write: vi.fn(), writeError: vi.fn() } as unknown as Terminal;
    await expect(requireCliUpdate(context, terminal, '1.2.0-dev.1')).rejects.toMatchObject({ code: 'operator_reauthentication_required' });
  });
});
