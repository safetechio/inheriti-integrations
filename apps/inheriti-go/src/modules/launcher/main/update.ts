import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { constants, createReadStream } from 'node:fs';
import { access, chmod, copyFile, lstat, mkdtemp, open, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { InternalBuild } from '@safetech/inheriti-elements-core/node';
import type { autoUpdater } from 'electron';

export type GoUpdateProgress = { phase: 'downloading' | 'installing' | 'restarting'; version: string; percent?: number } | null;

export async function downloadGoUpdate(build: InternalBuild, url: string, destination: string,
  onProgress?: (downloaded: number, total: number) => void): Promise<void> {
  if (!/^https:\/\//u.test(url) || !Number.isSafeInteger(build.size) || build.size < 1 || !/^[a-f0-9]{64}$/u.test(build.checksum)) {
    throw new Error('Invalid update metadata.');
  }
  if (build.size > 1073741824) throw new Error('Invalid update metadata.');
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok || !response.body || !response.url.startsWith('https://')) throw new Error('Update download failed.');
  const file = await open(destination, 'wx', 0o600);
  let complete = false;
  try {
    const hash = createHash('sha256');
    const reader = response.body.getReader();
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > build.size) throw new Error('Update integrity check failed.');
      hash.update(value);
      for (let offset = 0; offset < value.length;) offset += (await file.write(value, offset)).bytesWritten;
      onProgress?.(size, build.size);
    }
    if (size !== build.size || hash.digest('hex') !== build.checksum) throw new Error('Update integrity check failed.');
    if (process.platform === 'linux') await file.chmod(0o700);
    complete = true;
  } finally {
    await file.close();
    if (!complete) await rm(destination, { force: true });
  }
}

export async function replaceGoAppImage(downloaded: string, current = process.env.APPIMAGE): Promise<boolean> {
  if (!current || !isAbsolute(current)) return false;
  const directory = dirname(current);
  try {
    if (!(await lstat(current)).isFile()) return false;
    await access(directory, constants.W_OK);
  } catch { return false; }
  const staging = await mkdtemp(join(directory, '.inheriti-go-update-'));
  const replacement = join(staging, 'Inheriti-Go.AppImage');
  try {
    await copyFile(downloaded, replacement, constants.COPYFILE_EXCL);
    await chmod(replacement, (await stat(current)).mode & 0o777);
    await copyFile(current, join(staging, 'previous.AppImage'), constants.COPYFILE_EXCL);
    await rename(replacement, current);
    return true;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function relaunchGoAppImage(current: string, quit: () => void,
  args: string[] = [], start = spawn): Promise<void> {
  const environment = { ...process.env };
  delete environment.APPDIR;
  delete environment.APPIMAGE;
  delete environment.LD_LIBRARY_PATH;
  const launcher = start('/bin/sh', [
    '-c',
    'i=0; while kill -0 "$1" 2>/dev/null && [ "$i" -lt 40 ]; do sleep 0.05; i=$((i+1)); done; executable="$2"; shift 2; exec "$executable" --ozone-platform=x11 "$@"',
    'sh', String(process.pid), current, ...args,
  ], { detached: true, stdio: 'ignore', env: environment });
  await new Promise<void>((resolve, reject) => {
    launcher.once('spawn', resolve);
    launcher.once('error', reject);
  });
  launcher.unref();
  quit();
}

export async function runWindowsGoInstaller(destination: string, quit: () => void, start = spawn): Promise<void> {
  const installer = start(destination, ['/S'], { detached: true, stdio: 'ignore', windowsHide: true });
  await new Promise<void>((resolve, reject) => {
    installer.once('spawn', resolve);
    installer.once('error', reject);
  });
  installer.unref();
  quit();
}

let macUpdateRunning = false;

export async function installMacGoUpdate(build: InternalBuild, url: string, updater: typeof autoUpdater,
  prepareToQuit: () => void, onProgress?: (downloaded: number, total: number) => void, onDownloaded?: () => void): Promise<void> {
  if (macUpdateRunning || !build.fileName.endsWith('.zip') || !/^https:\/\//u.test(url) ||
    !Number.isSafeInteger(build.size) || build.size < 1 || !/^[a-f0-9]{64}$/u.test(build.checksum)) throw new Error('Invalid macOS update.');
  macUpdateRunning = true;
  const token = randomUUID();
  let directory: string | undefined;
  let feed: ReturnType<typeof createServer> | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), 'inheriti-go-update-'));
    const archive = join(directory, build.fileName);
    await downloadGoUpdate(build, url, archive, onProgress);
    onDownloaded?.();
    const server = createServer((request, response) => {
      if (request.method !== 'GET') { response.writeHead(405).end(); return; }
      if (request.url === `/${token}/archive`) {
        response.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': build.size });
        createReadStream(archive).on('error', () => response.destroy()).pipe(response);
        return;
      }
      if (request.url !== `/${token}`) { response.writeHead(404).end(); return; }
      const address = server.address();
      if (!address || typeof address === 'string') { response.writeHead(503).end(); return; }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ url: `http://127.0.0.1:${address.port}/${token}/archive` }));
    });
    feed = server;
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Update feed unavailable.');
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        updater.removeListener('update-downloaded', downloaded);
        updater.removeListener('update-not-available', unavailable);
        updater.removeListener('error', failed);
      };
      const downloaded = () => { finish(); try { prepareToQuit(); updater.quitAndInstall(); resolve(); } catch (error) { reject(error); } };
      const unavailable = () => { finish(); reject(new Error('Update not available.')); };
      const failed = (error: Error) => { finish(); reject(error); };
      updater.once('update-downloaded', downloaded);
      updater.once('update-not-available', unavailable);
      updater.once('error', failed);
      try {
        updater.setFeedURL({ url: `http://127.0.0.1:${address.port}/${token}` });
        updater.checkForUpdates();
      } catch (error) { finish(); reject(error); }
    });
  } finally {
    if (feed?.listening) feed.close();
    if (directory) await rm(directory, { recursive: true, force: true });
    macUpdateRunning = false;
  }
}
