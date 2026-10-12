import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { requireNativeWindow } from './require-native-window.mjs';

test('requires a nonempty executable native window before packaging', async () => {
  const output = await mkdtemp(join(tmpdir(), 'inheriti-native-window-'));
  const binary = join(output, 'native', `inheriti-window${process.platform === 'win32' ? '.exe' : ''}`);
  try {
    await assert.rejects(requireNativeWindow(output), /Missing or unusable/);
    await mkdir(join(output, 'native'));
    await writeFile(binary, '');
    await assert.rejects(requireNativeWindow(output), /Missing or unusable/);
    await writeFile(binary, 'binary');
    if (process.platform !== 'win32') {
      await chmod(binary, 0o644);
      await assert.rejects(requireNativeWindow(output), /Missing or unusable/);
      await chmod(binary, 0o755);
    }
    await assert.doesNotReject(requireNativeWindow(output));
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});
