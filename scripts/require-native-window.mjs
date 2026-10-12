import { constants } from 'node:fs';
import { access, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function requireNativeWindow(output) {
  const binary = resolve(output, 'native', `inheriti-window${process.platform === 'win32' ? '.exe' : ''}`);
  try {
    const info = await lstat(binary);
    if (!info.isFile() || info.size === 0) throw new Error('empty or not a file');
    if (process.platform !== 'win32') await access(binary, constants.X_OK);
  } catch {
    throw new Error(`Missing or unusable Inheriti native window: ${binary}`);
  }
}
