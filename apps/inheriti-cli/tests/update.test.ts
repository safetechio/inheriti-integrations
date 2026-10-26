import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { notifyCliUpdate, updateCli } from '../src/commands/update.js';
import type { CliContext } from '../src/session.js';
import type { Terminal } from '../src/output.js';
import { latestIntegrationBuild } from '@safetech/inheriti-elements-core/node-base';
import type { InternalBuild } from '@safetech/inheriti-elements-core/node-base';

const spawnSync = vi.hoisted(() => vi.fn((..._args: unknown[]) => ({ status: 0 })));
vi.mock('node:child_process', async original => ({ ...(await original<object>()), spawnSync }));
vi.mock('../src/render/select.jsx', () => ({ promptSelect: vi.fn(async () => 'yes') }));

const build = (version: string, platform = 'linux-x64'): InternalBuild => ({
  id: version, integration: 'cli', platform, version, fileName: 'cli.tgz', size: 1,
  checksum: '0'.repeat(64), publishedAt: '2026-01-01T00:00:00Z',
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
  it('notifies interactive signed-in users once per day without printing download details', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'inheriti-update-test-'));
    try {
      const listInternalBuilds = vi.fn().mockResolvedValue([build('1.2.0-dev.2')]);
      const writeError = vi.fn();
      const context = { sessions: { load: vi.fn().mockResolvedValue({}) }, core: { listInternalBuilds } } as unknown as CliContext;
      const terminal = { interactive: true, writeError } as unknown as Terminal;
      const marker = join(directory, 'session.json');
      await notifyCliUpdate(context, terminal, '1.2.0-dev.1', marker);
      await notifyCliUpdate(context, terminal, '1.2.0-dev.1', marker);
      expect(listInternalBuilds).toHaveBeenCalledTimes(1);
      expect(writeError).toHaveBeenCalledWith('Inheriti CLI 1.2.0-dev.2 is available. Run inheriti update --install.');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('shows real download progress and uses npm progress for installation', async () => {
    const bytes = new TextEncoder().encode('package data');
    const release = { ...build('1.2.0-dev.2', `${process.platform}-${process.arch}`), size: bytes.length,
      checksum: createHash('sha256').update(bytes).digest('hex') };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
    const update = vi.fn();
    const close = vi.fn();
    const write = vi.fn();
    const context = { core: { listInternalBuilds: vi.fn(async () => [release]),
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
    } finally { vi.unstubAllGlobals(); }
  });
});
