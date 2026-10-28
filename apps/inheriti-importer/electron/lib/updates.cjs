const { app, shell } = require('electron');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { apiFetch, ensureCsrf } = require('./api-transport.cjs');
const { captureActiveContext, isCurrent } = require('./api-session.cjs');

const channel = process.env.INHERITI_ENV || 'dev';
const version = app.isPackaged ? app.getVersion() : `${app.getVersion()}-${channel}.0`;

function platformName() {
  return `${process.platform}-${process.arch}`;
}

function newer(candidate, current) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-(dev|stg)\.(\d+))?$/.exec(value);
    return match
      ? [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[5] || 0)]
      : null;
  };
  const a = parse(candidate);
  const b = parse(current);
  if (!a || !b) return false;
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return a[index] > b[index];
  }
  return false;
}

async function replaceAppImage(downloaded) {
  const current = process.env.APPIMAGE;
  if (!current || !path.isAbsolute(current)) return false;
  const directory = path.dirname(current);
  try {
    if (!(await fs.lstat(current)).isFile()) return false;
    await fs.access(directory, constants.W_OK);
  } catch {
    return false;
  }

  const stagingDirectory = await fs.mkdtemp(path.join(directory, '.inheriti-update-'));
  const staged = path.join(stagingDirectory, 'Inheriti-Importer.AppImage');
  const backup = path.join(stagingDirectory, 'previous.AppImage');
  try {
    await fs.copyFile(downloaded, staged, constants.COPYFILE_EXCL);
    await fs.chmod(staged, (await fs.stat(current)).mode & 0o777);
    await fs.copyFile(current, backup, constants.COPYFILE_EXCL);
    await fs.rename(staged, current);
    return true;
  } catch (error) {
    await fs.rm(staged, { force: true });
    await fs.rm(backup, { force: true });
    await fs.rmdir(stagingDirectory);
    throw error;
  }
}

async function runWindowsInstaller(destination, start = spawn) {
  const installer = start(destination, ['/S'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  await new Promise((resolve, reject) => {
    installer.once('spawn', resolve);
    installer.once('error', reject);
  });
  installer.unref();
  app.quit();
}

async function availableUpdate() {
  if (!app.isPackaged) return { version, update: null };
  try {
    const capture = captureActiveContext();
    if (!capture.context) throw new Error('AUTH_SIGNED_OUT');
    const response = await apiFetch({
      method: 'GET',
      path: '/integrations/internal-builds',
      context: capture.context,
    });
    if (!isCurrent(capture)) throw new Error('AUTH_CONTEXT_CHANGED');
    if (response.status !== 200) throw new Error('Could not check for Importer updates');
    const items = response.body?.result?.items;
    if (!Array.isArray(items)) throw new Error('Invalid update catalog');
    const platform = platformName();
    const update = items
      .filter(
        (item) =>
          item.integration === 'importer' &&
          item.platform === platform &&
          typeof item.version === 'string' &&
          (channel === 'prod'
            ? /^\d+\.\d+\.\d+$/.test(item.version)
            : item.version.endsWith(`-${channel}.0`)) &&
          newer(item.version, version),
      )
      .sort((a, b) => (newer(a.version, b.version) ? -1 : 1))[0];
    return { version, update: update ? { id: update.id, version: update.version } : null };
  } catch {
    return { version, update: null, error: 'Update check unavailable' };
  }
}

async function installUpdate(id) {
  if (!app.isPackaged) throw new Error('Updates require an installed Importer');
  const capture = captureActiveContext();
  if (!capture.context) throw new Error('AUTH_SIGNED_OUT');
  const response = await apiFetch({
    method: 'GET',
    path: '/integrations/internal-builds',
    context: capture.context,
  });
  if (!isCurrent(capture)) throw new Error('AUTH_CONTEXT_CHANGED');
  if (response.status !== 200) throw new Error('Could not verify update');
  const item = response.body?.result?.items?.find((entry) => entry.id === id);
  if (
    !item ||
    item.integration !== 'importer' ||
    item.platform !== platformName() ||
    !newer(item.version, version) ||
    (channel === 'prod'
      ? !/^\d+\.\d+\.\d+$/.test(item.version)
      : !item.version.endsWith(`-${channel}.0`)) ||
    !/^[a-f0-9]{64}$/.test(item.checksum) ||
    !Number.isSafeInteger(item.size) ||
    item.size < 1 ||
    item.size > 1073741824 ||
    !/^[a-zA-Z0-9._-]+$/.test(item.fileName) ||
    !item.fileName.endsWith({ win32: '.exe', darwin: '.dmg', linux: '.AppImage' }[process.platform])
  )
    throw new Error('Invalid update');
  await ensureCsrf(capture.context);
  if (!isCurrent(capture)) throw new Error('AUTH_CONTEXT_CHANGED');
  const link = await apiFetch({
    context: capture.context,
    method: 'POST',
    path: `/integrations/internal-builds/${encodeURIComponent(id)}/download`,
  });
  if (!isCurrent(capture)) throw new Error('AUTH_CONTEXT_CHANGED');
  if (
    (link.status !== 200 && link.status !== 201) ||
    typeof link.body?.url !== 'string' ||
    new URL(link.body.url).protocol !== 'https:'
  )
    throw new Error('Invalid download URL');

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'inheriti-importer-update-'));
  const destination = path.join(directory, item.fileName);
  try {
    const download = await fetch(link.body.url, { redirect: 'error' });
    if (!download.ok || new URL(download.url).protocol !== 'https:' || !download.body)
      throw new Error('Update download failed');
    const file = await fs.open(destination, 'wx', 0o600);
    const hash = createHash('sha256');
    let size = 0;
    try {
      for await (const chunk of download.body) {
        size += chunk.length;
        if (size > item.size) throw new Error('Update size mismatch');
        hash.update(chunk);
        let offset = 0;
        while (offset < chunk.length) {
          const result = await file.write(chunk, offset, chunk.length - offset);
          offset += result.bytesWritten;
        }
      }
    } finally {
      await file.close();
    }
    if (size !== item.size || hash.digest('hex') !== item.checksum)
      throw new Error('Update checksum mismatch');
    if (process.platform === 'linux') {
      if (await replaceAppImage(destination)) {
        await fs.rm(directory, { recursive: true, force: true });
        return { installed: true };
      }
      shell.showItemInFolder(destination);
      return { installed: false, openedInstaller: false };
    }
    if (process.platform === 'win32') {
      await runWindowsInstaller(destination);
      return { installed: true };
    }
    const error = await shell.openPath(destination);
    if (error) throw new Error(error);
    return { installed: false, openedInstaller: true };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { availableUpdate, installUpdate, newer, replaceAppImage, runWindowsInstaller };
