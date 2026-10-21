import { createHash } from 'node:crypto';
import { closeSync, cpSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = resolve(fileURLToPath(new URL('..', import.meta.url)));
const destination = join(workspace, 'src-tauri', 'workspace-vm');

function assertRegularFile(path, executable = false) {
  const info = lstatSync(path);
  if (!info.isFile() || info.size === 0 || (executable && process.platform !== 'win32' && !(info.mode & 0o111))) {
    throw new Error(`Invalid Workspace VM component: ${path}`);
  }
}

function inventory(path, root, files) {
  const info = lstatSync(path);
  if (info.isSymbolicLink()) throw new Error(`Workspace VM bundle contains a link: ${path}`);
  if (info.isDirectory()) {
    for (const name of readdirSync(path)) inventory(join(path, name), root, files);
  } else if (!info.isFile()) {
    throw new Error(`Workspace VM bundle contains a special file: ${path}`);
  } else {
    files.push(relative(root, path).replaceAll('\\', '/'));
  }
}

function sha256(path) {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const fd = openSync(path, 'r');
  try {
    for (let size; (size = readSync(fd, buffer, 0, buffer.length, null)) > 0;) {
      hash.update(buffer.subarray(0, size));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

export function stageWorkspaceVm(source, platform = process.platform, arch = process.arch, output = destination, pinnedManifestSha256 = process.env.INHERITI_WORKSPACE_VM_MANIFEST_SHA256) {
  if (!source || !isAbsolute(source) || !statSync(source).isDirectory()) {
    throw new Error('INHERITI_WORKSPACE_VM_DIR must be an existing absolute directory');
  }
  const destinationFromSource = relative(resolve(source), output);
  if (!destinationFromSource.startsWith('..') && !isAbsolute(destinationFromSource)) {
    throw new Error('Workspace VM source must not contain the staging destination');
  }
  const qemuArch = arch === 'x64' ? 'x86_64' : arch === 'arm64' ? 'aarch64' : null;
  if (!qemuArch || !['linux', 'darwin', 'win32'].includes(platform)) {
    throw new Error(`Unsupported Workspace VM host: ${platform}/${arch}`);
  }
  const qemuName = `qemu-system-${qemuArch}${platform === 'win32' ? '.exe' : ''}`;
  for (const name of [qemuName, 'vmlinuz', 'initramfs']) {
    assertRegularFile(join(source, name), name === qemuName);
  }
  const virglResources = [
    `adapters/spreadsheet/gridcraft/${qemuArch}/`,
    `adapters/document/wordcraft/${qemuArch}/`,
  ];
  const hasVirglAdapter = (() => {
    const files = [];
    inventory(source, source, files);
    return files.some((name) => virglResources.some((prefix) => name.startsWith(prefix)));
  })();
  if (hasVirglAdapter) {
    assertRegularFile(join(source, 'initramfs-virgl'));
  }
  const licenses = join(source, 'LICENSES');
  if (!statSync(licenses).isDirectory() || readdirSync(licenses).length === 0) {
    throw new Error('Workspace VM bundle requires a nonempty LICENSES directory');
  }
  const files = [];
  inventory(source, source, files);
  const manifestName = 'manifest.sha256.json';
  if (!files.includes(manifestName)) throw new Error('Workspace VM manifest missing');
  if (!/^[a-f0-9]{64}$/i.test(pinnedManifestSha256 ?? '')) {
    throw new Error('INHERITI_WORKSPACE_VM_MANIFEST_SHA256 must be a pinned SHA-256 hash');
  }
  const manifestPath = join(source, manifestName);
  if (sha256(manifestPath) !== pinnedManifestSha256.toLowerCase()) {
    throw new Error('Workspace VM manifest SHA-256 mismatch');
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest?.schema !== 1 || !manifest.files || Array.isArray(manifest.files) || typeof manifest.files !== 'object') {
    throw new Error('Invalid Workspace VM manifest schema');
  }
  const actualFiles = files.filter((name) => name !== manifestName).sort();
  const expectedFiles = Object.keys(manifest.files).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error('Workspace VM manifest file inventory mismatch');
  }
  for (const name of actualFiles) {
    const expected = manifest.files[name];
    if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/i.test(expected) || sha256(join(source, name)) !== expected.toLowerCase()) {
      throw new Error(`Workspace VM SHA-256 mismatch: ${name}`);
    }
  }
  const displayBinaries = actualFiles.filter((name) => name === qemuName || /(?:^|\/)ui-sdl\.(?:so|dll|dylib)$/.test(name));
  const displayBytes = displayBinaries.map((name) => readFileSync(join(source, name)));
  if (!displayBytes.some((bytes) => bytes.includes(Buffer.from('Inheriti® Workspace'))) ||
      displayBytes.some((bytes) => bytes.includes(Buffer.from('QEMU (%s-%d)%s')))) {
    throw new Error('Workspace VM must use the branded SDL window title');
  }
  const staging = `${output}.staging-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  try {
    mkdirSync(staging, { recursive: true });
    cpSync(source, staging, { recursive: true, force: true, errorOnExist: false });
    const stagedFiles = [];
    inventory(staging, staging, stagedFiles);
    if (JSON.stringify(stagedFiles.sort()) !== JSON.stringify(files.sort())) {
      throw new Error('Staged Workspace VM file inventory mismatch');
    }
    if (sha256(join(staging, manifestName)) !== pinnedManifestSha256.toLowerCase()) {
      throw new Error('Staged Workspace VM manifest SHA-256 mismatch');
    }
    for (const name of actualFiles) {
      if (sha256(join(staging, name)) !== manifest.files[name].toLowerCase()) {
        throw new Error(`Staged Workspace VM SHA-256 mismatch: ${name}`);
      }
    }
    rmSync(output, { recursive: true, force: true });
    renameSync(staging, output);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  console.log(`Staged Workspace VM bundle (${platform}/${arch}): ${basename(output)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    stageWorkspaceVm(process.env.INHERITI_WORKSPACE_VM_DIR);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
