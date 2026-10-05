import { cp, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const manifest = fileURLToPath(new URL('../packages/core/native-window/src-tauri/Cargo.toml', import.meta.url));
const binaryName = `inheriti-window${process.platform === 'win32' ? '.exe' : ''}`;
const coreBinary = fileURLToPath(new URL(`../packages/core/dist/native/${binaryName}`, import.meta.url));

/** Build the private Core-owned helper for a CLI or MCP package. */
export async function buildNativeWindow(output) {
  const built = spawnSync('cargo', ['build', '--release', '--locked', '--manifest-path', manifest], { stdio: 'inherit' });
  if (built.error || built.status !== 0) throw new Error('Could not build the Inheriti native window');
  await mkdir(dirname(coreBinary), { recursive: true });
  await cp(resolve(dirname(manifest), 'target', 'release', binaryName), coreBinary);
  const destination = resolve(output, 'native');
  await mkdir(destination, { recursive: true });
  await cp(coreBinary, resolve(destination, binaryName));
}
