import { expect, it, vi } from 'vitest';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { chooseSaveInheritiFile } = vi.hoisted(() => ({ chooseSaveInheritiFile: vi.fn() }));
vi.mock('@safetech/inheriti-elements-core/node-base', async (importOriginal) => ({
  ...(await importOriginal<object>()), chooseSaveInheritiFile,
}));
import { chooseProtectedFile, saveProtectedFile } from '../src/runtime/protected-file.js';

it('saves the sealed bytes exclusively with private permissions before reporting success', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'inheriti-mcp-'));
  try {
    const path = join(dir, 'asset.inheriti');
    chooseSaveInheritiFile.mockResolvedValueOnce(path);
    const selected = await chooseProtectedFile();
    const bytes = Uint8Array.from([1, 2, 3]);
    await saveProtectedFile(selected, bytes);
    expect(new Uint8Array(await readFile(path))).toEqual(bytes);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(saveProtectedFile(selected, bytes)).rejects.toMatchObject({ code: 'EEXIST' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

it('rejects a chooser target without the protected extension', async () => {
  chooseSaveInheritiFile.mockResolvedValueOnce('/tmp/plain.txt');
  await expect(chooseProtectedFile()).rejects.toThrow('viewer_file_invalid');
});
