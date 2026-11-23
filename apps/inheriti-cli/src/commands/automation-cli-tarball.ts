import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const maxTarball = 32 * 1024 * 1024;
const invalidTarball = 'automation_cli_tarball_invalid';
const manifestPath = 'package/package.json';
const deploymentPath = 'package/dist/build-deployment.json';
const executablePath = 'package/dist/main.js';

export async function readCliTarball(path: string): Promise<Buffer | undefined> {
  if (!path.endsWith('.tgz')) return;
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size < 1 || info.size > maxTarball) return;
      const bytes = Buffer.alloc(info.size + 1);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset === info.size) return bytes.subarray(0, offset);
    } finally { await file.close(); }
  } catch { return; }
}

function tarEntries(bytes: Buffer): Map<string, Buffer> {
  const tar = gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 });
  const paths = new Set<string>();
  const entries = new Map<string, Buffer>();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      if (tar.subarray(offset).every(byte => byte === 0)) return entries;
      break;
    }
    const field = (start: number, end: number) => header.toString('utf8', start, end).split('\0', 1)[0]!;
    const sizeField = field(124, 136).trim();
    const checksumField = field(148, 156).trim();
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (field(257, 263) !== 'ustar' || !/^[0-7]+$/u.test(sizeField) ||
        !/^[0-7]+$/u.test(checksumField) || parseInt(checksumField, 8) !== checksum) break;
    const size = parseInt(sizeField, 8);
    const start = offset + 512;
    const prefix = field(345, 500);
    const name = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100);
    const path = name.replace(/\/$/u, '');
    const parts = path.split('/');
    const type = header[156];
    const regular = type === 0 || type === 48;
    // Reject extension records that could make npm read a different path from this preflight.
    if ((regular && name.endsWith('/')) || (!regular && (type !== 53 || size !== 0)) ||
        /[\\\x00-\x1f\x7f]/u.test(path) ||
        parts[0] !== 'package' || parts.some(part => !part || part === '.' || part === '..') ||
        paths.has(path) || start + size > tar.length) break;
    paths.add(path);
    if (regular && (path === manifestPath || path === deploymentPath || path === executablePath))
      entries.set(path, tar.subarray(start, start + size));
    offset = start + Math.ceil(size / 512) * 512;
  }
  throw new Error(invalidTarball);
}

export function automationCliTarballError(bytes: Buffer, version: string): string | undefined {
  try {
    const entries = tarEntries(bytes);
    const pkg: { name?: string; version?: string; bin?: { inheriti?: string } } | null =
      JSON.parse(entries.get(manifestPath)?.toString('utf8') ?? 'null');
    if (pkg?.name === '@safetech/inheriti-cli-dev' || pkg?.name === '@safetech/inheriti-cli-stg')
      return 'automation_cli_tarball_business_download';
    const marker: { deployment?: string } | null = JSON.parse(entries.get(deploymentPath)?.toString('utf8') ?? 'null');
    const deployment = /^\d+\.\d+\.\d+-(dev|local)\.\d+$/u.exec(version)?.[1];
    if (pkg?.name !== '@safetech/inheriti-cli' || pkg.bin?.inheriti !== 'dist/main.js' || Object.keys(pkg.bin).length !== 1 ||
        !deployment || marker?.deployment !== deployment || !entries.get(executablePath)?.length)
      return invalidTarball;
    if (pkg.version !== version) return 'automation_cli_tarball_version_mismatch';
  } catch { return invalidTarball; }
}
