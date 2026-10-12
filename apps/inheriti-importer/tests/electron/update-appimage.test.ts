import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { fakeEvent, loadMain, unloadMain } from './support/main-harness';

const require = createRequire(import.meta.url);
const originalAppImage = process.env.APPIMAGE;

afterEach(() => {
  if (originalAppImage === undefined) delete process.env.APPIMAGE;
  else process.env.APPIMAGE = originalAppImage;
  unloadMain();
  vi.unstubAllGlobals();
});

it('rejects a corrupt catalog download before opening or replacing it', async () => {
  process.env.INHERITI_API_ORIGIN = 'https://api.inheriti.test';
  const harness = await loadMain();
  harness.electronMock.app.isPackaged = true;
  const platform = `${process.platform}-${process.arch}`;
  harness.queueNetResponse({
    status: 200,
    body: JSON.stringify({
      ok: true,
      result: {
        items: [
          {
            id: 'build-1',
            integration: 'importer',
            platform,
            version: '0.1.2-dev.0',
            fileName: 'Inheriti-Importer-dev-0.1.2-dev.0-linux-x64.AppImage',
            size: 7,
            checksum: 'a'.repeat(64),
          },
        ],
      },
    }),
  });
  harness.queueNetResponse({ status: 200, body: JSON.stringify({ result: { token: 'csrf' } }) });
  harness.queueNetResponse({
    status: 201,
    body: JSON.stringify({ url: 'https://storage.inheriti.test/update' }),
  });
  const response = new Response('corrupt');
  Object.defineProperty(response, 'url', { value: 'https://storage.inheriti.test/update' });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response),
  );

  const handler = harness.ipcHandlers.get('update:install')!;
  await expect(handler(fakeEvent(harness.windows[0].webContents.id), 'build-1')).rejects.toThrow(
    'checksum mismatch',
  );
  expect(harness.netRequests.map((request) => request.method)).toEqual(['GET', 'GET', 'POST']);
  expect(harness.netRequests[2].url).toBe(
    'https://api.inheriti.test/integrations/internal-builds/build-1/download',
  );
  expect(harness.netRequests[2].request.headers['x-csrf-token']).toBe('csrf');
  expect(harness.shell.openPath).not.toHaveBeenCalled();
  delete process.env.INHERITI_API_ORIGIN;
});

it('replaces a writable AppImage and retains the previous executable', async () => {
  await loadMain();
  const { replaceAppImage } = require('../../electron/lib/updates.cjs');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'importer-update-test-'));
  try {
    process.env.APPIMAGE = path.join(directory, 'Importer.AppImage');
    const downloaded = path.join(directory, 'downloaded.AppImage');
    await writeFile(process.env.APPIMAGE, 'previous');
    await writeFile(downloaded, 'verified-update');

    expect(await replaceAppImage(downloaded)).toBe(true);
    expect(await readFile(process.env.APPIMAGE, 'utf8')).toBe('verified-update');
    const staging = (await readdir(directory)).find((name) => name.startsWith('.inheriti-update-'));
    expect(staging).toBeDefined();
    expect(await readFile(path.join(directory, staging!, 'previous.AppImage'), 'utf8')).toBe(
      'previous',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('starts a verified Windows installer silently before quitting', async () => {
  const harness = await loadMain();
  const { runWindowsInstaller } = require('../../electron/lib/updates.cjs');
  const installer = Object.assign(new EventEmitter(), { unref: vi.fn() });
  const start = vi.fn(() => {
    queueMicrotask(() => installer.emit('spawn'));
    return installer;
  });

  await runWindowsInstaller('C:\\Verified Update\\Importer.exe', start);

  expect(start).toHaveBeenCalledWith('C:\\Verified Update\\Importer.exe', ['/S'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  expect(installer.unref).toHaveBeenCalledOnce();
  expect(harness.electronMock.app.quit).toHaveBeenCalledOnce();
});
