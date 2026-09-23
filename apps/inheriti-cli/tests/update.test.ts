import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { notifyCliUpdate } from '../src/commands/update.js';
import type { CliContext } from '../src/session.js';
import type { Terminal } from '../src/output.js';
import { latestIntegrationBuild } from '@safetech/inheriti-elements-core/node';
import type { InternalBuild } from '@safetech/inheriti-elements-core/node';

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
});
