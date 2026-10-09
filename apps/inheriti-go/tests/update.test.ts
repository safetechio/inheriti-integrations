import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { InternalBuild } from '@safetech/inheriti-elements-core/node';
import { downloadGoUpdate } from '../src/modules/launcher/main/update.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

it('downloads a verified update without overwriting an existing file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'go-update-'));
  const bytes = new Uint8Array([1, 2, 3]);
  const build = { size: bytes.length, checksum: createHash('sha256').update(bytes).digest('hex') } as InternalBuild;
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(bytes));
  try {
    const target = join(directory, 'go.AppImage');
    await downloadGoUpdate(build, 'https://updates.test/go', target);
    expect(await readFile(target)).toEqual(Buffer.from(bytes));
    if (process.platform === 'linux') expect((await stat(target)).mode & 0o777).toBe(0o700);
    await expect(downloadGoUpdate(build, 'https://updates.test/go', target)).rejects.toThrow();
    expect(await readFile(target)).toEqual(Buffer.from(bytes));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('deletes a corrupt partial download', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'go-update-'));
  const build = { size: 3, checksum: '0'.repeat(64) } as InternalBuild;
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
  try {
    await expect(downloadGoUpdate(build, 'https://updates.test/go', join(directory, 'go.AppImage'))).rejects.toThrow('integrity');
    expect(await readdir(directory)).toEqual([]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
