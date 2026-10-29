import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const originalLoad = Module._load;
const updatesPath = path.resolve(process.cwd(), 'electron/lib/updates.cjs');
const originalAppImage = process.env.APPIMAGE;
const originalEnvironment = process.env.INHERITI_ENV;

type Runtime = {
  capture: () => { subject: string; generation: number };
  getAccessToken: (capture: { subject: string; generation: number }) => Promise<string>;
  isCurrent: (capture: { subject: string; generation: number }) => boolean;
  environment: string;
};

function runtime(): Runtime {
  return {
    capture: () => ({ subject: 'operator-1', generation: 1 }),
    getAccessToken: async () => 'operator-token',
    isCurrent: () => true,
    environment: 'TEST',
  };
}

function loadUpdates(isPackaged: boolean) {
  const app = { isPackaged, getVersion: () => '0.1.1', quit: vi.fn() };
  const shell = { openPath: vi.fn(async () => ''), showItemInFolder: vi.fn() };
  const bearerApiFetch = vi.fn();
  Module._load = function (id: string, parent: unknown, isMain: boolean) {
    if (id === 'electron') return { app, shell };
    if (id === './api-transport.cjs' || id.endsWith('/electron/lib/api-transport.cjs'))
      return { bearerApiFetch };
    return originalLoad.call(this, id, parent, isMain);
  };
  delete require.cache[updatesPath];
  const updates = require(updatesPath);
  Module._load = originalLoad;
  return { app, shell, bearerApiFetch, updates };
}

afterEach(() => {
  Module._load = originalLoad;
  delete require.cache[updatesPath];
  if (originalAppImage === undefined) delete process.env.APPIMAGE;
  else process.env.APPIMAGE = originalAppImage;
  if (originalEnvironment === undefined) delete process.env.INHERITI_ENV;
  else process.env.INHERITI_ENV = originalEnvironment;
  vi.unstubAllGlobals();
});

it('rejects a corrupt catalog download before opening or replacing it', async () => {
  process.env.INHERITI_ENV = 'dev';
  process.env.APPIMAGE = '';
  const harness = loadUpdates(true);
  const platform = `${process.platform}-${process.arch}`;
  harness.bearerApiFetch
    .mockResolvedValueOnce({
      status: 200,
      body: {
        result: {
          items: [{
            id: 'build-1', integration: 'importer', platform, version: '0.1.2-dev.0',
            fileName: 'Inheriti-Importer-dev-0.1.2-dev.0-linux-x64.AppImage',
            size: 7, checksum: 'a'.repeat(64),
          }],
        },
      },
    })
    .mockResolvedValueOnce({ status: 201, body: { url: 'https://storage.inheriti.test/update' } });
  const response = new Response('corrupt');
  Object.defineProperty(response, 'url', { value: 'https://storage.inheriti.test/update' });
  vi.stubGlobal('fetch', vi.fn(async () => response));

  await expect(harness.updates.installUpdate('build-1', runtime())).rejects.toThrow('checksum mismatch');
  expect(harness.bearerApiFetch.mock.calls.map(([request]: [{ path: string }]) => request.path)).toEqual([
    '/integrations/v1/internal-builds',
    '/integrations/v1/internal-builds/build-1/download',
  ]);
  expect(harness.bearerApiFetch.mock.calls[0][0]).toMatchObject({
    token: 'operator-token', environment: 'TEST', method: 'GET',
  });
  expect(harness.shell.openPath).not.toHaveBeenCalled();
});

it('replaces a writable AppImage and retains the previous executable', async () => {
  const harness = loadUpdates(false);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'importer-update-test-'));
  try {
    process.env.APPIMAGE = path.join(directory, 'Importer.AppImage');
    const downloaded = path.join(directory, 'downloaded.AppImage');
    await writeFile(process.env.APPIMAGE, 'previous');
    await writeFile(downloaded, 'verified-update');

    expect(await harness.updates.replaceAppImage(downloaded)).toBe(true);
    expect(await readFile(process.env.APPIMAGE, 'utf8')).toBe('verified-update');
    const staging = (await readdir(directory)).find((name) => name.startsWith('.inheriti-update-'));
    expect(staging).toBeDefined();
    expect(await readFile(path.join(directory, staging!, 'previous.AppImage'), 'utf8')).toBe('previous');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('starts a verified Windows installer silently before quitting', async () => {
  const harness = loadUpdates(false);
  const installer = Object.assign(new EventEmitter(), { unref: vi.fn() });
  const start = vi.fn(() => {
    queueMicrotask(() => installer.emit('spawn'));
    return installer;
  });

  await harness.updates.runWindowsInstaller('C:\\Verified Update\\Importer.exe', start);

  expect(start).toHaveBeenCalledWith('C:\\Verified Update\\Importer.exe', ['/S'], {
    detached: true, stdio: 'ignore', windowsHide: true,
  });
  expect(installer.unref).toHaveBeenCalledOnce();
  expect(harness.app.quit).toHaveBeenCalledOnce();
});
