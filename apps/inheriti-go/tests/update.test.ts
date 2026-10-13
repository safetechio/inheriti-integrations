import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { InternalBuild } from '@safetech/inheriti-elements-core/node';
import { downloadGoUpdate, installMacGoUpdate, relaunchGoAppImage, replaceGoAppImage, runWindowsGoInstaller } from '../src/modules/launcher/main/update.js';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

it('downloads a verified update without overwriting an existing file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'go-update-'));
  const bytes = new Uint8Array([1, 2, 3]);
  const build = { size: bytes.length, checksum: createHash('sha256').update(bytes).digest('hex') } as InternalBuild;
  globalThis.fetch = vi.fn().mockImplementation(() => Promise.resolve({ ...new Response(bytes), ok: true, body: new Response(bytes).body, url: 'https://updates.test/go' }));
  try {
    const target = join(directory, 'go.AppImage');
    const progress = vi.fn();
    await downloadGoUpdate(build, 'https://updates.test/go', target, progress);
    expect(progress).toHaveBeenLastCalledWith(3, 3);
    expect(await readFile(target)).toEqual(Buffer.from(bytes));
    if (process.platform === 'linux') expect((await stat(target)).mode & 0o777).toBe(0o700);
    await expect(downloadGoUpdate(build, 'https://updates.test/go', target)).rejects.toThrow();
    expect(await readFile(target)).toEqual(Buffer.from(bytes));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('deletes a corrupt partial download', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'go-update-'));
  const build = { size: 3, checksum: '0'.repeat(64) } as InternalBuild;
  globalThis.fetch = vi.fn().mockImplementation(() => Promise.resolve({ ok: true, body: new Response(new Uint8Array([1, 2, 3])).body, url: 'https://updates.test/go' }));
  try {
    await expect(downloadGoUpdate(build, 'https://updates.test/go', join(directory, 'go.AppImage'))).rejects.toThrow('integrity');
    expect(await readdir(directory)).toEqual([]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('replaces the active AppImage and retains the previous executable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'go-update-'));
  try {
    const current = join(directory, 'go.AppImage');
    const downloaded = join(directory, 'new.AppImage');
    await writeFile(current, 'old');
    await writeFile(downloaded, 'new');
    expect(await replaceGoAppImage(downloaded, current)).toBe(true);
    expect(await readFile(current, 'utf8')).toBe('new');
    const staging = (await readdir(directory)).find((name) => name.startsWith('.inheriti-go-update-'))!;
    expect(await readFile(join(directory, staging, 'previous.AppImage'), 'utf8')).toBe('old');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('restarts an AppImage after its old process exits without inheriting the old mount libraries', async () => {
  const quit = vi.fn();
  const unref = vi.fn();
  const start = vi.fn().mockImplementation(() => ({
    once(event: string, callback: () => void) { if (event === 'spawn') queueMicrotask(callback); return this; }, unref,
  }));
  await relaunchGoAppImage('/downloads/go.AppImage', quit, ['--inheriti-go-background'], start);
  const [executable, args, options] = start.mock.calls[0]!;
  expect(executable).toBe('/bin/sh');
  expect(args.slice(-3)).toEqual([String(process.pid), '/downloads/go.AppImage', '--inheriti-go-background']);
  expect(args[1]).toContain('kill -0 "$1"');
  expect(args[1]).toContain('exec "$executable" --ozone-platform=x11 "$@"');
  expect(options).toEqual(expect.objectContaining({ detached: true, stdio: 'ignore' }));
  expect(options.env).not.toHaveProperty('APPDIR');
  expect(options.env).not.toHaveProperty('APPIMAGE');
  expect(options.env).not.toHaveProperty('LD_LIBRARY_PATH');
  expect(unref).toHaveBeenCalledOnce();
  expect(quit).toHaveBeenCalledOnce();
});

it('starts the Windows installer silently and quits after spawn', async () => {
  const quit = vi.fn();
  const unref = vi.fn();
  const start = vi.fn().mockImplementation(() => ({ once(event: string, callback: () => void) { if (event === 'spawn') queueMicrotask(callback); return this; }, unref }));
  await runWindowsGoInstaller('installer.exe', quit, start);
  expect(start).toHaveBeenCalledWith('installer.exe', ['/S'], { detached: true, stdio: 'ignore', windowsHide: true });
  expect(unref).toHaveBeenCalledOnce();
  expect(quit).toHaveBeenCalledOnce();
});

it('passes a verified ZIP feed to the macOS updater and installs after download', async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const build = { fileName: 'go.zip', size: bytes.length, checksum } as InternalBuild;
  const signedUrl = 'https://updates.test/go.zip';
  const localFetch = globalThis.fetch;
  globalThis.fetch = vi.fn().mockImplementation(() => Promise.resolve({ ok: true, body: new Response(bytes).body, url: signedUrl }));
  const order: string[] = [];
  const updater = Object.assign(new EventEmitter(), {
    setFeedURL: vi.fn(), checkForUpdates: vi.fn(), quitAndInstall: vi.fn(() => { order.push('install'); }),
  });
  updater.checkForUpdates.mockImplementation(() => {
    void localFetch(updater.setFeedURL.mock.calls[0]![0].url).then(response => response.json()).then(async feed => {
      expect(feed.url).toMatch(/^http:\/\/127\.0\.0\.1:/u);
      expect(new Uint8Array(await (await localFetch(feed.url)).arrayBuffer())).toEqual(bytes);
      updater.emit('update-downloaded');
    }).catch(error => updater.emit('error', error));
  });
  await installMacGoUpdate(build, signedUrl, updater as never, () => { order.push('prepare'); }, undefined, () => { order.push('downloaded'); });
  expect(order).toEqual(['downloaded', 'prepare', 'install']);
  expect(updater.quitAndInstall).toHaveBeenCalledOnce();
  await expect(installMacGoUpdate({ ...build, fileName: 'go.dmg' }, signedUrl, updater as never, () => {}))
    .rejects.toThrow('Invalid macOS update');
  await expect(installMacGoUpdate({ ...build, checksum: '0'.repeat(64) }, signedUrl, updater as never, () => {}))
    .rejects.toThrow('integrity');
  expect(updater.quitAndInstall).toHaveBeenCalledOnce();
});
